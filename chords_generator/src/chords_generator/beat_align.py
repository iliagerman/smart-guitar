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


def snap_chords_to_beats(
    chords: list[ChordResult], beats: list[float],
) -> list[ChordResult]:
    """Snap chord-change boundaries to the nearest detected beat.

    - Each chord's start is snapped to its nearest beat.
    - Chords whose start snaps to the same beat as the previous one are dropped
      (sub-beat noise — you can't show two chords on one beat).
    - Consecutive identical chords are merged.
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
            ChordResult(start_time=start, end_time=chord.end_time, chord=chord.chord)
        )

    # 2. Merge consecutive identical chord labels.
    merged: list[ChordResult] = []
    for chord in collapsed:
        if merged and merged[-1].chord == chord.chord:
            continue
        merged.append(chord)

    # 3. Make contiguous: end = next chord's start (last keeps its longest end).
    last_end = max(c.end_time for c in chords)
    result: list[ChordResult] = []
    for i, chord in enumerate(merged):
        end = merged[i + 1].start_time if i + 1 < len(merged) else max(last_end, chord.start_time)
        if end > chord.start_time:
            result.append(
                ChordResult(start_time=chord.start_time, end_time=end, chord=chord.chord)
            )
    return result


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
