"""Clean up detected chords before they reach the player.

Two kinds of detection noise are removed:

- Flashes: a chord that lasts less than two beats. Detected chord changes sit
  on beats, so this is a single-beat chord, and it is absorbed into a
  neighbour.
- Lone wrong chords: a chord outside the song's key that appears at most
  twice, sitting between two chords that elsewhere in the song repeatedly
  surround the same in-key chord. It is replaced by that in-key chord,
  because the rest of the song shows what is played there.

Chords outside the key that recur (borrowed chords) and rare chords with no
repeated context to copy from are left alone.
"""

from __future__ import annotations

import re
import statistics
from collections import Counter

from guitar_player.schemas.song import ChordEntry

NO_CHORD = "N"
# Without a beat grid, treat anything shorter than this as a flash.
_FALLBACK_MIN_DURATION_S = 1.0
_MIN_DURATION_BEATS = 1.5
# An out-of-key chord is only suspect when it is this rare in the song...
_RARE_MAX_OCCURRENCES = 2
# ...and is only replaced when its surroundings repeat at least this often.
_MIN_CONTEXT_REPEATS = 2

_PITCH_CLASSES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_ROOT_RE = re.compile(r"^([A-G])([#b]?)(.*)$")
# Diatonic triads of a major key (vii° left out): (semitones above tonic, minor?).
_MAJOR_KEY_TRIADS = ((0, False), (2, True), (4, True), (5, False), (7, False), (9, True))


def clean_detected_chords(chords: list[ChordEntry], beat_times: list[float]) -> list[ChordEntry]:
    """Return ``chords`` without single-beat flashes and lone out-of-key chords."""
    if len(chords) < 2:
        return chords
    cleaned = _absorb_flashes(chords, _min_duration(beat_times))
    return _merge_repeats(_correct_lone_outliers(cleaned))


def _min_duration(beat_times: list[float]) -> float:
    if len(beat_times) < 2:
        return _FALLBACK_MIN_DURATION_S
    beat_s = statistics.median(b - a for a, b in zip(beat_times, beat_times[1:]))
    return beat_s * _MIN_DURATION_BEATS


def _duration(chord: ChordEntry) -> float:
    return chord.end_time - chord.start_time


def _same(a: ChordEntry, b: ChordEntry) -> bool:
    return a.chord == b.chord and a.bass == b.bass


def _absorb_flashes(chords: list[ChordEntry], min_duration: float) -> list[ChordEntry]:
    result = [c.model_copy() for c in chords]
    i = 0
    while i < len(result):
        chord = result[i]
        if chord.chord == NO_CHORD or _duration(chord) >= min_duration:
            i += 1
            continue
        prev = result[i - 1] if i > 0 else None
        nxt = result[i + 1] if i + 1 < len(result) else None
        if prev and nxt and _same(prev, nxt):
            prev.end_time = nxt.end_time
            del result[i : i + 2]
            continue
        if prev and (nxt is None or _duration(prev) >= _duration(nxt)):
            prev.end_time = chord.end_time
        elif nxt:
            nxt.start_time = chord.start_time
        else:
            i += 1
            continue
        del result[i]
    return result


def _merge_repeats(chords: list[ChordEntry]) -> list[ChordEntry]:
    merged: list[ChordEntry] = []
    for chord in chords:
        if merged and _same(merged[-1], chord):
            merged[-1] = merged[-1].model_copy(update={"end_time": chord.end_time})
        else:
            merged.append(chord)
    return merged


def _triad(name: str) -> tuple[int, bool] | None:
    """(root pitch class, is_minor) for labels like ``A:min``, ``Am7``, ``C#``."""
    match = _ROOT_RE.match(name.split("/")[0])
    if not match:
        return None
    letter, accidental, quality = match.groups()
    root = _PITCH_CLASSES[letter] + {"#": 1, "b": -1, "": 0}[accidental]
    quality = quality.lstrip(":")
    is_minor = quality.startswith("min") or (quality.startswith("m") and not quality.startswith("maj"))
    return root % 12, is_minor


def _key_triads(chords: list[ChordEntry]) -> set[tuple[int, bool]]:
    """Diatonic triads of the major (or relative minor) key covering the most time."""
    time_by_triad: Counter[tuple[int, bool]] = Counter()
    for chord in chords:
        triad = _triad(chord.chord)
        if triad:
            time_by_triad[triad] += _duration(chord)

    def key_set(tonic: int) -> set[tuple[int, bool]]:
        return {((tonic + step) % 12, minor) for step, minor in _MAJOR_KEY_TRIADS}

    best = max(range(12), key=lambda tonic: sum(time_by_triad[t] for t in key_set(tonic)))
    return key_set(best)


def _correct_lone_outliers(chords: list[ChordEntry]) -> list[ChordEntry]:
    in_key = _key_triads(chords)
    counts = Counter(c.chord for c in chords)

    def is_in_key(name: str) -> bool:
        return _triad(name) in in_key

    def is_suspect(name: str) -> bool:
        return (
            name != NO_CHORD
            and _triad(name) is not None
            and not is_in_key(name)
            and counts[name] <= _RARE_MAX_OCCURRENCES
        )

    # What in-key chord sits between each (previous, next) pair elsewhere in the
    # song. No-chord gaps surround all kinds of chords, so they are no evidence.
    between: dict[tuple[str, str], Counter[str]] = {}
    for prev, mid, nxt in zip(chords, chords[1:], chords[2:]):
        if is_in_key(mid.chord) and NO_CHORD not in (prev.chord, nxt.chord):
            between.setdefault((prev.chord, nxt.chord), Counter())[mid.chord] += 1

    result = list(chords)
    for i in range(1, len(chords) - 1):
        if not is_suspect(chords[i].chord):
            continue
        seen = between.get((chords[i - 1].chord, chords[i + 1].chord))
        if not seen:
            continue
        replacement, repeats = seen.most_common(1)[0]
        if repeats >= _MIN_CONTEXT_REPEATS:
            result[i] = chords[i].model_copy(update={"chord": replacement, "bass": None})
    return result
