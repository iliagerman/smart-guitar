"""Unit tests for beat alignment — no audio files or model needed."""

from chords_generator.beat_align import nearest_beat, snap_chords_to_beats
from chords_generator.schemas import ChordResult


def test_nearest_beat_picks_closest():
    beats = [0.0, 0.5, 1.0, 1.5, 2.0]
    assert nearest_beat(0.6, beats) == 0.5
    assert nearest_beat(0.8, beats) == 1.0
    assert nearest_beat(-1.0, beats) == 0.0
    assert nearest_beat(5.0, beats) == 2.0


def test_snap_returns_chords_unchanged_without_beats():
    chords = [ChordResult(0.0, 2.0, "C")]
    assert snap_chords_to_beats(chords, []) == chords


def test_snap_aligns_starts_to_beats_and_keeps_chords_contiguous():
    beats = [0.0, 1.0, 2.0, 3.0, 4.0]
    chords = [
        ChordResult(0.05, 1.1, "C"),
        ChordResult(1.1, 2.05, "G"),
        ChordResult(2.05, 3.9, "Am"),
    ]
    out = snap_chords_to_beats(chords, beats)

    assert [c.chord for c in out] == ["C", "G", "Am"]
    assert out[0].start_time == 0.0
    assert out[1].start_time == 1.0
    assert out[2].start_time == 2.0
    # Contiguous: each chord ends exactly where the next begins.
    assert out[0].end_time == 1.0
    assert out[1].end_time == 2.0


def test_snap_merges_consecutive_same_chord():
    beats = [0.0, 1.0, 2.0, 3.0]
    chords = [
        ChordResult(0.0, 1.0, "C"),
        ChordResult(1.0, 2.0, "C"),  # same chord across two beats -> merge
        ChordResult(2.0, 3.0, "G"),
    ]
    out = snap_chords_to_beats(chords, beats)

    assert [c.chord for c in out] == ["C", "G"]
    assert out[0].start_time == 0.0
    assert out[0].end_time == 2.0
    assert out[1].start_time == 2.0


def test_snap_collapses_two_changes_on_same_beat_keeping_first():
    beats = [0.0, 1.0, 2.0]
    chords = [
        ChordResult(0.95, 1.4, "C"),  # -> beat 1.0
        ChordResult(1.05, 2.0, "G"),  # also -> beat 1.0, dropped as sub-beat noise
    ]
    out = snap_chords_to_beats(chords, beats)

    assert [c.chord for c in out] == ["C"]
    assert out[0].start_time == 1.0
