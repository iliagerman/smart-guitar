"""Regenerate every song's simplified chord variants from its chords.json.

chords_intermediate.json, chords_beginner.json and chords_beginner_capo_N.json
are derived from chords.json by simplifier.py. After a simplifier change this
rewrites them in place. The variants a song had are saved first under
backups/simplified_<stamp>/<song>/ in the same bucket (it keeps no versions);
capo variants the new options don't include are deleted.

Re-run the practice tags afterwards (POST /admin/songs/retag?force=true).

Usage (from chords_generator/, AWS credentials for the prod account in the env):
    uv run python scripts/backfill_simplified_chords.py            # dry run
    uv run python scripts/backfill_simplified_chords.py --apply
"""

from __future__ import annotations

import argparse
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import boto3
from botocore.config import Config

from chords_generator.schemas import ChordResult
from chords_generator.simplifier import generate_simplified_options

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("backfill_simplified_chords")

BUCKET = "smart-guitar-audio-prod"
_VARIANT = re.compile(r"chords_(?:intermediate|beginner(?:_capo_\d+)?)\.json")
_s3 = boto3.client("s3", region_name="us-east-1", config=Config(max_pool_connections=32))


def song_files() -> dict[str, set[str]]:
    """Song folder -> file names in it, for folders with a chords.json."""
    folders: dict[str, set[str]] = {}
    for page in _s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            folder, _, name = obj["Key"].rpartition("/")
            if folder and not folder.startswith("backups/"):
                folders.setdefault(folder, set()).add(name)
    return {folder: names for folder, names in folders.items() if "chords.json" in names}


def regenerate(folder: str, names: set[str], backup_prefix: str, apply: bool) -> str:
    entries = json.loads(_s3.get_object(Bucket=BUCKET, Key=f"{folder}/chords.json")["Body"].read())
    if not isinstance(entries, list):
        return "skipped"
    chords = [
        ChordResult(start_time=float(e["start_time"]), end_time=float(e["end_time"]), chord=e["chord"], bass=e.get("bass"))
        for e in entries
    ]
    options = {f"chords_{o['name']}.json": o for o in generate_simplified_options(chords)["options"]}
    old = {name for name in names if _VARIANT.fullmatch(name)}
    if not apply:
        return "would write"
    for name in old:
        _s3.copy_object(Bucket=BUCKET, Key=f"{backup_prefix}/{folder}/{name}", CopySource={"Bucket": BUCKET, "Key": f"{folder}/{name}"})
    for name, option in options.items():
        _s3.put_object(Bucket=BUCKET, Key=f"{folder}/{name}", Body=json.dumps(option, indent=2).encode(), ContentType="application/json")
    for name in old - options.keys():
        _s3.delete_object(Bucket=BUCKET, Key=f"{folder}/{name}")
    return "written"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    backup_prefix = f"backups/simplified_{datetime.now(timezone.utc):%Y%m%dT%H%M%S}"
    folders = song_files()

    def run(item: tuple[str, set[str]]) -> str:
        try:
            return regenerate(*item, backup_prefix, args.apply)
        except Exception:
            logger.exception("failed %s", item[0])
            return "failed"

    with ThreadPoolExecutor(16) as pool:
        outcomes = list(pool.map(run, folders.items()))
    counts: dict[str, int] = {}
    for outcome in outcomes:
        counts[outcome] = counts.get(outcome, 0) + 1
    logger.info("%d songs: %s; backups under %s%s", len(folders), counts, backup_prefix, "" if args.apply else " (dry run)")


if __name__ == "__main__":
    main()
