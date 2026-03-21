from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
import re
from typing import Any


WORD_RE = re.compile(r"[^a-z0-9']+")


@dataclass
class FlatWord:
    segment_index: int
    word_index: int
    word: str
    start: float
    end: float


@dataclass
class TimedWord:
    start: float
    end: float


@dataclass
class AlignmentResult:
    quick_to_timed: list[int | None]


def normalize_word(word: str) -> str:
    return WORD_RE.sub("", word.lower())


def similarity(left: str, right: str) -> float:
    if not left or not right:
        return -0.8
    if left == right:
        return 2.0
    ratio = SequenceMatcher(None, left, right).ratio()
    return (ratio * 2.0) - 0.6


def flatten_words(segments: list[dict[str, Any]]) -> list[FlatWord]:
    flattened: list[FlatWord] = []
    for segment_index, segment in enumerate(segments):
        for word_index, word in enumerate(segment["words"]):
            flattened.append(
                FlatWord(
                    segment_index=segment_index,
                    word_index=word_index,
                    word=word["word"],
                    start=float(word["start"]),
                    end=float(word["end"]),
                )
            )
    return flattened


def align_words(
    quick_words: list[FlatWord], timed_words: list[FlatWord]
) -> AlignmentResult:
    quick_norm = [normalize_word(word.word) for word in quick_words]
    timed_norm = [normalize_word(word.word) for word in timed_words]

    rows = len(quick_words) + 1
    cols = len(timed_words) + 1
    gap = -0.7

    scores = [[0.0] * cols for _ in range(rows)]
    moves = [[""] * cols for _ in range(rows)]

    for i in range(1, rows):
        scores[i][0] = scores[i - 1][0] + gap
        moves[i][0] = "up"
    for j in range(1, cols):
        scores[0][j] = scores[0][j - 1] + gap
        moves[0][j] = "left"

    for i in range(1, rows):
        for j in range(1, cols):
            diag = scores[i - 1][j - 1] + similarity(
                quick_norm[i - 1], timed_norm[j - 1]
            )
            up = scores[i - 1][j] + gap
            left = scores[i][j - 1] + gap
            best = max(diag, up, left)
            scores[i][j] = best
            if best == diag:
                moves[i][j] = "diag"
            elif best == up:
                moves[i][j] = "up"
            else:
                moves[i][j] = "left"

    mapping: list[int | None] = [None] * len(quick_words)
    i = len(quick_words)
    j = len(timed_words)
    while i > 0 or j > 0:
        move = moves[i][j]
        if move == "diag":
            quick_token = quick_norm[i - 1]
            timed_token = timed_norm[j - 1]
            if similarity(quick_token, timed_token) > 0.15:
                mapping[i - 1] = j - 1
            i -= 1
            j -= 1
        elif move == "up":
            i -= 1
        else:
            j -= 1

    return AlignmentResult(quick_to_timed=mapping)


def interpolate_word_times(
    quick_words: list[FlatWord],
    timed_words: list[FlatWord],
    mapping: list[int | None],
) -> list[TimedWord]:
    assigned: list[TimedWord | None] = [None] * len(quick_words)

    for quick_index, timed_index in enumerate(mapping):
        if timed_index is None:
            continue
        timed_word = timed_words[timed_index]
        assigned[quick_index] = TimedWord(start=timed_word.start, end=timed_word.end)

    quick_durations = [max(word.end - word.start, 0.01) for word in quick_words]

    index = 0
    while index < len(quick_words):
        if assigned[index] is not None:
            index += 1
            continue

        start_index = index
        while index < len(quick_words) and assigned[index] is None:
            index += 1
        end_index = index - 1

        prev_assigned = assigned[start_index - 1] if start_index > 0 else None
        next_assigned = (
            assigned[end_index + 1] if end_index + 1 < len(assigned) else None
        )

        block_indices = list(range(start_index, end_index + 1))
        block_duration = sum(
            quick_durations[word_index] for word_index in block_indices
        )
        original_start = quick_words[start_index].start
        original_end = quick_words[end_index].end
        original_span = max(original_end - original_start, 0.001)
        anchor_start: float | None = None
        anchor_end: float | None = None

        use_original_times = True
        if prev_assigned and next_assigned and next_assigned.start > prev_assigned.end:
            anchor_start = prev_assigned.end
            anchor_end = next_assigned.start
            anchor_span = anchor_end - anchor_start
            if anchor_span >= original_span * 0.6:
                use_original_times = False

        if use_original_times:
            for word_index in block_indices:
                assigned[word_index] = TimedWord(
                    start=quick_words[word_index].start,
                    end=quick_words[word_index].end,
                )
            continue

        window_start = anchor_start if anchor_start is not None else original_start
        window_end = anchor_end if anchor_end is not None else original_end

        available = max(window_end - window_start, 0.001)
        cursor = window_start
        total = max(block_duration, 0.001)

        for word_index in block_indices:
            share = quick_durations[word_index] / total
            word_end = cursor + (available * share)
            assigned[word_index] = TimedWord(start=cursor, end=word_end)
            cursor = word_end

    return [word for word in assigned if word is not None]


def build_output(
    quick_data: dict[str, Any],
    quick_words: list[FlatWord],
    assigned_times: list[TimedWord],
    output_source: str,
) -> dict[str, Any]:
    segments = quick_data["segments"]

    for quick_word, timed in zip(quick_words, assigned_times, strict=True):
        word_data = segments[quick_word.segment_index]["words"][quick_word.word_index]
        word_data["word"] = quick_word.word
        word_data["start"] = round(timed.start, 3)
        word_data["end"] = round(timed.end, 3)

    for segment in segments:
        words = segment["words"]
        if words:
            segment["start"] = round(float(words[0]["start"]), 3)
            segment["end"] = round(float(words[-1]["end"]), 3)
            segment["text"] = " ".join(word["word"] for word in words)

    quick_data["source"] = output_source
    return quick_data


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge clean lyric words with better timing data."
    )
    parser.add_argument(
        "--quick", required=True, help="Path to the quick lyrics JSON file."
    )
    parser.add_argument(
        "--timed", required=True, help="Path to the timed lyrics JSON file."
    )
    parser.add_argument(
        "--output",
        help="Output path. Defaults to overwriting the timed JSON file.",
    )
    parser.add_argument(
        "--backup",
        action="store_true",
        help="Create a .bak copy of the output file before overwriting it.",
    )
    args = parser.parse_args()

    quick_path = Path(args.quick)
    timed_path = Path(args.timed)
    output_path = Path(args.output) if args.output else timed_path

    quick_data = json.loads(quick_path.read_text())
    timed_data = json.loads(timed_path.read_text())

    quick_words = flatten_words(quick_data["segments"])
    timed_words = flatten_words(timed_data["segments"])

    alignment = align_words(quick_words, timed_words)
    assigned_times = interpolate_word_times(
        quick_words, timed_words, alignment.quick_to_timed
    )
    merged = build_output(
        quick_data=quick_data,
        quick_words=quick_words,
        assigned_times=assigned_times,
        output_source="merged_quick_words_with_synced_timing",
    )

    if args.backup and output_path.exists():
        backup_path = output_path.with_suffix(output_path.suffix + ".bak")
        shutil.copy2(output_path, backup_path)
        print(f"Created backup: {backup_path}")

    output_path.write_text(json.dumps(merged, indent=2) + "\n")
    matched = sum(1 for index in alignment.quick_to_timed if index is not None)
    print(f"Aligned {matched}/{len(quick_words)} quick words to timed words")
    print(f"Wrote merged lyrics to: {output_path}")


if __name__ == "__main__":
    main()
