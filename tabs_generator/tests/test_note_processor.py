"""Unit tests for note_processor — no model or audio files needed."""

from tabs_generator.note_processor import (
    filter_ghost_notes,
    filter_guitar_range,
    limit_polyphony,
    merge_fragmented_notes,
    post_process_notes,
)
from tabs_generator.schemas import NoteResult


def _note(
    midi: int = 60,
    start: float = 0.0,
    end: float = 0.5,
    confidence: float = 0.8,
) -> NoteResult:
    return NoteResult(
        start_time=start,
        end_time=end,
        midi_pitch=midi,
        amplitude=confidence,
        string=-1,
        fret=-1,
        confidence=confidence,
    )


# -- filter_ghost_notes --


def test_ghost_notes_removed():
    notes = [
        _note(start=0.0, end=0.5),    # 500ms — keep
        _note(start=1.0, end=1.02),    # 20ms — ghost
        _note(start=2.0, end=2.06),    # 60ms — keep
    ]
    result = filter_ghost_notes(notes, min_duration=0.05)
    assert len(result) == 2
    assert result[0].start_time == 0.0
    assert result[1].start_time == 2.0


def test_ghost_notes_empty_input():
    assert filter_ghost_notes([]) == []


# -- filter_guitar_range --


def test_range_filter_removes_low():
    notes = [_note(midi=30), _note(midi=60)]
    result = filter_guitar_range(notes, midi_min=40, midi_max=88)
    assert len(result) == 1
    assert result[0].midi_pitch == 60


def test_range_filter_removes_high():
    notes = [_note(midi=60), _note(midi=100)]
    result = filter_guitar_range(notes, midi_min=40, midi_max=88)
    assert len(result) == 1
    assert result[0].midi_pitch == 60


def test_range_filter_keeps_boundary():
    notes = [_note(midi=40), _note(midi=88)]
    result = filter_guitar_range(notes, midi_min=40, midi_max=88)
    assert len(result) == 2


# -- merge_fragmented_notes --


def test_merge_same_pitch_close_gap():
    notes = [
        _note(midi=60, start=0.0, end=0.5, confidence=0.7),
        _note(midi=60, start=0.52, end=1.0, confidence=0.9),  # 20ms gap
    ]
    result = merge_fragmented_notes(notes, gap_threshold=0.03)
    assert len(result) == 1
    assert result[0].start_time == 0.0
    assert result[0].end_time == 1.0
    assert result[0].confidence == 0.9  # keeps the higher confidence


def test_merge_different_pitch_not_merged():
    notes = [
        _note(midi=60, start=0.0, end=0.5),
        _note(midi=62, start=0.52, end=1.0),
    ]
    result = merge_fragmented_notes(notes, gap_threshold=0.03)
    assert len(result) == 2


def test_merge_same_pitch_large_gap():
    notes = [
        _note(midi=60, start=0.0, end=0.5),
        _note(midi=60, start=1.0, end=1.5),  # 500ms gap — distinct notes
    ]
    result = merge_fragmented_notes(notes, gap_threshold=0.03)
    assert len(result) == 2


def test_merge_empty():
    assert merge_fragmented_notes([]) == []


def test_merge_chain_of_fragments():
    """Three fragments of the same pitch should merge into one."""
    notes = [
        _note(midi=64, start=0.0, end=0.2),
        _note(midi=64, start=0.22, end=0.4),
        _note(midi=64, start=0.42, end=0.6),
    ]
    result = merge_fragmented_notes(notes, gap_threshold=0.03)
    assert len(result) == 1
    assert result[0].start_time == 0.0
    assert result[0].end_time == 0.6


# -- limit_polyphony --


def test_polyphony_within_limit():
    notes = [
        _note(midi=40, start=0.0, end=1.0, confidence=0.9),
        _note(midi=45, start=0.0, end=1.0, confidence=0.8),
    ]
    result = limit_polyphony(notes, max_voices=6)
    assert len(result) == 2


def test_polyphony_exceeds_limit():
    """8 simultaneous notes should be trimmed to 6, keeping highest confidence."""
    notes = [
        _note(midi=40 + i, start=0.0, end=1.0, confidence=0.5 + i * 0.05)
        for i in range(8)
    ]
    result = limit_polyphony(notes, max_voices=6)
    assert len(result) == 6
    # The two lowest-confidence notes should be removed
    confidences = [n.confidence for n in result]
    assert min(confidences) >= 0.6


def test_polyphony_empty():
    assert limit_polyphony([]) == []


# -- post_process_notes (full pipeline) --


def test_full_pipeline():
    notes = [
        _note(midi=60, start=0.0, end=0.5, confidence=0.8),     # keep
        _note(midi=30, start=1.0, end=1.5, confidence=0.8),     # out of range
        _note(midi=60, start=2.0, end=2.01, confidence=0.8),    # ghost
        _note(midi=60, start=3.0, end=3.5, confidence=0.3),     # low confidence
    ]
    result = post_process_notes(notes)
    assert len(result) == 1
    assert result[0].start_time == 0.0


def test_full_pipeline_empty():
    assert post_process_notes([]) == []
