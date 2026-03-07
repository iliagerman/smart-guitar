"""Verify simplified chord files produced by the chords generator.

Usage: python verify_simplified_chords.py <song_dir>

Checks that chords_intermediate.json and chords_beginner.json exist,
validates their structure, and verifies any capo variation files.
"""

import glob
import json
import os
import sys


def verify(song_dir: str) -> None:
    errors = 0

    # chords_intermediate.json and chords_beginner.json must always exist
    for required in ["chords_intermediate.json", "chords_beginner.json"]:
        path = os.path.join(song_dir, required)
        if not os.path.isfile(path):
            print(f"FAIL: {required} not found in {song_dir}")
            errors += 1
            continue

        with open(path) as f:
            data = json.load(f)

        for field in ("name", "capo", "chords", "description"):
            if field not in data:
                print(f"FAIL: {required} missing '{field}' field")
                errors += 1

        if "chords" in data:
            for i, c in enumerate(data["chords"]):
                for key in ("start_time", "end_time", "chord"):
                    if key not in c:
                        print(f"FAIL: {required} chord[{i}] missing '{key}'")
                        errors += 1

            print(f"  OK: {required} -- {len(data['chords'])} chords, capo={data.get('capo')}")

    # capo files are optional — verify any that exist
    capo_files = glob.glob(os.path.join(song_dir, "chords_beginner_capo_*.json"))
    for path in sorted(capo_files):
        fname = os.path.basename(path)
        with open(path) as f:
            data = json.load(f)

        if data.get("capo", 0) < 1:
            print(f"FAIL: {fname} capo field should be >= 1, got {data.get('capo')}")
            errors += 1

        if "chords" not in data:
            print(f"FAIL: {fname} missing 'chords' field")
            errors += 1
        else:
            for i, c in enumerate(data["chords"]):
                for key in ("start_time", "end_time", "chord"):
                    if key not in c:
                        print(f"FAIL: {fname} chord[{i}] missing '{key}'")
                        errors += 1

            print(f"  OK: {fname} -- {len(data['chords'])} chords, capo={data.get('capo')}")

    total = 2 + len(capo_files)
    if errors:
        print(f"FAILED: {errors} error(s) in simplified chord verification")
        sys.exit(1)
    else:
        print(f"All {total} simplified chord files verified.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <song_dir>", file=sys.stderr)
        sys.exit(1)
    verify(sys.argv[1])
