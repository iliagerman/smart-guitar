"""Song beat grid: detected beats, tempo, and bar starts in the song's meter.

Built at read time so bars follow the latest time signature (Songsterr data can
arrive after beat detection). One grid feeds the bars view, the metronome, and
the beat glow, so they never disagree.
"""

import bisect
import math
import statistics
from dataclasses import dataclass

from guitar_player.schemas.song import ChordEntry

# chords_generator/bars.py stores every 4th detected beat as a bar start.
_BEATS_PER_STORED_BAR = 4
_DEFAULT_BEATS_PER_BAR = 4
# A chord change within this distance of a bar start counts as "on" it.
_ON_BAR_TOLERANCE_S = 0.08


@dataclass(frozen=True)
class BeatGrid:
    beat_times: list[float]  # beat_times[0] is a downbeat
    bar_starts: list[float]
    bpm: float


@dataclass(frozen=True)
class BeatGridSource:
    detected_beats: list[float]  # chord pipeline, full mix
    stored_bar_starts: list[float]  # chord pipeline, 4/4 (songs processed before beats were stored)
    guitar_beats: list[float]  # tabs pipeline, guitar stem
    chords: list[ChordEntry]
    time_signature: list[int] | None
    notated_bpm: float | None  # tab tempo; only picks the tempo octave


def build_beat_grid(source: BeatGridSource) -> BeatGrid | None:
    """Return the song's beat grid, or None when no beats were detected."""
    beats = _detected_beats(source)
    if beats is None:
        return None

    # Beat trackers often lock onto double or half time; keep the octave
    # closest to the tab tempo.
    beat_step = 1
    if source.notated_bpm:
        ratio = _bpm(beats) / source.notated_bpm
        if ratio > math.sqrt(2):
            beat_step = 2
        elif ratio < 1 / math.sqrt(2):
            beats = _with_half_beats(beats)

    bar_step = beat_step * _beats_per_bar(source.time_signature)
    change_times = [c.start_time for c in source.chords if c.chord != "N"]
    phase = 0
    if change_times:
        phase = max(range(bar_step), key=lambda p: _on_bar_count(beats[p::bar_step], change_times))

    beat_times = [round(b, 3) for b in beats[phase::beat_step]]
    if len(beat_times) < 2:
        return None
    return BeatGrid(
        beat_times=beat_times,
        bar_starts=[round(b, 3) for b in beats[phase::bar_step]],
        bpm=round(_bpm(beat_times), 2),
    )


def _detected_beats(source: BeatGridSource) -> list[float] | None:
    if len(source.detected_beats) >= 2:
        return source.detected_beats
    if len(source.stored_bar_starts) >= 2:
        return _split_bars(source.stored_bar_starts)
    if len(source.guitar_beats) >= 2:
        return source.guitar_beats
    return None


def _split_bars(bar_starts: list[float]) -> list[float]:
    beats: list[float] = []
    for start, end in zip(bar_starts, bar_starts[1:]):
        beat_length = (end - start) / _BEATS_PER_STORED_BAR
        beats.extend(start + i * beat_length for i in range(_BEATS_PER_STORED_BAR))
    beats.append(bar_starts[-1])
    return beats


def _with_half_beats(beats: list[float]) -> list[float]:
    halves: list[float] = []
    for start, end in zip(beats, beats[1:]):
        halves.extend([start, (start + end) / 2])
    halves.append(beats[-1])
    return halves


def _beats_per_bar(time_signature: list[int] | None) -> int:
    # Songsterr data is external; ignore a malformed numerator.
    if time_signature and time_signature[0] > 0:
        return time_signature[0]
    return _DEFAULT_BEATS_PER_BAR


def _bpm(beats: list[float]) -> float:
    return 60.0 / statistics.median(b - a for a, b in zip(beats, beats[1:]))


def _on_bar_count(bar_starts: list[float], change_times: list[float]) -> int:
    count = 0
    for t in change_times:
        i = bisect.bisect_left(bar_starts, t)
        nearest = [bar_starts[j] for j in (i - 1, i) if 0 <= j < len(bar_starts)]
        count += any(abs(t - b) <= _ON_BAR_TOLERANCE_S for b in nearest)
    return count
