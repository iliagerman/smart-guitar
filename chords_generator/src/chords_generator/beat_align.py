"""Beat alignment for recognized chords.

Autochord emits chord-change boundaries on a ~190 ms feature-frame grid, which
makes timing feel mechanical and off the beat. Here we detect the song's beats
and snap each chord change to the nearest beat, so chord changes land on the
beat the way a player reads a chord sheet.
"""

from __future__ import annotations

import bisect
import logging

from chords_generator.schemas import ChordResult

logger = logging.getLogger(__name__)


def nearest_beat(t: float, sorted_beats: list[float]) -> float:
    """Return the beat time closest to ``t``. ``sorted_beats`` must be sorted."""
    if not sorted_beats:
        return t
    i = bisect.bisect_left(sorted_beats, t)
    if i == 0:
        return sorted_beats[0]
    if i >= len(sorted_beats):
        return sorted_beats[-1]
    before = sorted_beats[i - 1]
    after = sorted_beats[i]
    return before if (t - before) <= (after - t) else after


MIN_CHORD_DURATION_S = 0.75


def _merge_same_chords(chords: list[ChordResult]) -> list[ChordResult]:
    merged: list[ChordResult] = []
    for chord in chords:
        if merged and merged[-1].chord == chord.chord and merged[-1].bass == chord.bass:
            merged[-1].end_time = chord.end_time
        else:
            merged.append(chord)
    return merged


def _remove_short_chord_blips(chords: list[ChordResult]) -> list[ChordResult]:
    """Drop isolated chord blips that are too short to read/play comfortably."""
    cleaned = chords[:]
    i = 0
    while i < len(cleaned):
        chord = cleaned[i]
        duration = chord.end_time - chord.start_time
        if len(cleaned) < 2 or duration >= MIN_CHORD_DURATION_S:
            i += 1
            continue

        prev = cleaned[i - 1] if i > 0 else None
        next_chord = cleaned[i + 1] if i + 1 < len(cleaned) else None
        prev_duration = prev.end_time - prev.start_time if prev else 0
        next_duration = next_chord.end_time - next_chord.start_time if next_chord else 0
        is_sandwich = bool(
            prev
            and next_chord
            and prev.chord == next_chord.chord
            and prev.bass == next_chord.bass
        )
        is_isolated = (
            is_sandwich
            or (prev is None and next_duration >= MIN_CHORD_DURATION_S)
            or (next_chord is None and prev_duration >= MIN_CHORD_DURATION_S)
            or (prev_duration >= MIN_CHORD_DURATION_S and next_duration >= MIN_CHORD_DURATION_S)
        )
        if not is_isolated:
            i += 1
            continue

        if prev is None:
            cleaned[1].start_time = chord.start_time
        elif next_chord is None:
            prev.end_time = chord.end_time
        elif is_sandwich:
            prev.end_time = next_chord.end_time
            del cleaned[i + 1]
        elif prev_duration >= next_duration:
            prev.end_time = chord.end_time
        else:
            next_chord.start_time = chord.start_time
        del cleaned[i]

    return _merge_same_chords(cleaned)


def snap_chords_to_beats(
    chords: list[ChordResult], beats: list[float],
) -> list[ChordResult]:
    """Snap chord-change boundaries to the nearest detected beat.

    - Each chord's start is snapped to its nearest beat.
    - Chords whose start snaps to the same beat as the previous one are dropped
      (sub-beat noise — you can't show two chords on one beat).
    - Consecutive identical chords are merged.
    - Very short isolated chord blips are absorbed into a neighbour.
    - The result is contiguous: each chord ends exactly where the next begins;
      the final chord keeps the longest original end time.

    Returns ``chords`` unchanged if there are no beats.
    """
    if not beats or not chords:
        return chords

    sorted_beats = sorted(beats)

    # 1. Snap starts; drop chords that collapse onto the previous chord's beat.
    collapsed: list[ChordResult] = []
    for chord in chords:
        start = nearest_beat(chord.start_time, sorted_beats)
        if collapsed and collapsed[-1].start_time == start:
            continue
        collapsed.append(
            ChordResult(
                start_time=start,
                end_time=chord.end_time,
                chord=chord.chord,
                bass=chord.bass,
            )
        )

    # 2. Merge consecutive identical chord labels.
    merged = _merge_same_chords(collapsed)

    # 3. Make contiguous: end = next chord's start (last keeps its longest end).
    last_end = max(c.end_time for c in chords)
    result: list[ChordResult] = []
    for i, chord in enumerate(merged):
        end = merged[i + 1].start_time if i + 1 < len(merged) else max(last_end, chord.start_time)
        if end > chord.start_time:
            result.append(
                ChordResult(
                    start_time=chord.start_time,
                    end_time=end,
                    chord=chord.chord,
                    bass=chord.bass,
                )
            )
    return _remove_short_chord_blips(result)


def detect_beats(audio_path: str) -> tuple[list[float], float]:
    """Detect beat times (seconds) and tempo (BPM) for an audio file.

    Returns ``([], 0.0)`` on failure so callers can fall back to raw timing.
    """
    try:
        import librosa

        y, sr = librosa.load(audio_path, mono=True)
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beats = librosa.frames_to_time(beat_frames, sr=sr)
        bpm = float(tempo) if tempo is not None else 0.0
        return [float(b) for b in beats], bpm
    except Exception:
        logger.warning("Beat detection failed for %s (non-fatal)", audio_path, exc_info=True)
        return [], 0.0
