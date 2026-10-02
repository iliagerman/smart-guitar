"""Decide one chord per beat on the tracked beat grid.

The chord model gives probabilities every ~93 ms. Averaging them over each
beat and choosing the best chord sequence with Viterbi puts every change on a
beat by construction. A change costs more off the strong beats, so chords
change on beat 1 unless the audio clearly says otherwise, then on the half
bar, and only rarely in between.

Before deciding, each beat also hears the same beat in the song's repeats (a
chorus played again): sections that sound alike get the same chords, and a
one-off mistake in one of them is outvoted.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass

import numpy as np

from chords_generator.schemas import ChordResult

# Log-probability a change has to win by, per beat position. Tuned on 36
# songs with published chord annotations (Billboard, Isophonics, uspop2002).
CHANGE_COST_DOWNBEAT = 0.5
CHANGE_COST_HALF_BAR = 1.0
CHANGE_COST_OFFBEAT = 2.0
# Repeats: how far a beat leans on the same beat in sections that sound
# alike, how alike they must be (mean cosine of the chord probabilities over
# two bars either side), and how many repeats it listens to. Tuned on the
# same 36 songs: +1 point on chords, no loss in segmentation.
REPEAT_WEIGHT = 0.5
REPEAT_MIN_SIMILARITY = 0.8
REPEAT_NEIGHBOURS = 6
_DEFAULT_BEATS_PER_BAR = 4
# A tracked downbeat within this distance of a beat is on it.
_DOWNBEAT_TOLERANCE_S = 0.05


def beats_per_bar(beats: list[float], downbeats: list[float]) -> int:
    """The meter's beats per bar: the most common count between tracked downbeats."""
    counts = [
        bisect.bisect_left(beats, end - _DOWNBEAT_TOLERANCE_S) - bisect.bisect_left(beats, start - _DOWNBEAT_TOLERANCE_S)
        for start, end in zip(downbeats, downbeats[1:])
    ]
    counts = [c for c in counts if c > 1]
    if not counts:
        return _DEFAULT_BEATS_PER_BAR
    values, frequency = np.unique(counts, return_counts=True)
    return int(values[frequency.argmax()])


def bar_positions(beats: list[float], downbeats: list[float], per_bar: int) -> list[int]:
    """Each beat's position in its bar, 0 on a downbeat.

    Counts from the latest tracked downbeat, so a bar the tracker shortened or
    lengthened (a 2/4 bar in a 4/4 song) restarts the count where it should.
    Beats before the first downbeat count back from it.
    """
    positions: list[int] = []
    last_downbeat: int | None = None
    for i, beat in enumerate(beats):
        j = bisect.bisect_left(downbeats, beat - _DOWNBEAT_TOLERANCE_S)
        if j < len(downbeats) and abs(downbeats[j] - beat) <= _DOWNBEAT_TOLERANCE_S:
            last_downbeat = i
        positions.append(-1 if last_downbeat is None else i - last_downbeat)
    first = next((i for i, p in enumerate(positions) if p == 0), None)
    if first is None:
        return [i % per_bar for i in range(len(beats))]
    return [(i - first) % per_bar if p < 0 else p for i, p in enumerate(positions)]


def _step_log_probs(log_probs: np.ndarray, frame_s: float, edges: list[float]) -> np.ndarray:
    """Mean frame log-probability over each step [edges[k], edges[k + 1])."""
    frames = log_probs.shape[0]
    out = np.empty((len(edges) - 1, log_probs.shape[1]))
    for k, (start, end) in enumerate(zip(edges, edges[1:])):
        a = min(max(int(np.floor(start / frame_s)), 0), frames - 1)
        b = min(max(int(np.ceil(end / frame_s)), a + 1), frames)
        out[k] = log_probs[a:b].mean(axis=0)
    return out


def _viterbi(emissions: np.ndarray, change_cost: np.ndarray) -> np.ndarray:
    """Best state path when entering step k on a new state costs ``change_cost[k]``."""
    steps, states = emissions.shape
    score = emissions[0].copy()
    back = np.zeros((steps, states), dtype=np.int32)
    every_state = np.arange(states)
    for k in range(1, steps):
        best = int(score.argmax())
        switch = score[best] - change_cost[k]
        moves = switch > score
        back[k] = np.where(moves, best, every_state)
        score = np.where(moves, switch, score) + emissions[k]
    path = np.empty(steps, dtype=np.int32)
    path[-1] = int(score.argmax())
    for k in range(steps - 1, 0, -1):
        path[k - 1] = back[k, path[k]]
    return path


@dataclass
class BeatSteps:
    """The song cut into steps on its beat grid: step 0 runs up to the first beat, step k from beat k-1."""

    edges: list[float]  # step k covers [edges[k], edges[k + 1])
    log_probs: np.ndarray  # (steps, labels) mean frame log-probability per step
    positions: list[int]  # bar position of each step; -1 for step 0
    per_bar: int

    def change_cost(self) -> np.ndarray:
        half_bar = self.per_bar // 2 if self.per_bar % 2 == 0 else None
        return np.array([
            0.0 if p < 0
            else CHANGE_COST_DOWNBEAT if p == 0
            else CHANGE_COST_HALF_BAR if p == half_bar
            else CHANGE_COST_OFFBEAT
            for p in self.positions
        ])

    def weights(self) -> np.ndarray:
        """Long steps (an intro before the first beat, the tail) weigh more, capped
        so a long silent intro can't drown out the first bars."""
        lengths = np.diff(self.edges)
        beat_s = float(np.median(lengths[1:-1]))
        return np.clip(lengths / beat_s, 0.25, 4.0)[:, None]


def beat_steps(
    log_probs: np.ndarray, frame_s: float, beats: list[float], downbeats: list[float], duration: float,
) -> BeatSteps | None:
    """None without a usable beat grid (fewer than two beats)."""
    beats = [b for b in beats if 0.0 < b < duration]
    if len(beats) < 2:
        return None
    per_bar = beats_per_bar(beats, downbeats)
    edges = [0.0, *beats, duration]
    return BeatSteps(
        edges=edges,
        log_probs=_step_log_probs(log_probs, frame_s, edges),
        positions=[-1, *bar_positions(beats, downbeats, per_bar)],
        per_bar=per_bar,
    )


def share_repeats(steps: BeatSteps) -> np.ndarray:
    """Step log-probabilities mixed with those of the same beat in sections that sound alike."""
    log_probs = steps.log_probs
    probs = np.exp(log_probs[1:])
    probs /= np.linalg.norm(probs, axis=1, keepdims=True) + 1e-9
    beat_similarity = probs @ probs.T
    count = len(probs)
    reach = 2 * steps.per_bar
    # Mean similarity of the stretches around beat i and beat j, beat for beat.
    total = np.zeros_like(beat_similarity)
    weight = np.zeros_like(beat_similarity)
    for offset in range(-reach, reach + 1):
        lo, hi = max(0, -offset), min(count, count - offset)
        if hi <= lo:
            continue
        total[lo:hi, lo:hi] += beat_similarity[lo + offset:hi + offset, lo + offset:hi + offset]
        weight[lo:hi, lo:hi] += 1
    similarity = total / np.maximum(weight, 1)

    positions = np.array(steps.positions[1:])
    index = np.arange(count)
    same_position = positions[:, None] == positions[None, :]
    apart = np.abs(index[:, None] - index[None, :]) > reach
    similarity = np.where(same_position & apart, similarity, -1.0)

    mixed = log_probs.copy()
    for i in range(count):
        repeats = np.argsort(similarity[i])[::-1][:REPEAT_NEIGHBOURS]
        repeats = repeats[similarity[i, repeats] >= REPEAT_MIN_SIMILARITY]
        if len(repeats):
            mixed[i + 1] = (1 - REPEAT_WEIGHT) * log_probs[i + 1] + REPEAT_WEIGHT * log_probs[repeats + 1].mean(axis=0)
    return mixed


def decode_steps(steps: BeatSteps, labels: list[str], log_probs: np.ndarray | None = None) -> list[ChordResult]:
    """Contiguous chords over the steps, from Viterbi on ``log_probs`` (default: the steps' own)."""
    emissions = (steps.log_probs if log_probs is None else log_probs) * steps.weights()
    path = _viterbi(emissions, steps.change_cost())
    chords: list[ChordResult] = []
    for k, state in enumerate(path):
        if chords and chords[-1].chord == labels[state]:
            chords[-1].end_time = steps.edges[k + 1]
        else:
            chords.append(ChordResult(start_time=steps.edges[k], end_time=steps.edges[k + 1], chord=labels[state]))
    return [c for c in chords if c.end_time > c.start_time]


def decode_chords_on_beats(
    log_probs: np.ndarray,
    labels: list[str],
    frame_s: float,
    beats: list[float],
    downbeats: list[float],
    duration: float,
) -> list[ChordResult]:
    """Contiguous chords from 0 to ``duration``, every change on a tracked beat."""
    steps = beat_steps(log_probs, frame_s, beats, downbeats, duration)
    if steps is None:
        return _frames_to_chords(log_probs.argmax(axis=1), labels, frame_s, duration)
    return decode_steps(steps, labels, share_repeats(steps))


def _frames_to_chords(idx: np.ndarray, labels: list[str], frame_s: float, duration: float) -> list[ChordResult]:
    chords: list[ChordResult] = []
    for i, state in enumerate(idx):
        start = i * frame_s
        if chords and chords[-1].chord == labels[state]:
            continue
        if chords:
            chords[-1].end_time = start
        chords.append(ChordResult(start_time=start, end_time=duration, chord=labels[state]))
    return chords
