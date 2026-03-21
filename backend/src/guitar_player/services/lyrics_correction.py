from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from guitar_player.services.llm_service import LlmService, LyricsSegmentMapping

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
    quick_to_regular: list[int | None]


@dataclass
class MergeDiagnostics:
    mapping_count: int
    mapping_groups: int
    aligned_words: int
    total_words: int


def normalize_word(word: str) -> str:
    return WORD_RE.sub("", word.lower())


def similarity(left: str, right: str) -> float:
    if not left or not right:
        return -0.8
    if left == right:
        return 2.0
    ratio = SequenceMatcher(None, left, right).ratio()
    return (ratio * 2.0) - 0.6


def flatten_words(
    segments: list[dict[str, Any]], *, segment_offset: int = 0
) -> list[FlatWord]:
    flattened: list[FlatWord] = []
    for segment_index, segment in enumerate(segments):
        for word_index, word in enumerate(segment.get("words", [])):
            flattened.append(
                FlatWord(
                    segment_index=segment_offset + segment_index,
                    word_index=word_index,
                    word=str(word.get("word", "")),
                    start=float(word.get("start", 0.0)),
                    end=float(word.get("end", 0.0)),
                )
            )
    return flattened


def align_words(
    quick_words: list[FlatWord], regular_words: list[FlatWord]
) -> AlignmentResult:
    quick_norm = [normalize_word(word.word) for word in quick_words]
    regular_norm = [normalize_word(word.word) for word in regular_words]

    rows = len(quick_words) + 1
    cols = len(regular_words) + 1
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
                quick_norm[i - 1], regular_norm[j - 1]
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
    j = len(regular_words)
    while i > 0 or j > 0:
        move = moves[i][j]
        if move == "diag":
            quick_token = quick_norm[i - 1]
            regular_token = regular_norm[j - 1]
            if similarity(quick_token, regular_token) > 0.15:
                mapping[i - 1] = j - 1
            i -= 1
            j -= 1
        elif move == "up":
            i -= 1
        else:
            j -= 1

    return AlignmentResult(quick_to_regular=mapping)


def interpolate_word_times(
    quick_words: list[FlatWord],
    regular_words: list[FlatWord],
    mapping: list[int | None],
) -> list[TimedWord]:
    assigned: list[TimedWord | None] = [None] * len(quick_words)

    for quick_index, regular_index in enumerate(mapping):
        if regular_index is None:
            continue
        regular_word = regular_words[regular_index]
        assigned[quick_index] = TimedWord(
            start=regular_word.start,
            end=regular_word.end,
        )

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
        next_assigned = assigned[end_index + 1] if end_index + 1 < len(assigned) else None

        block_indices = list(range(start_index, end_index + 1))
        block_duration = sum(quick_durations[word_index] for word_index in block_indices)
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


def _summarize_segments_for_llm(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summary: list[dict[str, Any]] = []
    for idx, segment in enumerate(segments):
        words = [str(w.get("word", "")) for w in segment.get("words", [])]
        summary.append(
            {
                "index": idx,
                "start": round(float(segment.get("start", 0.0)), 3),
                "end": round(float(segment.get("end", 0.0)), 3),
                "text": str(segment.get("text", "")).strip(),
                "word_count": len(words),
                "words": words,
            }
        )
    return summary


def _group_mappings(
    quick_segments: list[dict[str, Any]],
    mappings: list[LyricsSegmentMapping],
) -> list[tuple[int, int, int, int]]:
    if not mappings:
        return []

    groups: list[tuple[int, int, int, int]] = []
    group_start = 0
    current_start = mappings[0].regular_start_index
    current_end = mappings[0].regular_end_index

    for i in range(1, len(mappings)):
        mapping = mappings[i]
        if (
            mapping.regular_start_index == current_start
            and mapping.regular_end_index == current_end
        ):
            continue
        groups.append((group_start, i - 1, current_start, current_end))
        group_start = i
        current_start = mapping.regular_start_index
        current_end = mapping.regular_end_index

    groups.append((group_start, len(quick_segments) - 1, current_start, current_end))
    return groups


def _build_group_segments(
    quick_group: list[dict[str, Any]],
    regular_group: list[dict[str, Any]],
    *,
    segment_offset: int,
) -> tuple[list[dict[str, Any]], int, int]:
    if not quick_group:
        return [], 0, 0

    quick_words = flatten_words(quick_group, segment_offset=segment_offset)
    regular_words = flatten_words(regular_group)

    if not quick_words:
        return [copy.deepcopy(segment) for segment in quick_group], 0, 0

    if not regular_words:
        return [copy.deepcopy(segment) for segment in quick_group], 0, len(quick_words)

    alignment = align_words(quick_words, regular_words)
    assigned_times = interpolate_word_times(
        quick_words, regular_words, alignment.quick_to_regular
    )

    output_segments = [copy.deepcopy(segment) for segment in quick_group]
    for quick_word, timed in zip(quick_words, assigned_times, strict=True):
        word_data = output_segments[
            quick_word.segment_index - segment_offset
        ]["words"][quick_word.word_index]
        word_data["word"] = quick_word.word
        word_data["start"] = round(timed.start, 3)
        word_data["end"] = round(timed.end, 3)

    for segment in output_segments:
        words = segment.get("words", [])
        if words:
            segment["start"] = round(float(words[0]["start"]), 3)
            segment["end"] = round(float(words[-1]["end"]), 3)
            segment["text"] = " ".join(str(word["word"]) for word in words)

    aligned_words = sum(1 for idx in alignment.quick_to_regular if idx is not None)
    return output_segments, aligned_words, len(quick_words)


def merge_lyrics_with_llm(
    quick_data: dict[str, Any],
    regular_data: dict[str, Any],
    llm: LlmService,
) -> tuple[dict[str, Any], MergeDiagnostics]:
    quick_segments = quick_data.get("segments", [])
    regular_segments = regular_data.get("segments", [])
    if not isinstance(quick_segments, list) or not isinstance(regular_segments, list):
        raise ValueError("Both quick and regular lyrics must contain a segments list")
    if not quick_segments:
        raise ValueError("Quick lyrics segments are empty")
    if not regular_segments:
        raise ValueError("Regular lyrics segments are empty")

    mappings = llm.align_lyrics_segments_sync(
        _summarize_segments_for_llm(quick_segments),
        _summarize_segments_for_llm(regular_segments),
    )
    if len(mappings) != len(quick_segments):
        raise ValueError(
            f"Expected {len(quick_segments)} mappings, got {len(mappings)}"
        )

    merged_segments: list[dict[str, Any]] = []
    aligned_words = 0
    total_words = 0
    for quick_start, quick_end, regular_start, regular_end in _group_mappings(
        quick_segments, mappings
    ):
        regular_start = max(0, min(regular_start, len(regular_segments) - 1))
        regular_end = max(regular_start, min(regular_end, len(regular_segments) - 1))

        group_segments, group_aligned, group_total = _build_group_segments(
            quick_segments[quick_start : quick_end + 1],
            regular_segments[regular_start : regular_end + 1],
            segment_offset=quick_start,
        )
        merged_segments.extend(group_segments)
        aligned_words += group_aligned
        total_words += group_total

    merged = {
        "segments": merged_segments,
        "source": "llm_quick_words_regular_timing",
        "metadata": {
            "quick_source": quick_data.get("source"),
            "regular_source": regular_data.get("source"),
            "mapping_count": len(mappings),
        },
    }
    diagnostics = MergeDiagnostics(
        mapping_count=len(mappings),
        mapping_groups=len(_group_mappings(quick_segments, mappings)),
        aligned_words=aligned_words,
        total_words=total_words,
    )
    return merged, diagnostics
