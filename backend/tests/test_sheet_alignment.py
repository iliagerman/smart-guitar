"""Tests for aligning fetched chord-sheet lines to whisper lyrics timing.

The community chord sheets (Ultimate Guitar) have no timestamps — previously
their lines were spread evenly across the song duration, so auto-scroll
drifted badly. The aligner fuzzy-matches sheet lyric lines to the
whisper-transcribed segments (monotonic, deterministic, no LLM) and gives
each line a real time window; unmatched lines are interpolated between
matched neighbors.
"""

from __future__ import annotations

from guitar_player.schemas.song import LyricsSegment, LyricsWord
from guitar_player.services.song_service.sheet_alignment import (
    align_sheet_lines_to_segments,
)


def seg(start: float, end: float, text: str) -> LyricsSegment:
    words = []
    tokens = text.split()
    dur = (end - start) / max(len(tokens), 1)
    for i, t in enumerate(tokens):
        words.append(LyricsWord(word=t, start=start + i * dur, end=start + (i + 1) * dur))
    return LyricsSegment(start=start, end=end, text=text, words=words)


def lyric(text: str, chords: list[dict] | None = None) -> dict:
    return {"type": "lyric", "text": text, "chords": chords or []}


SEGMENTS = [
    seg(10.0, 14.0, "When I find myself in times of trouble"),
    seg(15.0, 19.0, "Mother Mary comes to me"),
    seg(20.0, 24.0, "Speaking words of wisdom let it be"),
    seg(30.0, 34.0, "And in my hour of darkness"),
]


def test_exact_lines_get_real_segment_timing():
    lines = [
        lyric("When I find myself in times of trouble"),
        lyric("Mother Mary comes to me"),
        lyric("Speaking words of wisdom let it be"),
        lyric("And in my hour of darkness"),
    ]
    timings = align_sheet_lines_to_segments(lines, SEGMENTS, duration=240.0)
    assert timings is not None
    assert len(timings) == 4
    assert timings[0] == (10.0, 14.0)
    assert timings[1] == (15.0, 19.0)
    assert timings[2] == (20.0, 24.0)
    assert timings[3] == (30.0, 34.0)


def test_punctuation_and_case_differences_still_match():
    lines = [
        lyric("When I find myself in times of trouble,"),
        lyric("MOTHER MARY COMES TO ME!"),
        lyric("speaking words of wisdom... let it be"),
    ]
    timings = align_sheet_lines_to_segments(lines, SEGMENTS, duration=240.0)
    assert timings is not None
    assert timings[0] == (10.0, 14.0)
    assert timings[1] == (15.0, 19.0)
    assert timings[2] == (20.0, 24.0)


def test_non_lyric_lines_are_not_timed_but_do_not_break_alignment():
    lines = [
        {"type": "section", "text": "Verse 1", "chords": []},
        lyric("When I find myself in times of trouble"),
        {"type": "empty", "text": "", "chords": []},
        lyric("Mother Mary comes to me"),
    ]
    timings = align_sheet_lines_to_segments(lines, SEGMENTS, duration=240.0)
    assert timings is not None
    # One timing entry per input line; non-timed kinds get None.
    assert len(timings) == 4
    assert timings[0] is None
    assert timings[1] == (10.0, 14.0)
    assert timings[2] is None
    assert timings[3] == (15.0, 19.0)


def test_unmatched_middle_line_interpolates_between_neighbors():
    lines = [
        lyric("When I find myself in times of trouble"),
        lyric("completely different text that matches nothing at all"),
        lyric("Speaking words of wisdom let it be"),
    ]
    timings = align_sheet_lines_to_segments(lines, SEGMENTS, duration=240.0)
    assert timings is not None
    assert timings[0] == (10.0, 14.0)
    assert timings[2] == (20.0, 24.0)
    mid = timings[1]
    assert mid is not None
    # Interpolated window must sit between the matched neighbors, in order.
    assert 14.0 <= mid[0] < mid[1] <= 20.0


def test_repeated_chorus_lines_stay_monotonic():
    segments = [
        seg(10.0, 13.0, "let it be let it be"),
        seg(14.0, 17.0, "let it be let it be"),
        seg(18.0, 21.0, "whisper words of wisdom"),
    ]
    lines = [
        lyric("Let it be, let it be"),
        lyric("Let it be, let it be"),
        lyric("Whisper words of wisdom"),
    ]
    timings = align_sheet_lines_to_segments(lines, segments, duration=60.0)
    assert timings is not None
    starts = [t[0] for t in timings if t]
    assert starts == sorted(starts)
    assert timings[0] == (10.0, 13.0)
    assert timings[1] == (14.0, 17.0)
    assert timings[2] == (18.0, 21.0)


def test_returns_none_when_sheet_does_not_match_lyrics():
    lines = [
        lyric("totally unrelated line one"),
        lyric("absolutely different line two"),
        lyric("nothing in common line three"),
    ]
    timings = align_sheet_lines_to_segments(lines, SEGMENTS, duration=240.0)
    assert timings is None


def test_returns_none_without_whisper_segments():
    assert align_sheet_lines_to_segments([lyric("a line")], [], duration=240.0) is None
