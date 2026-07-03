"""Tests for word-accurate chord/lyric timing on synced community sheets.

When a sheet line was directly matched to the transcript, `detail.py` maps
its display words to the real whisper word timestamps (instead of an even
split of the line window), and places each chord at the start time of the
display word its character position falls on.
"""

from __future__ import annotations

import pytest

from guitar_player.services.song_service.detail import (
    _chord_starts_from_words,
    _map_words_to_whisper_times,
    _static_lines_to_chord_option,
    _word_spans,
)
from guitar_player.services.song_service.sheet_alignment import TimedWord


def test_word_spans_match_whitespace_split_positions() -> None:
    """Char spans line up with text.split() word order and boundaries."""
    text = "hello there world"
    spans = _word_spans(text)
    assert [text[s:e] for s, e in spans] == ["hello", "there", "world"]
    assert spans == [(0, 5), (6, 11), (12, 17)]


def test_matched_display_words_get_real_whisper_times() -> None:
    """Every display word that matches a whisper token gets its exact window."""
    whisper_words = [
        TimedWord(token="hello", start=10.0, end=10.5),
        TimedWord(token="there", start=10.5, end=11.2),
        TimedWord(token="world", start=11.2, end=12.0),
    ]
    times = _map_words_to_whisper_times(
        ["hello", "there", "world"], whisper_words, line_start=10.0, line_end=12.0,
    )
    assert times == [(10.0, 10.5), (10.5, 11.2), (11.2, 12.0)]


def test_unmatched_middle_word_interpolates_between_neighbors() -> None:
    """A display word absent from the whisper transcript gets an interpolated slot."""
    whisper_words = [
        TimedWord(token="hello", start=10.0, end=10.5),
        TimedWord(token="world", start=11.5, end=12.0),
    ]
    times = _map_words_to_whisper_times(
        ["hello", "mumbled", "world"], whisper_words, line_start=10.0, line_end=12.0,
    )
    assert times[0] == (10.0, 10.5)
    assert times[2] == (11.5, 12.0)
    mid_start, mid_end = times[1]
    assert 10.5 <= mid_start < mid_end <= 11.5


def test_word_times_are_non_decreasing_within_the_line() -> None:
    whisper_words = [
        TimedWord(token="a", start=1.0, end=1.2),
        TimedWord(token="c", start=2.0, end=2.4),
    ]
    times = _map_words_to_whisper_times(
        ["a", "b", "c", "d"], whisper_words, line_start=0.0, line_end=3.0,
    )
    flat = [t for pair in times for t in pair]
    assert flat == sorted(flat)


def test_chord_at_char_position_gets_its_words_start_time() -> None:
    """A chord positioned inside a word's char span starts at that word's time."""
    spans = _word_spans("hello there world")
    word_times = [(10.0, 10.5), (10.5, 11.2), (11.2, 12.0)]
    raw_chords = [{"chord": "C", "position": 8}]  # inside "there" (chars 6-11)
    starts = _chord_starts_from_words(raw_chords, spans, word_times)
    assert starts == [10.5]


def test_two_chords_on_one_word_distribute_strictly_increasing() -> None:
    spans = _word_spans("hello there world")
    word_times = [(10.0, 10.8), (10.8, 11.2), (11.2, 12.0)]
    raw_chords = [{"chord": "C", "position": 0}, {"chord": "G", "position": 3}]
    starts = _chord_starts_from_words(raw_chords, spans, word_times)
    assert starts[0] < starts[1]
    assert 10.0 <= starts[0] < 10.8
    assert 10.0 <= starts[1] < 10.8


def test_chords_on_zero_span_word_stay_strictly_increasing() -> None:
    """A whisper word with start == end must not collapse chord starts."""
    spans = _word_spans("hello there world")
    word_times = [(10.0, 10.0), (10.0, 11.2), (11.2, 12.0)]
    raw_chords = [{"chord": "C", "position": 0}, {"chord": "G", "position": 3}]
    starts = _chord_starts_from_words(raw_chords, spans, word_times)
    assert starts[0] < starts[1]

def test_trailing_chord_position_clamps_to_last_word() -> None:
    spans = _word_spans("hello there world")
    word_times = [(10.0, 10.5), (10.5, 11.2), (11.2, 12.0)]
    raw_chords = [{"chord": "Am", "position": 999}]
    starts = _chord_starts_from_words(raw_chords, spans, word_times)
    assert starts == [11.2]


@pytest.mark.asyncio
async def test_static_lines_to_chord_option_uses_word_times_end_to_end() -> None:
    """Full pipeline: a matched line's chords/lyrics land on real whisper times."""
    text = "hello there world"
    lines = [{
        "type": "lyric",
        "text": text,
        "chords": [
            {"chord": "C", "position": 0},
            {"chord": "G", "position": 8},
        ],
    }]
    whisper_words = [
        TimedWord(token="hello", start=10.0, end=10.5),
        TimedWord(token="there", start=10.5, end=11.2),
        TimedWord(token="world", start=11.2, end=12.0),
    ]
    option = _static_lines_to_chord_option(
        lines, duration=240.0, name="Sheet 1",
        line_windows=[(10.0, 12.0)],
        line_words=[whisper_words],
    )
    assert option.lyrics_synced is True
    by_chord = {c.chord: c for c in option.chords}
    assert by_chord["C"].start_time == 10.0
    assert by_chord["G"].start_time == 10.5
    assert by_chord["C"].end_time == 10.5
    assert by_chord["G"].end_time == 12.0

    assert len(option.lyrics) == 1
    words = option.lyrics[0].words
    assert [w.word for w in words] == ["hello", "there", "world"]
    assert words[0].start == 10.0
    assert words[0].end == 10.5
    assert words[2].end == 12.0


def test_static_lines_to_chord_option_without_words_is_unchanged() -> None:
    """Regression: no `line_words` means the old char-fraction placement, byte-identical."""
    text = "When I find myself in times of trouble"  # len 39
    lines = [{
        "type": "lyric",
        "text": text,
        "chords": [
            {"chord": "C", "position": 0},
            {"chord": "Am", "position": 30},
        ],
    }]
    option = _static_lines_to_chord_option(
        lines, duration=240.0, name="Sheet 1",
        line_windows=[(42.0, 46.5)],
    )
    by_name = {c.chord: c for c in option.chords}
    assert by_name["C"].start_time == pytest.approx(42.0, abs=0.15)
    assert by_name["Am"].start_time == pytest.approx(42.0 + (30 / 39) * 4.5, abs=0.3)
