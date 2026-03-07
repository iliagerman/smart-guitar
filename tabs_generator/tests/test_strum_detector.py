"""Unit tests for strum_detector — no model or audio files needed."""

from tabs_generator.schemas import NoteResult
from tabs_generator.strum_detector import (
    ChordInfo,
    _generate_beat_aligned_strums,
    _merge_strums,
    _OnsetStrum,
    _spearman_rank_correlation,
    detect_strums,
)


def _make_note(
    midi_pitch: int,
    start: float,
    end: float,
    string: int = -1,
    fret: int = -1,
) -> NoteResult:
    """Helper to create a NoteResult with defaults."""
    return NoteResult(
        start_time=start,
        end_time=end,
        midi_pitch=midi_pitch,
        amplitude=0.9,
        string=string,
        fret=fret,
        confidence=0.9,
    )


# -- Spearman rank correlation tests --


def test_spearman_perfect_positive():
    """Identical orderings should give correlation of 1.0."""
    assert _spearman_rank_correlation([1.0, 2.0, 3.0], [10.0, 20.0, 30.0]) == 1.0


def test_spearman_perfect_negative():
    """Reversed orderings should give correlation of -1.0."""
    assert _spearman_rank_correlation([1.0, 2.0, 3.0], [30.0, 20.0, 10.0]) == -1.0


def test_spearman_two_items_positive():
    """Two items in same order should give 1.0."""
    assert _spearman_rank_correlation([1.0, 2.0], [1.0, 2.0]) == 1.0


def test_spearman_two_items_negative():
    """Two items in reversed order should give -1.0."""
    assert _spearman_rank_correlation([1.0, 2.0], [2.0, 1.0]) == -1.0


def test_spearman_single_item():
    """Single item should return 0.0 (undefined correlation)."""
    assert _spearman_rank_correlation([1.0], [1.0]) == 0.0


def test_spearman_tied_ranks():
    """Tied values should use average ranks."""
    result = _spearman_rank_correlation([1.0, 2.0, 3.0], [10.0, 10.0, 30.0])
    assert result > 0.5


# -- Onset-only mode (no chords/beats passed) --


def test_down_strum_clear_onset_spread():
    """Notes hitting low strings first should be detected as down strum."""
    notes = [
        _make_note(40, start=1.000, end=1.500, string=0, fret=0),
        _make_note(45, start=1.003, end=1.500, string=1, fret=0),
        _make_note(50, start=1.006, end=1.500, string=2, fret=0),
        _make_note(55, start=1.009, end=1.500, string=3, fret=0),
        _make_note(59, start=1.012, end=1.500, string=4, fret=0),
        _make_note(64, start=1.015, end=1.500, string=5, fret=0),
    ]
    notes, strums = detect_strums(notes)
    assert len(strums) == 1
    assert strums[0].direction == "down"
    assert strums[0].confidence > 0.3
    assert strums[0].num_strings == 6
    assert all(n.strum_id == 0 for n in notes)


def test_up_strum_clear_onset_spread():
    """Notes hitting high strings first should be detected as up strum."""
    notes = [
        _make_note(64, start=2.000, end=2.500, string=5, fret=0),
        _make_note(59, start=2.003, end=2.500, string=4, fret=0),
        _make_note(55, start=2.006, end=2.500, string=3, fret=0),
        _make_note(50, start=2.009, end=2.500, string=2, fret=0),
        _make_note(45, start=2.012, end=2.500, string=1, fret=0),
        _make_note(40, start=2.015, end=2.500, string=0, fret=0),
    ]
    notes, strums = detect_strums(notes)
    assert len(strums) == 1
    assert strums[0].direction == "up"
    assert strums[0].confidence > 0.3
    assert strums[0].num_strings == 6


def test_ambiguous_simultaneous_onset():
    """Notes with identical start times should be ambiguous."""
    notes = [
        _make_note(40, start=3.000, end=3.500, string=0, fret=0),
        _make_note(45, start=3.000, end=3.500, string=1, fret=0),
        _make_note(50, start=3.000, end=3.500, string=2, fret=0),
    ]
    notes, strums = detect_strums(notes)
    assert len(strums) == 1
    assert strums[0].direction == "ambiguous"
    assert strums[0].confidence == 0.0


def test_ambiguous_very_small_spread():
    """Onset spread below min threshold should be ambiguous."""
    notes = [
        _make_note(40, start=4.000, end=4.500, string=0, fret=0),
        _make_note(45, start=4.0005, end=4.500, string=1, fret=0),
        _make_note(50, start=4.001, end=4.500, string=2, fret=0),
    ]
    notes, strums = detect_strums(notes)
    assert len(strums) == 1
    assert strums[0].direction == "ambiguous"


def test_single_note_no_strum():
    """Single notes should not be assigned a strum_id."""
    notes = [
        _make_note(40, start=5.0, end=5.5, string=0, fret=0),
        _make_note(45, start=6.0, end=6.5, string=1, fret=0),
    ]
    notes, strums = detect_strums(notes)
    assert len(strums) == 0
    assert all(n.strum_id is None for n in notes)


def test_two_note_down_strum():
    """A two-note power chord with clear onset order should detect direction."""
    notes = [
        _make_note(40, start=7.000, end=7.500, string=0, fret=0),
        _make_note(47, start=7.010, end=7.500, string=1, fret=2),
    ]
    notes, strums = detect_strums(notes)
    assert len(strums) == 1
    assert strums[0].direction == "down"
    assert strums[0].num_strings == 2


def test_mixed_strums_and_singles():
    """Sequence of chords and single notes should produce correct strum_ids."""
    notes = [
        _make_note(40, start=0.000, end=0.500, string=0, fret=0),
        _make_note(45, start=0.005, end=0.500, string=1, fret=0),
        _make_note(50, start=0.010, end=0.500, string=2, fret=0),
        _make_note(60, start=1.000, end=1.500, string=3, fret=5),
        _make_note(64, start=2.000, end=2.500, string=5, fret=0),
        _make_note(59, start=2.005, end=2.500, string=4, fret=0),
        _make_note(55, start=2.010, end=2.500, string=3, fret=0),
    ]
    notes, strums = detect_strums(notes)
    assert len(strums) == 2
    assert strums[0].direction == "down"
    assert notes[0].strum_id == 0
    assert notes[1].strum_id == 0
    assert notes[2].strum_id == 0
    assert notes[3].strum_id is None
    assert strums[1].direction == "up"
    assert notes[4].strum_id == 1
    assert notes[5].strum_id == 1
    assert notes[6].strum_id == 1


def test_strum_event_timing():
    """StrumEvent should have correct start_time and end_time."""
    notes = [
        _make_note(40, start=1.000, end=1.800, string=0, fret=0),
        _make_note(45, start=1.005, end=1.600, string=1, fret=0),
        _make_note(50, start=1.010, end=1.900, string=2, fret=0),
    ]
    notes, strums = detect_strums(notes)
    assert len(strums) == 1
    assert strums[0].start_time == 1.000
    assert strums[0].end_time == 1.900
    assert strums[0].onset_spread_ms == 10.0


def test_min_chord_size_filters_small_groups():
    """With min_chord_size=3, two-note chords should not produce strums."""
    notes = [
        _make_note(40, start=0.000, end=0.500, string=0, fret=0),
        _make_note(45, start=0.005, end=0.500, string=1, fret=0),
    ]
    notes, strums = detect_strums(notes, min_chord_size=3)
    assert len(strums) == 0
    assert all(n.strum_id is None for n in notes)


def test_empty_notes():
    """Empty notes list should produce no strums."""
    notes, strums = detect_strums([])
    assert len(strums) == 0
    assert len(notes) == 0


# -- Beat-aligned pattern generation tests --


def test_beat_aligned_basic():
    """Beat-aligned strums should generate D-U-D-U pattern at beat positions."""
    chords = [
        ChordInfo(start_time=0.0, end_time=2.0, chord="D:maj"),
    ]
    beat_times = [0.0, 0.5, 1.0, 1.5]
    strums = _generate_beat_aligned_strums(chords, beat_times, bpm=120.0)

    assert len(strums) == 4
    assert strums[0].direction == "down"
    assert strums[1].direction == "up"
    assert strums[2].direction == "down"
    assert strums[3].direction == "up"

    # Times should match beat positions
    assert strums[0].start_time == 0.0
    assert strums[1].start_time == 0.5
    assert strums[2].start_time == 1.0
    assert strums[3].start_time == 1.5


def test_beat_aligned_skips_n_chords():
    """Chords labelled 'N' (no chord) should not generate strums."""
    chords = [
        ChordInfo(start_time=0.0, end_time=1.0, chord="N"),
        ChordInfo(start_time=1.0, end_time=2.0, chord="A:min"),
    ]
    beat_times = [0.0, 0.5, 1.0, 1.5]
    strums = _generate_beat_aligned_strums(chords, beat_times, bpm=120.0)

    # Only beats in the A:min chord should generate strums
    assert len(strums) == 2
    assert all(s.start_time >= 1.0 for s in strums)


def test_beat_aligned_multiple_chords():
    """Each chord should reset the D-U pattern."""
    chords = [
        ChordInfo(start_time=0.0, end_time=1.0, chord="D:maj"),
        ChordInfo(start_time=1.0, end_time=2.0, chord="A:min"),
    ]
    beat_times = [0.0, 0.5, 1.0, 1.5]
    strums = _generate_beat_aligned_strums(chords, beat_times, bpm=120.0)

    assert len(strums) == 4
    # D:maj chord: D, U
    assert strums[0].direction == "down"
    assert strums[1].direction == "up"
    # A:min chord: resets to D, U
    assert strums[2].direction == "down"
    assert strums[3].direction == "up"


def test_beat_aligned_chord_with_no_beats():
    """A short chord with no beats inside should get a single down strum."""
    chords = [
        ChordInfo(start_time=0.5, end_time=0.8, chord="E:min"),
    ]
    beat_times = [0.0, 1.0]  # no beats between 0.5 and 0.8
    strums = _generate_beat_aligned_strums(chords, beat_times, bpm=120.0)

    assert len(strums) == 1
    assert strums[0].direction == "down"
    assert strums[0].start_time == 0.5
    assert strums[0].confidence == 0.5


def test_beat_aligned_empty_chords():
    """No chords should produce no strums."""
    strums = _generate_beat_aligned_strums([], [0.0, 0.5, 1.0], bpm=120.0)
    assert len(strums) == 0


def test_beat_aligned_empty_beats():
    """No beats should produce no strums."""
    chords = [ChordInfo(start_time=0.0, end_time=2.0, chord="D:maj")]
    strums = _generate_beat_aligned_strums(chords, [], bpm=120.0)
    assert len(strums) == 0


def test_beat_aligned_end_times():
    """Each strum's end_time should be the next beat or chord end."""
    chords = [
        ChordInfo(start_time=0.0, end_time=2.0, chord="D:maj"),
    ]
    beat_times = [0.0, 0.5, 1.0]
    strums = _generate_beat_aligned_strums(chords, beat_times, bpm=120.0)

    assert strums[0].end_time == 0.5   # next beat
    assert strums[1].end_time == 1.0   # next beat
    assert strums[2].end_time == 2.0   # chord end


# -- Merge tests --


def test_merge_onset_overrides_beat_direction():
    """Onset-detected direction should override beat-aligned direction."""
    from tabs_generator.schemas import StrumEvent

    beat_strums = [
        StrumEvent(id=0, start_time=0.0, end_time=0.5, direction="down",
                   confidence=0.5, num_strings=0, onset_spread_ms=0.0),
        StrumEvent(id=1, start_time=0.5, end_time=1.0, direction="up",
                   confidence=0.5, num_strings=0, onset_spread_ms=0.0),
    ]
    onset_strums = [
        _OnsetStrum(start_time=0.01, end_time=0.4, direction="up",
                    confidence=0.8, num_strings=4, onset_spread_ms=12.0,
                    note_indices=[0, 1, 2, 3]),
    ]

    merged = _merge_strums(beat_strums, onset_strums)

    assert len(merged) == 2
    # First strum overridden by onset (up instead of down)
    assert merged[0].direction == "up"
    assert merged[0].confidence > 0.5
    assert merged[0].num_strings == 4
    # Second strum unchanged (no onset match)
    assert merged[1].direction == "up"
    assert merged[1].confidence == 0.5


def test_merge_ambiguous_onset_not_used():
    """Ambiguous onset strums should not override beat-aligned directions."""
    from tabs_generator.schemas import StrumEvent

    beat_strums = [
        StrumEvent(id=0, start_time=0.0, end_time=0.5, direction="down",
                   confidence=0.5, num_strings=0, onset_spread_ms=0.0),
    ]
    onset_strums = [
        _OnsetStrum(start_time=0.01, end_time=0.4, direction="ambiguous",
                    confidence=0.0, num_strings=3, onset_spread_ms=1.0,
                    note_indices=[0, 1, 2]),
    ]

    merged = _merge_strums(beat_strums, onset_strums)
    assert merged[0].direction == "down"  # not overridden
    assert merged[0].confidence == 0.5


# -- Combined mode (chords + beats + notes) --


def test_combined_mode_full_coverage():
    """With chords and beats, every beat in every chord should get a strum."""
    chords = [
        ChordInfo(start_time=0.0, end_time=2.0, chord="D:maj"),
        ChordInfo(start_time=2.0, end_time=4.0, chord="A:min"),
    ]
    beat_times = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]

    # Some notes with onset evidence
    notes = [
        _make_note(40, start=0.000, end=0.500, string=0, fret=0),
        _make_note(45, start=0.005, end=0.500, string=1, fret=0),
        _make_note(50, start=0.010, end=0.500, string=2, fret=0),
    ]

    notes, strums = detect_strums(
        notes,
        chords=chords,
        beat_times=beat_times,
        bpm=120.0,
    )

    # Should have 8 strums (one per beat), not just the 1 from onset
    assert len(strums) == 8
    # All should have a direction (no ambiguous in beat-aligned mode)
    for s in strums:
        assert s.direction in ("down", "up")


def test_combined_mode_onset_overrides():
    """In combined mode, onset detection should override beat-aligned directions."""
    chords = [
        ChordInfo(start_time=0.0, end_time=2.0, chord="D:maj"),
    ]
    # Beat at t=0.0 should match the onset strum
    beat_times = [0.0, 0.5, 1.0, 1.5]

    # Up strum at t=0 (high strings first)
    notes = [
        _make_note(64, start=0.000, end=0.500, string=5, fret=0),
        _make_note(59, start=0.003, end=0.500, string=4, fret=0),
        _make_note(55, start=0.006, end=0.500, string=3, fret=0),
        _make_note(50, start=0.009, end=0.500, string=2, fret=0),
        _make_note(45, start=0.012, end=0.500, string=1, fret=0),
        _make_note(40, start=0.015, end=0.500, string=0, fret=0),
    ]

    notes, strums = detect_strums(
        notes,
        chords=chords,
        beat_times=beat_times,
        bpm=120.0,
    )

    assert len(strums) == 4
    # First beat should be overridden to "up" by onset detection
    assert strums[0].direction == "up"
    assert strums[0].confidence > 0.5  # boosted
    assert strums[0].num_strings == 6


def test_combined_mode_no_notes():
    """Combined mode with no notes should still produce beat-aligned strums."""
    chords = [
        ChordInfo(start_time=0.0, end_time=2.0, chord="G:maj"),
    ]
    beat_times = [0.0, 0.5, 1.0, 1.5]

    notes, strums = detect_strums(
        [],
        chords=chords,
        beat_times=beat_times,
        bpm=120.0,
    )

    assert len(strums) == 4
    assert strums[0].direction == "down"
    assert strums[1].direction == "up"


def test_fallback_without_chords():
    """Without chords, should fall back to onset-only mode."""
    notes = [
        _make_note(40, start=0.000, end=0.500, string=0, fret=0),
        _make_note(45, start=0.005, end=0.500, string=1, fret=0),
        _make_note(50, start=0.010, end=0.500, string=2, fret=0),
    ]
    notes, strums = detect_strums(notes)

    assert len(strums) == 1
    assert strums[0].direction == "down"
    assert notes[0].strum_id == 0


def test_fallback_without_beats():
    """With chords but no beats, should fall back to onset-only mode."""
    chords = [
        ChordInfo(start_time=0.0, end_time=2.0, chord="D:maj"),
    ]
    notes = [
        _make_note(40, start=0.000, end=0.500, string=0, fret=0),
        _make_note(45, start=0.005, end=0.500, string=1, fret=0),
        _make_note(50, start=0.010, end=0.500, string=2, fret=0),
    ]
    notes, strums = detect_strums(notes, chords=chords, beat_times=None)

    # Falls back to onset-only since beat_times is None
    assert len(strums) == 1
    assert strums[0].direction == "down"
