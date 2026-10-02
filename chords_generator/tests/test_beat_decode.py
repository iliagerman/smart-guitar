"""Tests for deciding chords on the tracked beat grid (no model needed)."""

import numpy as np

from chords_generator.beat_decode import bar_positions, beats_per_bar, decode_chords_on_beats

FRAME_S = 0.1
LABELS = ["C:maj", "G:maj", "A:min", "N"]


def _log_probs(segments: list[tuple[float, float, int]], duration: float, confidence: float = 0.9) -> np.ndarray:
    """Frame log-probabilities favouring label index ``k`` over each (start, end, k)."""
    frames = int(round(duration / FRAME_S))
    probs = np.full((frames, len(LABELS)), (1 - confidence) / (len(LABELS) - 1))
    for start, end, k in segments:
        a, b = int(round(start / FRAME_S)), int(round(end / FRAME_S))
        probs[a:b] = (1 - confidence) / (len(LABELS) - 1)
        probs[a:b, k] = confidence
    return np.log(probs)


def test_beats_per_bar_counts_beats_between_downbeats():
    beats = [i * 0.5 for i in range(24)]
    assert beats_per_bar(beats, beats[::4]) == 4
    assert beats_per_bar(beats, beats[::3]) == 3
    assert beats_per_bar(beats, []) == 4


def test_bar_positions_count_back_before_the_first_downbeat_and_restart_on_each():
    beats = [i * 0.5 for i in range(10)]
    # Pickup beat, a 4-beat bar, a 2-beat bar, then another bar.
    downbeats = [0.5, 2.5, 3.5]
    assert bar_positions(beats, downbeats, 4) == [3, 0, 1, 2, 3, 0, 1, 0, 1, 2]


def test_chord_changes_land_on_beats_even_when_the_audio_changes_between_them():
    beats = [i * 0.5 for i in range(1, 16)]
    downbeats = beats[::4]
    # The audio changes chord 0.15 s after the downbeat at 2.5 s.
    log_probs = _log_probs([(0.0, 2.65, 0), (2.65, 8.0, 1)], 8.0)
    chords = decode_chords_on_beats(log_probs, LABELS, FRAME_S, beats, downbeats, 8.0)
    assert [(c.start_time, c.chord) for c in chords] == [(0.0, "C:maj"), (2.5, "G:maj")]
    assert chords[-1].end_time == 8.0


def test_a_one_beat_flicker_off_the_strong_beats_is_ignored():
    beats = [i * 0.5 for i in range(1, 16)]
    downbeats = beats[::4]
    # A:min for one off-beat beat (3.0-3.5 s) inside a held C:maj.
    log_probs = _log_probs([(0.0, 8.0, 0), (3.0, 3.5, 2)], 8.0, confidence=0.6)
    chords = decode_chords_on_beats(log_probs, LABELS, FRAME_S, beats, downbeats, 8.0)
    assert [c.chord for c in chords] == ["C:maj"]


def test_a_clear_change_on_the_half_bar_is_kept():
    beats = [i * 0.5 for i in range(1, 16)]
    downbeats = beats[::4]
    log_probs = _log_probs([(0.0, 1.5, 0), (1.5, 2.5, 1), (2.5, 8.0, 0)], 8.0)
    chords = decode_chords_on_beats(log_probs, LABELS, FRAME_S, beats, downbeats, 8.0)
    assert [(c.start_time, c.chord) for c in chords] == [(0.0, "C:maj"), (1.5, "G:maj"), (2.5, "C:maj")]


def test_without_a_beat_grid_chords_follow_the_frames():
    log_probs = _log_probs([(0.0, 1.0, 0), (1.0, 2.0, 1)], 2.0)
    chords = decode_chords_on_beats(log_probs, LABELS, FRAME_S, [], [], 2.0)
    assert [(c.start_time, c.end_time, c.chord) for c in chords] == [(0.0, 1.0, "C:maj"), (1.0, 2.0, "G:maj")]


def test_a_mistake_in_one_repeat_of_a_progression_is_outvoted_by_the_others():
    beats = [i * 0.5 for i in range(1, 64)]
    downbeats = beats[::4]
    # C G A:min G, one bar each, played four times (8 s per pass)...
    progression = [(0, 2), (1, 2), (2, 2), (1, 2)]
    segments, t = [(0.0, 0.5, 0)], 0.5
    for _ in range(4):
        for k, bars in progression:
            segments.append((t, t + bars, k))
            t += bars
    log_probs = _log_probs(segments, 32.0, confidence=0.6)
    # ...but the third pass's A:min bar sounds a little more like C.
    a, b = int(round(20.5 / FRAME_S)), int(round(22.5 / FRAME_S))
    log_probs[a:b] = np.log(np.array([0.45, 0.05, 0.4, 0.1]))

    chords = decode_chords_on_beats(log_probs, LABELS, FRAME_S, beats, downbeats, 32.0)

    third_pass = [c.chord for c in chords if 16.5 <= c.start_time < 24.5]
    assert third_pass == ["C:maj", "G:maj", "A:min", "G:maj"]
