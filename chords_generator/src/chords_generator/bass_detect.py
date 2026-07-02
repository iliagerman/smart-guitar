"""Bass-note (slash-chord) detection from the isolated bass stem.

Autochord only emits plain major/minor chords, so it can't tell whether a chord
is in an inversion (e.g. C with a G in the bass = ``C/G``). We estimate the
sounding bass note per chord window from the separated bass stem and, when it
differs from the chord root, expose it as a slash bass so the player can show
``C/G``.
"""

from __future__ import annotations

import logging
from collections import Counter

from chords_generator.schemas import ChordResult
from chords_generator.simplifier import mirex_to_pychord

logger = logging.getLogger(__name__)

PITCH_CLASS_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_NOTE_TO_PC: dict[str, int] = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
    "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
}

# A bass window shorter than this (seconds) is too short to estimate reliably.
_MIN_SEGMENT_S = 0.25

# Chord windows are sampled in sub-windows of this size so a single passing
# note can't dominate a whole-window chroma average.
_SUB_WINDOW_S = 0.5

# A candidate bass note that isn't a chord tone still counts as a genuine
# (sustained) bass note when it wins at least this fraction of sub-windows.
_SUSTAIN_MAJORITY = 0.5


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


def chord_tone_pitch_classes(label: str) -> set[int] | None:
    """Pitch classes of every note in the chord (root + all components).

    Handles MIREX (``C:maj``), plain (``Am``, ``C#m7``) and slash (``C/G``)
    labels. Returns None for "N" or a label that can't be parsed.
    """
    if not label or label == "N":
        return None
    pychord_name = mirex_to_pychord(label) if ":" in label else label.split("/", 1)[0]
    if not pychord_name:
        return None
    try:
        from pychord import Chord

        components = Chord(pychord_name).components()
    except Exception:
        logger.debug("Could not parse chord tones for %r", label, exc_info=True)
        return None
    pcs = {_NOTE_TO_PC[note] for note in components if note in _NOTE_TO_PC}
    return pcs or None


def select_windowed_bass_pitch_class(
    sub_window_pitch_classes: list[int], chord: str,
) -> int | None:
    """Pick the bass pitch class for a chord window from per-sub-window votes.

    The winning (most frequent) pitch class is only accepted when it is
    either a chord tone of ``chord`` or dominates a majority of sub-windows —
    a genuinely sustained bass note. This stops a single passing note in one
    sub-window from producing a spurious inversion.
    """
    if not sub_window_pitch_classes:
        return None
    candidate_pc, count = Counter(sub_window_pitch_classes).most_common(1)[0]
    chord_tones = chord_tone_pitch_classes(chord)
    is_chord_tone = chord_tones is not None and candidate_pc in chord_tones
    is_sustained_majority = count / len(sub_window_pitch_classes) >= _SUSTAIN_MAJORITY
    if not (is_chord_tone or is_sustained_majority):
        return None
    return candidate_pc


def _load_audio(path: str):
    import librosa

    return librosa.load(path, mono=True)


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


def _sub_window_pitch_classes(
    y, sr: int, start: float, end: float,
) -> list[int]:
    """Dominant pitch class of each ``_SUB_WINDOW_S`` slice of [start, end]."""
    pcs: list[int] = []
    t = start
    while t < end:
        sub_end = min(t + _SUB_WINDOW_S, end)
        pc = _dominant_pitch_class(y, sr, t, sub_end)
        if pc is not None:
            pcs.append(pc)
        t = sub_end
    return pcs


def detect_bass_for_chords(
    bass_audio_path: str, chords: list[ChordResult],
) -> list[ChordResult]:
    """Annotate each chord with a slash bass note from the bass stem.

    Each chord window is sampled in sub-windows (see ``_SUB_WINDOW_S``) and
    the bass pitch class is chosen by ``select_windowed_bass_pitch_class``,
    so a brief passing note can't outweigh the sustained bass note. Mutates
    and returns ``chords`` (sets ``chord.bass``). Non-fatal: on any failure
    the chords are returned with ``bass`` left as None.
    """
    try:
        y, sr = _load_audio(bass_audio_path)
    except Exception:
        logger.warning(
            "Bass-note detection failed to load %s (non-fatal)",
            bass_audio_path, exc_info=True,
        )
        return chords

    for chord in chords:
        try:
            sub_window_pcs = _sub_window_pitch_classes(y, sr, chord.start_time, chord.end_time)
            bass_pc = select_windowed_bass_pitch_class(sub_window_pcs, chord.chord)
            chord.bass = slash_bass(chord.chord, bass_pc)
        except Exception:
            chord.bass = None
    return chords
