#!/usr/bin/env python3
"""Score generated chords.json files against MIREX .lab reference annotations.

Uses ``mir_eval.chord`` to compute the standard MIREX chord-estimation
metrics (root, majmin, sevenths, thirds, triads, tetrads, and segmentation
scores) per song and averaged across the whole reference set.

**Reference annotation format (.lab):**
One file per song, named ``{song_id}.lab``, with one chord segment per line:

    0.000000 2.500000 C:maj
    2.500000 5.100000 D:min
    5.100000 8.000000 N

This is the standard MIREX chord-annotation format: whitespace-separated
``start_time end_time chord_label`` in seconds, with ``N`` for no-chord.
Labels may use extended MIREX qualities (``C:maj7``, ``A:min7``, ...).

**Generated chords format:**
Each song's generated chords are read from
``{chords-root}/{song_id}/chords.json`` — a JSON list of
``{"start_time": float, "end_time": float, "chord": str, "bass": str|None}``,
matching what ``chords_generator``'s ``/recognize`` endpoint writes. This is
the same ``song_id`` used for the ``.lab`` filename (e.g. for
``local_bucket/artist/title``, pass ``--chords-root local_bucket/artist`` and
name the reference ``title.lab``).

**Adding reference annotations:**
Create one ``.lab`` file per song you want to evaluate against, named after
the song's directory under ``--chords-root`` (its "song_id"), and place them
all in a single directory passed via ``--lab-dir``. Songs without a matching
``chords.json`` (not yet processed) or without a matching ``.lab`` file
(no reference) are skipped and reported to stderr.

Usage:
    uv run --extra dev scripts/chord_eval.py \\
        --lab-dir eval/lab_annotations --chords-root local_bucket/some_artist

    # Save per-song + aggregate scores as JSON:
    uv run --extra dev scripts/chord_eval.py \\
        --lab-dir eval/lab_annotations --chords-root local_bucket/some_artist \\
        --json-output /tmp/chord_eval_results.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import mir_eval.chord
import mir_eval.io
import numpy as np

# Headline metrics, in report order. mir_eval.chord.evaluate() returns many
# more (over/underseg, directional hamming, etc.) which are included in the
# JSON output but not the console table.
METRICS = ("root", "majmin", "majmin_inv", "sevenths", "thirds", "triads", "tetrads", "seg")


def load_generated_chords(chords_path: Path) -> tuple[np.ndarray, list[str]]:
    """Load a chords.json file into (intervals, labels) for mir_eval."""
    with open(chords_path) as f:
        entries = json.load(f)
    intervals = np.array(
        [[entry["start_time"], entry["end_time"]] for entry in entries], dtype=float,
    )
    labels = [entry["chord"] for entry in entries]
    return intervals, labels


def find_song_pairs(lab_dir: Path, chords_root: Path) -> list[tuple[str, Path, Path]]:
    """Match ``{song_id}.lab`` reference files to ``{chords_root}/{song_id}/chords.json``.

    Songs with a reference but no generated chords (or vice versa) are
    skipped and reported to stderr.
    """
    pairs: list[tuple[str, Path, Path]] = []
    for lab_path in sorted(lab_dir.glob("*.lab")):
        song_id = lab_path.stem
        chords_path = chords_root / song_id / "chords.json"
        if chords_path.is_file():
            pairs.append((song_id, lab_path, chords_path))
        else:
            print(f"  Skipping {song_id}: no chords.json at {chords_path}", file=sys.stderr)
    return pairs


def score_song(lab_path: Path, chords_path: Path) -> dict[str, float]:
    """Score one song's generated chords against its .lab reference."""
    ref_intervals, ref_labels = mir_eval.io.load_labeled_intervals(str(lab_path))
    est_intervals, est_labels = load_generated_chords(chords_path)
    return mir_eval.chord.evaluate(ref_intervals, ref_labels, est_intervals, est_labels)


def aggregate(per_song: dict[str, dict[str, float]]) -> dict[str, float]:
    """Unweighted mean of each metric across songs."""
    if not per_song:
        return {}
    all_metrics = {metric for scores in per_song.values() for metric in scores}
    return {
        metric: sum(scores[metric] for scores in per_song.values() if metric in scores)
        / sum(1 for scores in per_song.values() if metric in scores)
        for metric in all_metrics
    }


def print_report(per_song: dict[str, dict[str, float]], aggregate_scores: dict[str, float]) -> None:
    header = f"  {'Song':30s}" + "".join(f"{m:>10s}" for m in METRICS)
    print(header)
    print("  " + "-" * (len(header) - 2))
    for song_id, scores in per_song.items():
        row = f"  {song_id:30s}" + "".join(f"{scores.get(m, float('nan')):10.3f}" for m in METRICS)
        print(row)
    print("  " + "-" * (len(header) - 2))
    agg_row = f"  {'AGGREGATE (mean)':30s}" + "".join(
        f"{aggregate_scores.get(m, float('nan')):10.3f}" for m in METRICS
    )
    print(agg_row)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Score generated chords.json files against MIREX .lab reference annotations",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--lab-dir", required=True, type=Path,
        help="Directory of {song_id}.lab reference annotation files",
    )
    parser.add_argument(
        "--chords-root", required=True, type=Path,
        help="Directory containing {song_id}/chords.json for each song",
    )
    parser.add_argument("--json-output", type=Path, help="Write per-song + aggregate scores as JSON")
    args = parser.parse_args()

    pairs = find_song_pairs(args.lab_dir, args.chords_root)
    if not pairs:
        print("No matching (.lab, chords.json) pairs found.", file=sys.stderr)
        return 1

    per_song: dict[str, dict[str, float]] = {}
    for song_id, lab_path, chords_path in pairs:
        per_song[song_id] = score_song(lab_path, chords_path)

    aggregate_scores = aggregate(per_song)
    print_report(per_song, aggregate_scores)

    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        with open(args.json_output, "w") as f:
            json.dump({"per_song": per_song, "aggregate": aggregate_scores}, f, indent=2)
        print(f"\nResults saved to: {args.json_output.resolve()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
