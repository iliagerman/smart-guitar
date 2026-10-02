"""Put stored chord sheets' Hebrew lines in reading order (see services/sheet_reading_order.py).

Sheets fetched before the fetcher did this (static_chords.json without
"chord_order": "reading") have their Hebrew lyric rows' chords backwards.
This rewrites them. Sheets the change affects get their original saved
beside them as static_chords.pre_reading_order.json first (the bucket keeps
no versions); every rewritten file is marked, so rerunning is a no-op.

Re-run the sheet alignment afterwards (POST /admin/songs/sheets) so the
songs' chords follow the corrected sheets.

Usage (from backend/, AWS credentials for the prod account in the env):
    uv run python scripts/backfill_sheet_reading_order.py            # dry run
    uv run python scripts/backfill_sheet_reading_order.py --apply
"""

from __future__ import annotations

import argparse
import json
import logging
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.config import Config

from guitar_player.services.sheet_reading_order import READING_ORDER, to_reading_order

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("backfill_sheet_reading_order")

BUCKET = "smart-guitar-audio-prod"
SHEET = "static_chords.json"
BACKUP = "static_chords.pre_reading_order.json"
_s3 = boto3.client("s3", region_name="us-east-1", config=Config(max_pool_connections=32))


def sheet_keys() -> list[str]:
    keys = []
    for page in _s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET):
        keys += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(f"/{SHEET}")]
    return keys


def convert(key: str, apply: bool) -> str:
    raw = _s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
    sheet = json.loads(raw)
    if not isinstance(sheet, dict) or sheet.get("chord_order") == READING_ORDER:
        return "done already"
    versions = sheet.get("versions") or []
    converted = [{**v, "lines": to_reading_order(v.get("lines") or [])} for v in versions]
    changed = converted != versions
    if apply:
        if changed:
            _s3.put_object(Bucket=BUCKET, Key=key.replace(SHEET, BACKUP), Body=raw, ContentType="application/json")
        sheet.update(versions=converted, chord_order=READING_ORDER)
        _s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(sheet).encode(), ContentType="application/json")
    return "reordered" if changed else "marked"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    keys = sheet_keys()
    with ThreadPoolExecutor(16) as pool:
        outcomes = list(pool.map(lambda k: (k, convert(k, args.apply)), keys))
    counts: dict[str, int] = {}
    for key, outcome in outcomes:
        counts[outcome] = counts.get(outcome, 0) + 1
        if outcome == "reordered":
            logger.info("%s %s", "reordered" if args.apply else "would reorder", key)
    logger.info("%d sheets: %s%s", len(keys), counts, "" if args.apply else " (dry run; --apply to write)")


if __name__ == "__main__":
    main()
