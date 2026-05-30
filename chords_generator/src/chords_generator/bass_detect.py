"""Bass-note (slash-chord) detection from the isolated bass stem.

Autochord only emits plain major/minor chords, so it can't tell whether a chord
is in an inversion (e.g. C with a G in the bass = ``C/G``). We estimate the
sounding bass note per chord window from the separated bass stem and, when it
differs from the chord root, expose it as a slash bass so the player can show
``C/G``.
"""

from __future__ import annotations

import logging

from chords_generator.schemas import ChordResult

logger = logging.getLogger(__name__)

PITCH_CLASS_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_NOTE_TO_PC: dict[str, int] = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
    "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
}

# A bass window shorter than this (seconds) is too short to estimate reliably.
_MIN_SEGMENT_S = 0.25


def chord_root_pitch_class(label: str) -> int | None:
    """Pitch class (0=C .. 11=B) of a chord label's root, or None for no chord.

    Handles MIREX (``C:maj``, ``A:min``), plain (``C``, ``Am``, ``C#m7``) and
    slash (``C/G``) labels.
    """
    if not label or label == "N":
        return None
    root = label.split(":", 1)[0].split("/", 1)[0].strip()
    if not root:
        return None
    note = root[0].upper()
    if len(root) > 1 and root[1] in ("#", "b"):
        note += root[1]
    return _NOTE_TO_PC.get(note)


def slash_bass(label: str, bass_pc: int | None) -> str | None:
    """Bass note name when ``bass_pc`` differs from the chord root, else None.

    Returns None when the bass is unknown, matches the root (root position), or
    the label is not a real chord.
    """
    if bass_pc is None:
        return None
    root_pc = chord_root_pitch_class(label)
    if root_pc is None or bass_pc == root_pc:
        return None
    return PITCH_CLASS_NAMES[bass_pc]


def _dominant_pitch_class(y, sr: int, start: float, end: float) -> int | None:
    """Dominant pitch class of the bass stem within [start, end] seconds."""
    import librosa
    import numpy as np

    a = max(0, int(start * sr))
    b = min(len(y), int(end * sr))
    seg = y[a:b]
    if len(seg) < int(sr * _MIN_SEGMENT_S):
        return None
    chroma = librosa.feature.chroma_cqt(
        y=seg, sr=sr, fmin=librosa.note_to_hz("C1"), n_octaves=4,
    )
    if chroma.size == 0:
        return None
    return int(np.argmax(chroma.mean(axis=1)))


def detect_bass_for_chords(
    bass_audio_path: str, chords: list[ChordResult],
) -> list[ChordResult]:
    """Annotate each chord with a slash bass note from the bass stem.

    Mutates and returns ``chords`` (sets ``chord.bass``). Non-fatal: on any
    failure the chords are returned with ``bass`` left as None.
    """
    try:
        import librosa

        y, sr = librosa.load(bass_audio_path, mono=True)
    except Exception:
        logger.warning(
            "Bass-note detection failed to load %s (non-fatal)",
            bass_audio_path, exc_info=True,
        )
        return chords

    for chord in chords:
        try:
            bass_pc = _dominant_pitch_class(y, sr, chord.start_time, chord.end_time)
            chord.bass = slash_bass(chord.chord, bass_pc)
        except Exception:
            chord.bass = None
    return chords
