"""Unit tests for bass-note / slash-chord helpers — no audio needed."""

import chords_generator.bass_detect as bass_detect
from chords_generator.bass_detect import (
    PITCH_CLASS_NAMES,
    chord_root_pitch_class,
    chord_tone_pitch_classes,
    detect_bass_for_chords,
    select_windowed_bass_pitch_class,
    slash_bass,
)
from chords_generator.schemas import ChordResult


def test_root_pitch_class_mirex_labels():
    assert chord_root_pitch_class("C:maj") == 0
    assert chord_root_pitch_class("A:min") == 9
    assert chord_root_pitch_class("F#:maj") == 6
    assert chord_root_pitch_class("Bb:min") == 10


def test_root_pitch_class_plain_labels():
    assert chord_root_pitch_class("C") == 0
    assert chord_root_pitch_class("Am") == 9
    assert chord_root_pitch_class("C#m7") == 1
    assert chord_root_pitch_class("Gsus4") == 7


def test_root_pitch_class_no_chord():
    assert chord_root_pitch_class("N") is None
    assert chord_root_pitch_class("") is None


def test_slash_bass_returns_note_when_bass_differs_from_root():
    # C chord with G in the bass -> "C/G"
    g_pc = PITCH_CLASS_NAMES.index("G")
    assert slash_bass("C:maj", g_pc) == "G"


def test_slash_bass_none_when_bass_equals_root():
    c_pc = PITCH_CLASS_NAMES.index("C")
    assert slash_bass("C:maj", c_pc) is None


def test_slash_bass_none_when_bass_unknown_or_no_chord():
    assert slash_bass("C:maj", None) is None
    assert slash_bass("N", 7) is None


# ── chord_tone_pitch_classes ─────────────────────────────────────


def test_chord_tone_pitch_classes_major_triad():
    # C major: C(0), E(4), G(7)
    assert chord_tone_pitch_classes("C:maj") == {0, 4, 7}


def test_chord_tone_pitch_classes_minor_triad():
    # A minor: A(9), C(0), E(4)
    assert chord_tone_pitch_classes("A:min") == {9, 0, 4}


def test_chord_tone_pitch_classes_plain_label():
    assert chord_tone_pitch_classes("Bb") == {10, 2, 5}


def test_chord_tone_pitch_classes_no_chord():
    assert chord_tone_pitch_classes("N") is None
    assert chord_tone_pitch_classes("") is None


# ── select_windowed_bass_pitch_class ────────────────────────────
#
# Chord windows are split into sub-windows; each sub-window votes for a
# dominant pitch class. A candidate is only accepted as the bass note when it
# is either a chord tone or wins a majority of the sub-window votes — this
# stops a single passing note in one sub-window from producing a spurious
# slash chord.


def test_select_windowed_bass_picks_chord_tone_even_without_majority():
    # G(7) is a chord tone of C:maj and wins the plurality (3/8).
    votes = [7, 7, 7, 0, 0, 2, 1, 4]
    assert select_windowed_bass_pitch_class(votes, "C:maj") == 7


def test_select_windowed_bass_picks_sustained_non_chord_tone():
    # D(2) is not a chord tone of C:maj but dominates a majority (5/8).
    votes = [2, 2, 2, 2, 2, 0, 7, 4]
    assert select_windowed_bass_pitch_class(votes, "C:maj") == 2


def test_select_windowed_bass_rejects_brief_non_chord_tone_passing_note():
    # C#(1) is not a chord tone of C:maj and only wins a plurality (3/8),
    # short of a majority — a brief passing note, not a sustained bass note.
    votes = [1, 1, 1, 0, 0, 7, 4, 7]
    assert select_windowed_bass_pitch_class(votes, "C:maj") is None


def test_select_windowed_bass_no_votes_returns_none():
    assert select_windowed_bass_pitch_class([], "C:maj") is None


# ── detect_bass_for_chords: sub-window plumbing ─────────────────


def test_detect_bass_for_chords_splits_window_into_sub_windows(monkeypatch):
    """Each chord window is sampled in ~0.5s sub-windows, not one average."""
    monkeypatch.setattr(bass_detect, "_load_audio", lambda path: ([0.0], 22050))

    sub_window_calls: list[tuple[float, float]] = []

    def fake_dominant_pitch_class(y, sr, start, end):
        sub_window_calls.append((start, end))
        return 7  # every sub-window votes G

    monkeypatch.setattr(bass_detect, "_dominant_pitch_class", fake_dominant_pitch_class)

    chords = [ChordResult(start_time=0.0, end_time=2.0, chord="C:maj")]
    result = detect_bass_for_chords("fake.wav", chords)

    # 2.0s window / 0.5s sub-windows -> 4 sub-window calls, not 1.
    assert len(sub_window_calls) == 4
    assert result[0].bass == "G"


def test_detect_bass_for_chords_rejects_brief_passing_tone(monkeypatch):
    """A passing tone in a single sub-window must not produce a slash chord."""
    monkeypatch.setattr(bass_detect, "_load_audio", lambda path: ([0.0], 22050))

    # 8 sub-windows: mostly the root (C=0), one brief C#(1) passing tone.
    votes = iter([0, 0, 0, 1, 0, 0, 0, 0])

    def fake_dominant_pitch_class(y, sr, start, end):
        return next(votes)

    monkeypatch.setattr(bass_detect, "_dominant_pitch_class", fake_dominant_pitch_class)

    chords = [ChordResult(start_time=0.0, end_time=4.0, chord="C:maj")]
    result = detect_bass_for_chords("fake.wav", chords)

    assert result[0].bass is None
