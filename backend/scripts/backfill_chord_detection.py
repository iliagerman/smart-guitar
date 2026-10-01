"""Re-detect every stored song's chords with the current chords service.

The chords service now decides chords with BTC on a Beat This! beat grid (see
chords_generator/recognizer.py). Songs recognized before that keep their
autochord chords until re-run; this re-runs them through the deployed chords
Lambda, the same code new songs get.

For each song folder holding an audio.mp3:

1. Saves its current chord files (chords.json, chords.lab, chord_meta.json and
   the simplified chords_beginner*/chords_intermediate variants) into one
   ``pre_btc_chords_backup.json`` beside them. The bucket keeps no versions,
   so this is the only way back. An existing backup is never overwritten.
2. Invokes /recognize asynchronously on the full mix plus the bass/guitar/
   piano/other stems, and waits for chord_meta.json to report the new model.
   (Async because a client connection held open for minutes can drop.)
3. Deletes capo variants the new run didn't rewrite: the recommended capo
   positions can change, and stale files would still be offered as variants.
4. Re-adds slash bass with /detect-bass, as new songs get after recognition.

Progress goes to a JSONL state file; rerunning skips songs already done.

Usage (from backend/, AWS credentials for the prod account in the env):
    uv run python scripts/backfill_chord_detection.py                     # dry run
    uv run python scripts/backfill_chord_detection.py --apply --only oasis/wonderwall
    uv run python scripts/backfill_chord_detection.py --apply --concurrency 40
"""

from __future__ import annotations

import argparse
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.config import Config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("backfill_chord_detection")

BUCKET = "smart-guitar-audio-prod"
FUNCTION = "smart-guitar-chords-generator"
REGION = "us-east-1"
CHORD_MODEL = "btc-large-voca"
BACKUP_NAME = "pre_btc_chords_backup.json"
ACCOMPANIMENT_STEMS = ("bass", "guitar", "piano", "other")
# One recognition takes about a minute; give up on a song well past that.
RECOGNIZE_TIMEOUT_S = 900
POLL_S = 10

_s3 = boto3.client("s3", region_name=REGION)
_lambda = boto3.client(
    "lambda", region_name=REGION,
    config=Config(read_timeout=300, connect_timeout=10, retries={"max_attempts": 2}),
)
_state_lock = threading.Lock()


def _is_chord_file(name: str) -> bool:
    return name in ("chords.json", "chords.lab", "chord_meta.json") or (
        name.startswith(("chords_beginner", "chords_intermediate")) and name.endswith(".json")
    )


def list_songs() -> dict[str, dict[str, datetime]]:
    """Song folder -> {file name: last modified} for its top-level files, songs with audio.mp3 only."""
    folders: dict[str, dict[str, datetime]] = {}
    for page in _s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            folder, _, name = obj["Key"].rpartition("/")
            if folder:
                folders.setdefault(folder, {})[name] = obj["LastModified"]
    return {folder: files for folder, files in folders.items() if "audio.mp3" in files}


def _read(key: str) -> bytes:
    return _s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()


def _event(path: str, payload: dict) -> bytes:
    """The load-balancer request the chords Lambda normally gets from the internal ALB."""
    return json.dumps({
        "requestContext": {"elb": {"targetGroupArn": "backfill"}},
        "httpMethod": "POST", "path": path, "queryStringParameters": {},
        "headers": {"content-type": "application/json"},
        "body": json.dumps(payload), "isBase64Encoded": False,
    }).encode()


def _meta(folder: str) -> dict:
    try:
        meta = json.loads(_read(f"{folder}/chord_meta.json"))
    except _s3.exceptions.NoSuchKey:
        return {}
    return meta if isinstance(meta, dict) else {}


def back_up(folder: str, files: dict[str, datetime]) -> None:
    if BACKUP_NAME in files:
        return
    backup = {}
    for name in sorted(n for n in files if _is_chord_file(n)):
        raw = _read(f"{folder}/{name}")
        backup[name] = raw.decode() if name.endswith(".lab") else json.loads(raw)
    _s3.put_object(
        Bucket=BUCKET, Key=f"{folder}/{BACKUP_NAME}",
        Body=json.dumps(backup).encode(), ContentType="application/json",
    )


def recognize(folder: str, files: dict[str, datetime], qualifier: str) -> None:
    stems = [f"{folder}/{s}.mp3" for s in ACCOMPANIMENT_STEMS if f"{s}.mp3" in files]
    submitted = datetime.now(timezone.utc)
    _lambda.invoke(
        FunctionName=FUNCTION, Qualifier=qualifier, InvocationType="Event",
        Payload=_event("/recognize", {"input_path": f"{folder}/audio.mp3", "accompaniment_stem_paths": stems}),
    )
    deadline = time.monotonic() + RECOGNIZE_TIMEOUT_S
    while time.monotonic() < deadline:
        time.sleep(POLL_S)
        try:
            head = _s3.head_object(Bucket=BUCKET, Key=f"{folder}/chord_meta.json")
        except _s3.exceptions.ClientError:
            continue
        if head["LastModified"] >= submitted.replace(microsecond=0) and _meta(folder).get("chord_model") == CHORD_MODEL:
            break
    else:
        raise TimeoutError("recognition did not finish (see the chords Lambda logs)")

    # Capo variants left over from the old recognition.
    for name, modified in _list_folder(folder).items():
        if name.startswith("chords_beginner_capo_") and modified < submitted.replace(microsecond=0):
            _s3.delete_object(Bucket=BUCKET, Key=f"{folder}/{name}")


def _list_folder(folder: str) -> dict[str, datetime]:
    resp = _s3.list_objects_v2(Bucket=BUCKET, Prefix=f"{folder}/", Delimiter="/")
    return {o["Key"].rsplit("/", 1)[1]: o["LastModified"] for o in resp.get("Contents", [])}


def detect_bass(folder: str, files: dict[str, datetime], qualifier: str) -> None:
    if "bass.mp3" not in files:
        return
    resp = _lambda.invoke(
        FunctionName=FUNCTION, Qualifier=qualifier,
        Payload=_event("/detect-bass", {"bass_path": f"{folder}/bass.mp3", "chords_path": f"{folder}/chords.json"}),
    )
    out = json.loads(resp["Payload"].read())
    if "FunctionError" in resp or int(out.get("statusCode", 0)) != 200:
        raise RuntimeError(f"detect-bass failed: {str(out)[:300]}")


def process(folder: str, files: dict[str, datetime], qualifier: str, state_file: Path) -> str:
    started = time.monotonic()
    try:
        back_up(folder, files)
        recognize(folder, files, qualifier)
        detect_bass(folder, files, qualifier)
        status, detail = "done", ""
    except Exception as e:  # one bad song must not stop the run
        status, detail = "failed", f"{type(e).__name__}: {e}"
    with _state_lock, open(state_file, "a") as f:
        f.write(json.dumps({"song": folder, "status": status, "detail": detail,
                            "seconds": round(time.monotonic() - started, 1)}) + "\n")
    return status


def load_done(state_file: Path) -> set[str]:
    if not state_file.is_file():
        return set()
    done = set()
    for line in state_file.read_text().splitlines():
        entry = json.loads(line)
        if entry["status"] == "done":
            done.add(entry["song"])
    return done


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Actually back up and re-detect (default: dry run)")
    parser.add_argument("--only", nargs="*", help="Song folders to process (default: all)")
    parser.add_argument("--limit", type=int, help="Process at most this many songs")
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--qualifier", default="live", help="Chords Lambda alias or version")
    parser.add_argument("--state-file", type=Path, default=Path("backfill_chord_detection.jsonl"))
    args = parser.parse_args()

    songs = list_songs()
    if args.only:
        songs = {k: v for k, v in songs.items() if k in set(args.only)}
    done = load_done(args.state_file)
    queue = sorted(k for k in songs if k not in done)
    if args.limit:
        queue = queue[: args.limit]
    logger.info("%d songs, %d already done, %d to process", len(songs), len(done & songs.keys()), len(queue))
    if not args.apply:
        for folder in queue[:20]:
            stems = [s for s in ACCOMPANIMENT_STEMS if f"{s}.mp3" in songs[folder]]
            logger.info("would re-detect %s (stems: %s)", folder, ", ".join(stems) or "none")
        logger.info("dry run; pass --apply to run")
        return

    counts = {"done": 0, "failed": 0}
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(process, f, songs[f], args.qualifier, args.state_file): f for f in queue}
        for i, future in enumerate(as_completed(futures), 1):
            counts[future.result()] += 1
            if i % 25 == 0 or i == len(futures):
                logger.info("%d/%d processed: %s", i, len(futures), counts)


if __name__ == "__main__":
    main()
