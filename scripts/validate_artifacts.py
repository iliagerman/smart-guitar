"""Validate generated lyrics/chords JSON artifacts under a bucket directory.

Checks every song folder for:
  * lyrics*.json — segment ordering (non-monotonic starts, overlaps),
    word ordering/containment, adjacent duplicate lines, leftover
    lyrics_corrected.json files (legacy LLM merge — should not exist)
  * chords.json — monotonic timing, slash-bass coverage stats

Exit code 1 if any blocking violations are found (use as an upload gate).

Usage:
    python3 scripts/validate_artifacts.py local_bucket [--verbose]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


def check_lyrics(path: Path) -> dict[str, int]:
    issues: Counter[str] = Counter()
    try:
        with open(path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"unreadable": 1}
    segments = data.get("segments", [])
    if not segments:
        return {"empty": 1}

    prev_start, prev_end, prev_text = -1.0, -1.0, None
    for seg in segments:
        start = float(seg.get("start", 0))
        end = float(seg.get("end", 0))
        text = (seg.get("text") or "").strip().lower()
        if start < prev_start:
            issues["segment_order"] += 1
        if start < prev_end - 0.001:
            issues["segment_overlap"] += 1
        if end < start:
            issues["segment_inverted"] += 1
        if text and text == prev_text:
            issues["adjacent_duplicate"] += 1
        prev_word_start = -1.0
        for word in seg.get("words", []):
            ws, we = float(word.get("start", 0)), float(word.get("end", 0))
            if ws < prev_word_start - 0.001:
                issues["word_order"] += 1
            if we < ws:
                issues["word_inverted"] += 1
            if ws < start - 0.5 or we > end + 0.5:
                issues["word_outside_segment"] += 1
            prev_word_start = ws
        prev_start, prev_end, prev_text = start, end, text
    return dict(issues)


def check_chords(path: Path) -> tuple[dict[str, int], int, int]:
    """Returns (issues, n_chords, n_with_bass)."""
    issues: Counter[str] = Counter()
    try:
        with open(path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"unreadable": 1}, 0, 0
    chords = data if isinstance(data, list) else data.get("chords", [])
    prev_start = -1.0
    with_bass = 0
    for c in chords:
        start = float(c.get("start_time", 0))
        end = float(c.get("end_time", 0))
        if start < prev_start:
            issues["chord_order"] += 1
        if end < start:
            issues["chord_inverted"] += 1
        if c.get("bass"):
            with_bass += 1
        prev_start = start
    return dict(issues), len(chords), with_bass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bucket", help="Bucket directory to scan (e.g. local_bucket)")
    parser.add_argument("--verbose", action="store_true", help="Print every file with issues")
    args = parser.parse_args()

    bucket = Path(args.bucket)
    if not bucket.is_dir():
        print(f"Not a directory: {bucket}", file=sys.stderr)
        return 2

    lyrics_files = 0
    lyrics_files_with_issues = 0
    lyrics_issue_totals: Counter[str] = Counter()
    chord_files = 0
    chord_files_with_issues = 0
    chord_issue_totals: Counter[str] = Counter()
    songs_with_bass = 0
    total_chords = 0
    total_with_bass = 0
    leftover_corrected: list[str] = []
    bad_files: list[tuple[str, dict[str, int]]] = []

    for path in sorted(bucket.rglob("*.json")):
        rel = str(path.relative_to(bucket))
        if "/jobs/" in rel:
            continue
        name = path.name
        if name == "lyrics_corrected.json":
            leftover_corrected.append(rel)
        elif name in ("lyrics.json", "lyrics_quick.json"):
            lyrics_files += 1
            issues = check_lyrics(path)
            issues.pop("empty", None)  # instrumental songs are fine
            if issues:
                lyrics_files_with_issues += 1
                lyrics_issue_totals.update(issues)
                bad_files.append((rel, issues))
        elif name == "chords.json":
            chord_files += 1
            issues, n, with_bass = check_chords(path)
            total_chords += n
            total_with_bass += with_bass
            if with_bass:
                songs_with_bass += 1
            if issues:
                chord_files_with_issues += 1
                chord_issue_totals.update(issues)
                bad_files.append((rel, issues))

    print(f"Lyrics files scanned:  {lyrics_files}")
    print(f"  with issues:         {lyrics_files_with_issues}  {dict(lyrics_issue_totals)}")
    print(f"Chord files scanned:   {chord_files}")
    print(f"  with issues:         {chord_files_with_issues}  {dict(chord_issue_totals)}")
    print(f"  songs w/ slash bass: {songs_with_bass}/{chord_files} "
          f"({total_with_bass}/{total_chords} chords)")
    print(f"Leftover lyrics_corrected.json: {len(leftover_corrected)}")

    if args.verbose:
        for rel, issues in bad_files:
            print(f"  ISSUE {rel}: {issues}")
        for rel in leftover_corrected:
            print(f"  LEFTOVER {rel}")

    blocking = (
        lyrics_files_with_issues
        + chord_files_with_issues
        + len(leftover_corrected)
    )
    if blocking:
        print(f"\nFAIL: {blocking} blocking findings", file=sys.stderr)
        return 1
    print("\nOK: all artifacts structurally valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
