"""Tests for the word-level alignment output used to time chords precisely.

`align_sheet_lines_with_words` extends the plain (start, end) window
alignment with the actual matched whisper words per line, so callers can
place chords and lyric words at their real timestamps instead of an even
split across the line window.
"""

from __future__ import annotations

from guitar_player.schemas.song import LyricsSegment, LyricsWord
from guitar_player.services.song_service.sheet_alignment import (
    align_sheet_lines_to_segments,
    align_sheet_lines_with_words,
)


def _seg(start: float, end: float, text: str) -> LyricsSegment:
    words = []
    tokens = text.split()
    dur = (end - start) / max(len(tokens), 1)
    for i, t in enumerate(tokens):
        words.append(LyricsWord(word=t, start=start + i * dur, end=start + (i + 1) * dur))
    return LyricsSegment(start=start, end=end, text=text, words=words)


def _lyric(text: str, chords: list[dict] | None = None) -> dict:
    return {"type": "lyric", "text": text, "chords": chords or []}


SEGMENTS = [
    _seg(10.0, 14.0, "When I find myself in times of trouble"),
    _seg(15.0, 19.0, "Mother Mary comes to me"),
    _seg(20.0, 24.0, "Speaking words of wisdom let it be"),
    _seg(30.0, 34.0, "And in my hour of darkness"),
]


def test_matched_line_exposes_its_whisper_words() -> None:
    """A directly-matched line's alignment carries the whisper words behind it."""
    lines = [
        _lyric("When I find myself in times of trouble"),
        _lyric("Mother Mary comes to me"),
    ]
    aligned = align_sheet_lines_with_words(lines, SEGMENTS, duration=240.0)
    assert aligned is not None
    first = aligned[0]
    assert first is not None
    assert first.start == 10.0
    assert first.end == 14.0
    assert first.words is not None
    assert [w.token for w in first.words] == "when i find myself in times of trouble".split()
    assert first.words[0].start == 10.0
    assert first.words[-1].end == 14.0


def test_gap_filled_line_has_no_words() -> None:
    """A line whose window comes from interpolation (no direct match) has words=None."""
    lines = [
        _lyric("When I find myself in times of trouble"),
        _lyric("completely different text matches nothing at all"),
        _lyric("Speaking words of wisdom let it be"),
    ]
    aligned = align_sheet_lines_with_words(lines, SEGMENTS, duration=240.0)
    assert aligned is not None
    assert aligned[0] is not None and aligned[0].words is not None
    assert aligned[2] is not None and aligned[2].words is not None
    mid = aligned[1]
    assert mid is not None
    assert mid.words is None


def test_non_timed_lines_remain_none() -> None:
    """Section/empty lines still have no alignment entry at all (not just no words)."""
    lines = [
        {"type": "section", "text": "Verse 1", "chords": []},
        _lyric("When I find myself in times of trouble"),
        {"type": "empty", "text": "", "chords": []},
    ]
    aligned = align_sheet_lines_with_words(lines, SEGMENTS, duration=240.0)
    assert aligned is not None
    assert aligned[0] is None
    assert aligned[2] is None
    assert aligned[1] is not None
    assert aligned[1].words is not None


def test_match_gate_behavior_matches_plain_window_function() -> None:
    """The 0.35 match-ratio gate is unchanged: both functions agree on None."""
    lines = [_lyric("nothing here matches the transcript whatsoever nope")]
    windows = align_sheet_lines_to_segments(lines, SEGMENTS, duration=240.0)
    aligned = align_sheet_lines_with_words(lines, SEGMENTS, duration=240.0)
    assert windows is None
    assert aligned is None


def test_words_and_plain_windows_agree_on_matched_lines() -> None:
    """The (start, end) window is identical whether or not words are requested."""
    lines = [
        _lyric("When I find myself in times of trouble"),
        _lyric("Mother Mary comes to me"),
        _lyric("Speaking words of wisdom let it be"),
    ]
    windows = align_sheet_lines_to_segments(lines, SEGMENTS, duration=240.0)
    aligned = align_sheet_lines_with_words(lines, SEGMENTS, duration=240.0)
    assert windows is not None
    assert aligned is not None
    for window, line_alignment in zip(windows, aligned):
        if window is None:
            assert line_alignment is None
        else:
            assert line_alignment is not None
            assert (line_alignment.start, line_alignment.end) == window
