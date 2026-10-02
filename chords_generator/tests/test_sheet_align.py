"""Lining a community chord sheet up with the audio (synthetic probabilities, no model)."""

import numpy as np

from chords_generator.beat_decode import beat_steps
from chords_generator.chord_model import LABELS
from chords_generator.sheet_align import (
    align_sheet,
    best_alignment,
    parse_chord,
    sheet_sequence,
    transpose_name,
)

FRAME_S = 0.1
INDEX = {label: i for i, label in enumerate(LABELS)}


def _log_probs(segments: list[tuple[float, float, str]], duration: float, confidence: float = 0.6) -> np.ndarray:
    frames = int(round(duration / FRAME_S))
    rest = (1 - confidence) / (len(LABELS) - 1)
    probs = np.full((frames, len(LABELS)), rest)
    for start, end, label in segments:
        a, b = int(round(start / FRAME_S)), int(round(end / FRAME_S))
        probs[a:b] = rest
        probs[a:b, INDEX[label]] = confidence
    return np.log(probs)


def _sheet(*lines: str) -> list[dict]:
    return [{"type": "lyric", "text": "", "chords": [{"chord": c, "position": 0} for c in line.split()]} for line in lines]


def test_parse_and_transpose_written_chords():
    assert parse_chord("F#m7") == (6, "m7", None)
    assert parse_chord("C/G") == (0, "", 7)
    assert parse_chord("Bb") == (10, "", None)
    assert parse_chord("x2") is None
    assert transpose_name("Em7", 2) == ("F#m7", None)
    assert transpose_name("G/B", 2) == ("A", "C#")


def test_sheet_chords_land_on_the_beats_through_a_repeated_chorus_and_a_capo():
    # Played (sounding): verse D:min7 G:7 twice, chorus C:maj A:min three times; 1 bar each.
    played = ["D:min7", "G:7"] * 2 + ["C:maj", "A:min"] * 3
    beats = [0.5 * i for i in range(1, 4 * len(played) + 2)]
    segments = [(0.0, 0.5, "N")] + [(0.5 + 2.0 * i, 2.5 + 2.0 * i, c) for i, c in enumerate(played)]
    duration = 0.5 + 2.0 * len(played) + 0.5
    log_probs = _log_probs(segments + [(duration - 0.5, duration, "N")], duration)
    steps = beat_steps(log_probs, FRAME_S, beats, beats[::4], duration)
    # Written for capo 2 (two semitones down), each part once.
    sheet = sheet_sequence(_sheet("Cm7 F7", "Bb Gm"))

    alignment = align_sheet(steps, steps.log_probs, sheet, LABELS)

    assert alignment.transpose == 2
    assert alignment.accepted
    names = [c.chord for c in alignment.chords if c.chord != "N"]
    assert names == ["Dm7", "G7", "Dm7", "G7", "C", "Am", "C", "Am", "C", "Am"]
    assert alignment.chords[1].start_time == 0.5


def test_a_sheet_for_another_song_is_rejected():
    played = ["A:min", "E:min"] * 6
    beats = [0.5 * i for i in range(1, 4 * len(played) + 2)]
    duration = 0.5 + 2.0 * len(played) + 0.5
    segments = [(0.5 + 2.0 * i, 2.5 + 2.0 * i, c) for i, c in enumerate(played)]
    log_probs = _log_probs(segments, duration, confidence=0.9)
    steps = beat_steps(log_probs, FRAME_S, beats, beats[::4], duration)

    alignment = align_sheet(steps, steps.log_probs, sheet_sequence(_sheet("C G7 F#dim Bbmaj7 Ebm")), LABELS)

    assert not alignment.accepted


def test_best_alignment_picks_the_sheet_version_that_fits():
    played = ["G:maj", "D:maj", "E:min", "C:maj"] * 3
    beats = [0.5 * i for i in range(1, 4 * len(played) + 2)]
    duration = 0.5 + 2.0 * len(played) + 0.5
    log_probs = _log_probs([(0.5 + 2.0 * i, 2.5 + 2.0 * i, c) for i, c in enumerate(played)], duration)
    meta = {"beat_times": beats, "downbeat_times": beats[::4]}
    versions = [{"source_url": "wrong", "lines": _sheet("G D C Em")}, {"source_url": "right", "lines": _sheet("G D Em C")}]

    alignment, version = best_alignment(log_probs, FRAME_S, meta, versions, LABELS)

    assert version["source_url"] == "right"
    assert alignment.accepted
