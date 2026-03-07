"""Unit tests for tab_converter — no model or audio files needed."""

import json
import os
import tempfile

from tabs_generator.schemas import NoteResult
from tabs_generator.tab_converter import (
    STANDARD_TUNING,
    assign_fret_positions,
    convert_to_tabs,
    get_possible_positions,
)


def _make_note(midi_pitch: int, start: float = 0.0, end: float = 0.1) -> NoteResult:
    """Helper to create a NoteResult with defaults."""
    return NoteResult(
        start_time=start,
        end_time=end,
        midi_pitch=midi_pitch,
        amplitude=0.9,
        string=-1,
        fret=-1,
        confidence=0.9,
    )


def test_get_possible_positions_open_e():
    """MIDI 40 (E2) should be playable as open low-E string."""
    positions = get_possible_positions(40)
    assert (0, 0) in positions  # string 0, fret 0


def test_get_possible_positions_middle_c():
    """MIDI 60 (C4) should be reachable on multiple strings."""
    positions = get_possible_positions(60)
    assert len(positions) > 1
    # All positions must produce MIDI 60
    for string_idx, fret in positions:
        assert STANDARD_TUNING[string_idx] + fret == 60


def test_get_possible_positions_out_of_range():
    """MIDI 30 is below any standard tuning string — no valid positions."""
    positions = get_possible_positions(30)
    assert positions == []


def test_assign_prefers_lower_frets():
    """Starting from default hand position near fret 3, should prefer lower frets."""
    notes = [_make_note(45)]  # A2 = string 1 fret 0, or string 0 fret 5
    assign_fret_positions(notes)
    # Should pick string 1, fret 0 (closer to hand at ~3, with low-fret bias)
    assert notes[0].string == 1
    assert notes[0].fret == 0


def test_assign_tracks_hand_position():
    """Sequential notes at higher frets should pull hand position up."""
    notes = [
        _make_note(52, start=0.0, end=0.1),  # E3 = string 0 fret 12, string 1 fret 7, etc.
        _make_note(53, start=0.2, end=0.3),  # F3 = string 0 fret 13, string 1 fret 8, etc.
    ]
    assign_fret_positions(notes)
    # Both should be assigned valid positions
    assert notes[0].fret >= 0
    assert notes[1].fret >= 0
    # Second note should be near the first (within a few frets)
    assert abs(notes[1].fret - notes[0].fret) <= 3


def test_assign_open_strings_dont_move_hand():
    """Open string notes (fret 0) should not shift hand position."""
    notes = [
        _make_note(55, start=0.0, end=0.1),  # G3 = string 3 fret 0
        _make_note(40, start=0.2, end=0.3),  # E2 = string 0 fret 0
        _make_note(45, start=0.4, end=0.5),  # A2 = string 1 fret 0
    ]
    assign_fret_positions(notes)
    # All should be assigned to open strings (fret 0)
    for n in notes:
        assert n.fret == 0


def test_convert_to_tabs_writes_json():
    """Full pipeline should write a valid tabs.json."""
    notes = [
        _make_note(40, start=0.0, end=0.5),
        _make_note(45, start=0.5, end=1.0),
        _make_note(50, start=1.0, end=1.5),
    ]

    with tempfile.TemporaryDirectory() as tmpdir:
        result = convert_to_tabs(notes, tmpdir)

        json_path = os.path.join(tmpdir, "tabs.json")
        assert os.path.isfile(json_path)

        with open(json_path) as f:
            data = json.load(f)

        assert "tuning" in data
        assert "notes" in data
        assert len(data["notes"]) == 3
        # Each note should have string/fret assigned
        for note in data["notes"]:
            assert note["string"] >= 0
            assert note["fret"] >= 0


def test_convert_empty_notes():
    """Empty notes list should produce valid output with empty notes array."""
    with tempfile.TemporaryDirectory() as tmpdir:
        result = convert_to_tabs([], tmpdir)

        json_path = os.path.join(tmpdir, "tabs.json")
        assert os.path.isfile(json_path)

        with open(json_path) as f:
            data = json.load(f)

        assert data["tuning"] == ["E2", "A2", "D3", "G3", "B3", "E4"]
        assert data["notes"] == []


# -- Chord grouping tests --


def test_chord_no_string_conflicts():
    """Simultaneous notes should never be assigned to the same string."""
    # E2 + A2 + D3 played together (open strings)
    notes = [
        _make_note(40, start=0.0, end=0.5),  # E2
        _make_note(45, start=0.0, end=0.5),  # A2
        _make_note(50, start=0.0, end=0.5),  # D3
    ]
    assign_fret_positions(notes)
    strings = [n.string for n in notes]
    assert len(set(strings)) == len(strings), "String conflict in chord"


def test_chord_within_hand_span():
    """Fretted notes in a chord should be within a 5-fret span."""
    # C4 + E4 + G4 (a C major triad in higher register)
    notes = [
        _make_note(60, start=0.0, end=0.5),  # C4
        _make_note(64, start=0.0, end=0.5),  # E4
        _make_note(67, start=0.0, end=0.5),  # G4
    ]
    assign_fret_positions(notes)
    frets = [n.fret for n in notes if n.fret > 0]
    if frets:
        assert max(frets) - min(frets) <= 5, f"Hand span too wide: {frets}"


def test_chord_six_notes_no_conflict():
    """A full 6-note chord should have all unique strings."""
    # Standard open E major: E2, B2, E3, G#3, B3, E4
    notes = [
        _make_note(40, start=0.0, end=0.5),  # E2
        _make_note(47, start=0.0, end=0.5),  # B2
        _make_note(52, start=0.0, end=0.5),  # E3
        _make_note(56, start=0.0, end=0.5),  # G#3
        _make_note(59, start=0.0, end=0.5),  # B3
        _make_note(64, start=0.0, end=0.5),  # E4
    ]
    assign_fret_positions(notes)
    strings = [n.string for n in notes if n.string >= 0]
    assert len(set(strings)) == len(strings), "String conflict in 6-note chord"


def test_sequential_not_grouped_as_chord():
    """Notes with different start times beyond tolerance should not be grouped."""
    notes = [
        _make_note(60, start=0.0, end=0.5),
        _make_note(64, start=0.5, end=1.0),  # 500ms later — separate
    ]
    assign_fret_positions(notes)
    # Both should get valid assignments (no constraint needed between them)
    assert notes[0].string >= 0
    assert notes[1].string >= 0
