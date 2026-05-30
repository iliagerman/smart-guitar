"""Unit tests for bass-note / slash-chord helpers — no audio needed."""

from chords_generator.bass_detect import (
    PITCH_CLASS_NAMES,
    chord_root_pitch_class,
    slash_bass,
)


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
