"""Re-pick every song's strum accents from its stored strengths (after an accent-rule change).

strum_accents.json keeps the measured strength of each slot, so a change to
pick_accents needs no audio: this rewrites "accents" in place. Files it
changes are saved first under backups/strum_accents_<stamp>/ (the bucket
keeps no versions).

Usage (from chords_generator/, AWS credentials for the prod account in the env):
    uv run python scripts/reapply_strum_accents.py            # dry run
    uv run python scripts/reapply_strum_accents.py --apply
"""

from __future__ import annotations

import argparse
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import boto3
from botocore.config import Config

from chords_generator.strum_accents import pick_accents

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("reapply_strum_accents")

BUCKET = "smart-guitar-audio-prod"
FILE = "strum_accents.json"
_s3 = boto3.client("s3", region_name="us-east-1", config=Config(max_pool_connections=32))


def accent_keys() -> list[str]:
    keys = []
    for page in _s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET):
        keys += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(f"/{FILE}") and not o["Key"].startswith("backups/")]
    return keys


def reapply(key: str, backup_prefix: str, apply: bool) -> str:
    raw = _s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
    data = json.loads(raw)
    accents = pick_accents(data["strength"])
    if accents == data["accents"]:
        return "unchanged"
    if apply:
        _s3.put_object(Bucket=BUCKET, Key=f"{backup_prefix}/{key}", Body=raw, ContentType="application/json")
        data["accents"] = accents
        _s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(data, indent=2).encode(), ContentType="application/json")
    return "changed"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    backup_prefix = f"backups/strum_accents_{datetime.now(timezone.utc):%Y%m%dT%H%M%S}"
    keys = accent_keys()
    with ThreadPoolExecutor(16) as pool:
        outcomes = list(pool.map(lambda k: reapply(k, backup_prefix, args.apply), keys))
    counts = {o: outcomes.count(o) for o in set(outcomes)}
    logger.info("%d accent files: %s; backups under %s%s", len(keys), counts, backup_prefix, "" if args.apply else " (dry run)")


if __name__ == "__main__":
    main()
