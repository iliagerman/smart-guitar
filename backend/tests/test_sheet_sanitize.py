"""Tests for dropping mid-sheet junk shown as lyrics on UG chord sheets.

Two independent filters, both applied after `trim_sheet_preamble`:

1. ASCII guitar-tab lines (e.g. "e|--3--5--|") are dropped outright, or
   converted to a chordless-text `instrumental` line if they happen to
   carry chords (some UG sheets attach chords to a tab line).
2. Tabber commentary prose ("that's pretty much the song...") that never
   appears anywhere in the whisper transcript is dropped — but only when a
   transcript is available, and never for chord-bearing or short (<3 token)
   lines, so real (if oddly phrased) lyrics are never destroyed.
"""

from __future__ import annotations

from guitar_player.schemas.song import LyricsSegment, LyricsWord
from guitar_player.services.song_service.sheet_alignment import (
    _best_transcript_similarity,
    _drop_or_convert_tab_lines,
    _is_tab_ascii_line,
    sanitize_sheet_lines,
)


def _line(line_type: str, text: str = "", chords: list[dict] | None = None) -> dict:
    return {"type": line_type, "text": text, "chords": chords or []}


def _seg(start: float, end: float, text: str) -> LyricsSegment:
    tokens = text.split()
    dur = (end - start) / max(len(tokens), 1)
    words = [
        LyricsWord(word=t, start=start + i * dur, end=start + (i + 1) * dur)
        for i, t in enumerate(tokens)
    ]
    return LyricsSegment(start=start, end=end, text=text, words=words)


# ── _is_tab_ascii_line ──────────────────────────────────────────────


def test_single_string_tab_line_with_no_space_before_pipe_is_detected() -> None:
    assert _is_tab_ascii_line("e|----------------------------|--------------------------|")


def test_single_string_tab_line_with_space_before_pipe_is_detected() -> None:
    assert _is_tab_ascii_line("e |--------------------2|")


def test_multi_bar_tab_line_is_detected() -> None:
    assert _is_tab_ascii_line("G|----10-----10-----10---10--|-----10-----10-----10---10----|")


def test_tab_line_with_trailing_repeat_annotation_is_detected() -> None:
    assert _is_tab_ascii_line(
        "E|----------------------------|6-6-6-6-6-6-6-------------| x2"
    )


def test_real_lyric_with_hyphens_and_digits_is_not_a_tab_line() -> None:
    assert not _is_tab_ascii_line("1 2 3 4 count it in")


def test_chord_position_line_is_not_a_tab_line() -> None:
    """Single-dash chord-voicing notation (no long dash run) is a different
    kind of noise, handled elsewhere — not this detector's job."""
    assert not _is_tab_ascii_line("G     3-x-0-0-0-3")


def test_real_lyric_with_a_hyphenated_word_is_not_a_tab_line() -> None:
    assert not _is_tab_ascii_line("well-known place, hard-to-find road")


def test_empty_text_is_not_a_tab_line() -> None:
    assert not _is_tab_ascii_line("")


# ── sanitize_sheet_lines: tab-line filter (no transcript needed) ─────


def test_chordless_tab_lines_are_dropped() -> None:
    lines = [
        _line("lyric", "Verse", chords=[{"chord": "C", "position": 0}]),
        _line("lyric", "e|----------------------------|--------------------------|"),
        _line("lyric", "B|----------------------------|--------------------------|"),
        _line("lyric", "real lyric line here", chords=[{"chord": "G", "position": 0}]),
    ]
    sanitized = sanitize_sheet_lines(lines, segments=[])
    assert sanitized == [lines[0], lines[3]]


def test_chord_bearing_tab_line_is_converted_to_instrumental_not_dropped() -> None:
    """A tab line carrying real chords keeps its chords but loses the ASCII text."""
    lines = [
        _line(
            "lyric", "e |--------------------2|",
            chords=[
                {"chord": "G", "position": 8},
                {"chord": "Cadd9", "position": 14},
                {"chord": "D", "position": 23},
            ],
        ),
    ]
    sanitized = sanitize_sheet_lines(lines, segments=[])
    assert sanitized == [{
        "type": "instrumental",
        "text": "",
        "chords": [
            {"chord": "G", "position": 8},
            {"chord": "Cadd9", "position": 14},
            {"chord": "D", "position": 23},
        ],
    }]


def test_tab_filter_applies_even_without_a_transcript() -> None:
    lines = [_line("lyric", "e|-----------------------|")]
    assert sanitize_sheet_lines(lines, segments=[]) == []


# ── sanitize_sheet_lines: commentary filter (needs a transcript) ────


SEGMENTS = [
    _seg(10.0, 14.0, "and yet i find and yet i find"),
    _seg(15.0, 18.0, "repeating in my head"),
]


def test_commentary_never_sung_is_dropped() -> None:
    lines = [
        _line("lyric", "and yet i find and yet i find", chords=[{"chord": "Em", "position": 0}]),
        _line("lyric", "that's pretty much the song, he does some"),
        _line("lyric", "hammer ons on the C looks something like"),
        _line("lyric", "repeating in my head", chords=[{"chord": "G", "position": 0}]),
    ]
    sanitized = sanitize_sheet_lines(lines, SEGMENTS)
    assert sanitized == [lines[0], lines[3]]


def test_real_lyric_that_happens_to_repeat_words_is_kept() -> None:
    """Regression guard: a real (if repetitive-looking) lyric line that IS in
    the transcript must never be mistaken for commentary."""
    lines = [_line("lyric", "repeating in my head")]
    sanitized = sanitize_sheet_lines(lines, SEGMENTS)
    assert sanitized == lines


def test_chord_bearing_lines_are_never_dropped_as_commentary() -> None:
    """Even wildly off-transcript text is kept if it carries a chord — it's
    real (if garbled) sheet content, not tabber prose."""
    lines = [_line("lyric", "totally unrelated to anything sung", chords=[{"chord": "C", "position": 0}])]
    assert sanitize_sheet_lines(lines, SEGMENTS) == lines


def test_short_lines_under_three_tokens_are_kept() -> None:
    """Ad-libs like 'oh yeah' or 'la la' are short and never checked against
    the transcript, so they're never mistakenly dropped."""
    lines = [_line("lyric", "oh yeah")]
    assert sanitize_sheet_lines(lines, SEGMENTS) == lines


def test_commentary_filter_is_skipped_without_a_transcript() -> None:
    """No whisper segments at all -> filter 2 never runs (nothing to compare
    against), only the tab-ascii filter still applies."""
    lines = [_line("lyric", "that's pretty much the song, he does some hammer ons")]
    assert sanitize_sheet_lines(lines, segments=[]) == lines


def test_non_lyric_lines_are_never_checked_for_commentary() -> None:
    lines = [
        _line("section", "Verse"),
        _line("empty"),
        _line("instrumental", "", chords=[{"chord": "C", "position": 0}]),
    ]
    assert sanitize_sheet_lines(lines, SEGMENTS) == lines


# ── _best_transcript_similarity boundary ─────────────────────────────


def test_similarity_is_high_for_a_line_taken_verbatim_from_the_transcript() -> None:
    transcript_words = [w for seg in SEGMENTS for w in seg.words]
    from guitar_player.services.song_service.sheet_alignment import TimedWord, tokenize

    transcript = [TimedWord(token=t, start=w.start, end=w.end) for w in transcript_words for t in tokenize(w.word)]
    score = _best_transcript_similarity(tokenize("repeating in my head"), transcript)
    assert score > 0.9


def test_similarity_is_low_for_text_absent_from_the_transcript() -> None:
    transcript_words = [w for seg in SEGMENTS for w in seg.words]
    from guitar_player.services.song_service.sheet_alignment import TimedWord, tokenize

    transcript = [TimedWord(token=t, start=w.start, end=w.end) for w in transcript_words for t in tokenize(w.word)]
    score = _best_transcript_similarity(
        tokenize("that's pretty much the song he does some hammer ons"), transcript,
    )
    assert score < 0.45


def test_similarity_is_zero_for_empty_transcript() -> None:
    assert _best_transcript_similarity(["some", "words"], []) == 0.0


# ── sustained-note lyrics must never be classified as tab ──────────────


def test_sustained_note_lyric_with_dash_run_is_not_a_tab_line() -> None:
    """UG sheets draw held syllables as dash runs; that's a lyric, not tab."""
    assert not _is_tab_ascii_line("                  ...Fly---------------------------!")


def test_repeated_oh_lyric_with_dash_runs_is_not_a_tab_line() -> None:
    assert not _is_tab_ascii_line("(Now I'm... Oh, oh-----, oh, oh----------!)")


def test_sustained_lyric_with_chords_keeps_its_text() -> None:
    """A chord-bearing sustained-note lyric must not be stripped to an
    instrumental line — the sung word has to stay on the sheet."""
    lines = [
        {
            "type": "lyric",
            "text": "...Fly---------------------------!",
            "chords": [{"chord": "C", "position": 0}, {"chord": "Em/B", "position": 10}],
        },
    ]
    result = _drop_or_convert_tab_lines(lines)
    assert result == lines
