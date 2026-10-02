"""Mixer stem copies and strum accents for every song (the chords Lambda's /practice-audio).

New songs get them during processing; this fills in the existing ones. Each
song folder with a beat grid (chord_meta.json) and stems gets
mixer/<stem>.mp3 and strum_accents.json written beside them. Nothing
existing is overwritten except an older strum_accents.json, so no backup is
needed. Songs already done (mixer copies and accents present) are skipped
unless --force.

Usage (AWS credentials for the prod account in the env):
    python scripts/backfill_practice_audio.py --qualifier 45 --limit 5   # try a few on a version
    python scripts/backfill_practice_audio.py --qualifier live --log logs/practice_audio.jsonl
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3
from botocore.config import Config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("backfill_practice_audio")

BUCKET = "smart-guitar-audio-prod"
FUNCTION = "smart-guitar-chords-generator"
STEMS = ("vocals", "guitar", "drums", "bass", "piano", "other")
_config = Config(max_pool_connections=64, read_timeout=900, retries={"max_attempts": 2})
_s3 = boto3.client("s3", region_name="us-east-1", config=_config)
_lambda = boto3.client("lambda", region_name="us-east-1", config=_config)


def song_folders() -> dict[str, set[str]]:
    """Song folder -> its file names, nested ones included ("mixer/vocals.mp3")."""
    folders: dict[str, set[str]] = {}
    for page in _s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.startswith("backups/"):
                continue
            for marker in ("/mixer/", "/chord_meta.json", "/strum_accents.json", *(f"/{s}.mp3" for s in STEMS)):
                if marker in key:
                    folder = key[: key.index(marker)]
                    folders.setdefault(folder, set()).add(key[len(folder) + 1:])
                    break
    return {f: names for f, names in folders.items() if "chord_meta.json" in names}


def _event(path: str, payload: dict) -> bytes:
    """The load-balancer request the chords Lambda normally gets from the internal ALB."""
    return json.dumps({
        "requestContext": {"elb": {"targetGroupArn": "backfill"}},
        "httpMethod": "POST", "path": path, "queryStringParameters": {},
        "headers": {"content-type": "application/json"},
        "body": json.dumps(payload), "isBase64Encoded": False,
    }).encode()


def process(folder: str, names: set[str], qualifier: str, force: bool) -> dict:
    stems = {s: f"{folder}/{s}.mp3" for s in STEMS if f"{s}.mp3" in names}
    if not stems:
        return {"folder": folder, "outcome": "no_stems"}
    done = all(f"mixer/{s}.mp3" in names for s in stems) and "strum_accents.json" in names
    if done and not force:
        return {"folder": folder, "outcome": "done_already"}
    started = time.monotonic()
    resp = _lambda.invoke(
        FunctionName=FUNCTION, Qualifier=qualifier,
        Payload=_event("/practice-audio", {"chords_path": f"{folder}/chords.json", "stems": stems}),
    )
    out = json.loads(resp["Payload"].read())
    if "FunctionError" in resp or int(out.get("statusCode", 0)) != 200:
        return {"folder": folder, "outcome": "failed", "error": str(out)[:300]}
    body = json.loads(out["body"])
    return {
        "folder": folder, "outcome": "written", "accents": body.get("accents"),
        "seconds": round(time.monotonic() - started, 1),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--qualifier", required=True, help="Lambda version or alias")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--only", help="process just this song folder")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument("--log", type=Path)
    args = parser.parse_args()

    folders = song_folders()
    items = sorted(folders.items())
    if args.only:
        items = [(f, n) for f, n in items if f == args.only]
    if args.limit:
        items = items[: args.limit]
    counts: dict[str, int] = {}
    log = args.log.open("a") if args.log else None

    def run(item: tuple[str, set[str]]) -> dict:
        try:
            return process(*item, args.qualifier, args.force)
        except Exception as e:
            return {"folder": item[0], "outcome": "failed", "error": str(e)[:300]}

    with ThreadPoolExecutor(args.workers) as pool:
        for result in pool.map(run, items):
            counts[result["outcome"]] = counts.get(result["outcome"], 0) + 1
            if result["outcome"] in ("written", "failed"):
                logger.info("%s", json.dumps(result))
            if log:
                log.write(json.dumps(result) + "\n")
                log.flush()
    logger.info("DONE %d songs: %s", len(items), counts)


if __name__ == "__main__":
    main()
