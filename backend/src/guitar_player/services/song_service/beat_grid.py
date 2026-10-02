"""Song beat grid: detected beats, tempo, and bar starts in the song's meter.

Built at read time so bars follow the latest time signature (Songsterr data can
arrive after beat detection). One grid feeds the bars view, the metronome, and
the beat glow, so they never disagree.
"""

import bisect
import math
import statistics
from dataclasses import dataclass
from fractions import Fraction

from guitar_player.schemas.song import ChordEntry

# chords_generator/bars.py stores every 4th detected beat as a bar start.
_BEATS_PER_STORED_BAR = 4
_DEFAULT_BEATS_PER_BAR = 4
# A chord change or tracked downbeat within this distance of a bar start counts as "on" it.
_ON_BAR_TOLERANCE_S = 0.08
# Without a tab tempo to check against, a faster detected tempo is almost
# always the tracker locking onto eighth notes (a 74 BPM ballad detected at
# 148), so count every other beat. A truly fast song then gets a half-time
# grid, which still lands on its beats.
_MAX_UNNOTATED_BPM = 135.0
# Trackers also lock onto a tuplet of the beat: Wonderwall (88 BPM) tracked at
# 117 counts four beats where three are played; Stairway (71) at 103 counts
# three for two. These are corrected only on a close match with the tab tempo:
# a near miss (Wicked Game tracked at 112, tabbed at 90) means the tab is off.
_TUPLET_RATIOS = (Fraction(3, 2), Fraction(4, 3), Fraction(3, 4), Fraction(2, 3))
_TUPLET_TOLERANCE = 0.04


@dataclass(frozen=True)
class BeatGrid:
    beat_times: list[float]  # beat_times[0] is a downbeat
    bar_starts: list[float]
    bpm: float
    beats_per_bar: int


@dataclass(frozen=True)
class BeatGridSource:
    detected_beats: list[float]  # chord pipeline, full mix
    # Tracked bar starts among detected_beats, and the meter they imply; empty
    # and None for songs processed before downbeats were tracked.
    detected_downbeats: list[float]
    detected_beats_per_bar: int | None
    stored_bar_starts: list[float]  # chord pipeline, 4/4 (songs processed before beats were stored)
    guitar_beats: list[float]  # tabs pipeline, guitar stem
    chords: list[ChordEntry]
    time_signature: list[int] | None
    notated_bpm: float | None  # tab tempo; only picks the tempo octave or tuplet


def build_beat_grid(source: BeatGridSource, *, half_time: bool = True) -> BeatGrid | None:
    """Return the song's beat grid, or None when no beats were detected.

    ``half_time=False`` keeps a fast tempo as tracked (see _MAX_UNNOTATED_BPM):
    chord changes were detected on those beats, so chord cleanup and alignment
    measure against them.
    """
    beats = _detected_beats(source)
    if beats is None:
        return None

    # Tracked beats per played beat. Beat trackers often lock onto double or
    # half time, or a tuplet of the beat; the tab tempo tells which.
    step = Fraction(1)
    if source.notated_bpm:
        step = _tempo_step(_bpm(beats) / source.notated_bpm)
    elif half_time and _bpm(beats) > _MAX_UNNOTATED_BPM:
        step = Fraction(2)
    if step < 1 and step.numerator == 1:
        beats = _with_half_beats(beats)
        step *= 2

    beats_per_bar = _beats_per_bar(source.time_signature, source.detected_beats_per_bar)
    # Where the played beats fall between tracked ones, and which beat is the
    # downbeat: the choice that puts the most tracked downbeats on bar lines,
    # or, for songs tracked without downbeats, the most chord changes.
    anchors = source.detected_downbeats if len(source.detected_beats) >= 2 else []
    anchors = anchors or [c.start_time for c in source.chords if c.chord != "N"]
    offsets = [Fraction(k, step.denominator) for k in range(step.numerator)]
    grids = {offset: _resample(beats, step, offset) for offset in offsets}
    candidates = [(offset, phase) for phase in range(beats_per_bar) for offset in offsets]
    offset, phase = candidates[0]
    if anchors:
        offset, phase = max(
            candidates,
            key=lambda c: _on_bar_count(grids[c[0]][c[1]::beats_per_bar], anchors),
        )

    played = grids[offset]
    beat_times = [round(b, 3) for b in played[phase:]]
    if len(beat_times) < 2:
        return None
    return BeatGrid(
        beat_times=beat_times,
        bar_starts=[round(b, 3) for b in played[phase::beats_per_bar]],
        bpm=round(_bpm(beat_times), 2),
        beats_per_bar=beats_per_bar,
    )


def _tempo_step(ratio: float) -> Fraction:
    """Tracked beats per played beat, from the tracked-to-tab tempo ratio."""
    tuplet = min(_TUPLET_RATIOS, key=lambda r: abs(math.log(ratio / r)))
    if abs(math.log(ratio / tuplet)) <= math.log1p(_TUPLET_TOLERANCE):
        return tuplet
    if ratio > math.sqrt(2):
        return Fraction(2)
    if ratio < 1 / math.sqrt(2):
        return Fraction(1, 2)
    return Fraction(1)


def _resample(beats: list[float], step: Fraction, offset: Fraction) -> list[float]:
    """Played beats every ``step`` tracked beats from ``offset``, between tracked beats where they fall."""
    out: list[float] = []
    last = len(beats) - 1
    k = 0
    while (position := offset + k * step) <= last:
        i = int(position)
        fraction = float(position - i)
        out.append(beats[i] if fraction == 0 else beats[i] + fraction * (beats[i + 1] - beats[i]))
        k += 1
    return out


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


def _beats_per_bar(time_signature: list[int] | None, detected: int | None) -> int:
    # Songsterr data is external; ignore a malformed numerator.
    tab = time_signature[0] if time_signature and time_signature[0] > 0 else None
    # Of the tracked meters only 3/4 is trusted: a tracked 2 or 6 is as often
    # a 4/4 or 6/8 song counted in half or double time. It also wins over a
    # tab's 4/4: tabs fetched before the parser carried a measure's signature
    # forward were all stored as 4/4 (see refresh_songsterr_meter).
    if detected == 3 and tab in (None, 4):
        return 3
    return tab or _DEFAULT_BEATS_PER_BAR


def _bpm(beats: list[float]) -> float:
    return 60.0 / statistics.median(b - a for a, b in zip(beats, beats[1:]))


def _on_bar_count(bar_starts: list[float], change_times: list[float]) -> int:
    count = 0
    for t in change_times:
        i = bisect.bisect_left(bar_starts, t)
        nearest = [bar_starts[j] for j in (i - 1, i) if 0 <= j < len(bar_starts)]
        count += any(abs(t - b) <= _ON_BAR_TOLERANCE_S for b in nearest)
    return count
