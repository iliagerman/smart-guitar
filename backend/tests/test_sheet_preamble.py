"""Tests for trimming non-song preamble from Ultimate Guitar chord sheets.

UG sheets often open with metadata ("Song: ...", "Tabbed by ...", YouTube
links) and playing notes ("strumming is constant", "capo: 3rd fret") as
plain lyric/empty lines with no chords, before the first real chord line.
`trim_sheet_preamble` drops that preamble so it never pollutes the displayed
sheet or the whisper lyric-alignment gate.
"""

from __future__ import annotations

from guitar_player.services.song_service.sheet_alignment import trim_sheet_preamble


def _line(line_type: str, text: str = "", chords: list[dict] | None = None) -> dict:
    return {"type": line_type, "text": text, "chords": chords or []}


def test_preamble_prose_before_first_chord_is_removed() -> None:
    """Metadata/notes lines with no chords, before the first chord line, are dropped."""
    lines = [
        _line("lyric", "Song: Let It Be"),
        _line("lyric", "Artist: The Beatles"),
        _line("lyric", "Tabbed by: someone"),
        _line("empty"),
        _line("lyric", "When I find myself", chords=[{"chord": "C", "position": 0}]),
    ]
    trimmed = trim_sheet_preamble(lines)
    assert trimmed == [lines[4]]


def test_leading_section_header_immediately_before_first_chord_is_kept() -> None:
    """A section header (e.g. 'Intro') labeling the first real content stays,
    along with any empty lines between it and the first chord line."""
    lines = [
        _line("lyric", "Song: Let It Be"),
        _line("empty"),
        _line("section", "Intro"),
        _line("empty"),
        _line("instrumental", "", chords=[{"chord": "C", "position": 0}]),
    ]
    trimmed = trim_sheet_preamble(lines)
    assert trimmed == lines[2:]


def test_empty_lines_before_kept_section_header_are_dropped() -> None:
    lines = [
        _line("empty"),
        _line("lyric", "capo: 3rd fret"),
        _line("empty"),
        _line("section", "Verse 1"),
        _line("lyric", "Hello darkness", chords=[{"chord": "Am", "position": 0}]),
    ]
    trimmed = trim_sheet_preamble(lines)
    assert trimmed == lines[3:]


def test_no_chord_sheet_returned_unchanged() -> None:
    """A sheet with no chords at all (tab-only or malformed) is never blanked."""
    lines = [
        _line("lyric", "Song: Something"),
        _line("lyric", "just some lyrics with no chords"),
    ]
    trimmed = trim_sheet_preamble(lines)
    assert trimmed == lines


def test_sheet_already_starting_on_a_chord_is_unchanged() -> None:
    lines = [
        _line("lyric", "When I find myself", chords=[{"chord": "C", "position": 0}]),
        _line("lyric", "in times of trouble"),
    ]
    trimmed = trim_sheet_preamble(lines)
    assert trimmed == lines


def test_section_header_not_immediately_before_first_chord_is_dropped() -> None:
    """A section header that isn't directly (modulo empties) adjacent to the
    first chord line is just preamble too and gets dropped with it."""
    lines = [
        _line("section", "Tuning: Standard"),
        _line("lyric", "Tabbed by: someone"),
        _line("empty"),
        _line("lyric", "real lyric line", chords=[{"chord": "G", "position": 0}]),
    ]
    trimmed = trim_sheet_preamble(lines)
    assert trimmed == [lines[3]]


def test_empty_sheet_returned_unchanged() -> None:
    assert trim_sheet_preamble([]) == []


def test_non_dict_line_in_preamble_does_not_crash() -> None:
    """A malformed non-dict entry before the first chord must not raise."""
    lines: list = [
        None,
        _line("empty"),
        _line("lyric", "verse", chords=[{"chord": "C", "position": 0}]),
    ]
    trimmed = trim_sheet_preamble(lines)
    assert trimmed == [lines[2]]
