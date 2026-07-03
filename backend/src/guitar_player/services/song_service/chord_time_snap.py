"""Snap community chord change times onto detected beat anchors.

Community (Ultimate Guitar) chord times are derived from lyric timing, which
lands close to but rarely exactly on the beat. When the same song also has
autochord chord-change times or a bar grid, nudging a chord start onto the
nearest anchor (within a small tolerance) removes that jitter without
needing a full re-detection.
"""

from __future__ import annotations

from bisect import bisect_left

from guitar_player.schemas.song import ChordEntry

# Anchors farther than this from a chord's start are ignored.
DEFAULT_SNAP_TOLERANCE = 0.6


def build_anchor_times(
    autochord_chords: list[ChordEntry], bar_starts: list[float],
) -> list[float]:
    """Sorted, deduped union of autochord chord-change starts and bar starts."""
    anchors = {c.start_time for c in autochord_chords} | set(bar_starts)
    return sorted(anchors)


def _nearest_anchor(time: float, anchors: list[float], tolerance: float) -> float | None:
    idx = bisect_left(anchors, time)
    candidates = anchors[max(idx - 1, 0) : idx + 1]
    closest = min(candidates, key=lambda a: abs(a - time))
    return closest if abs(closest - time) <= tolerance else None


def snap_chord_times(
    chords: list[ChordEntry],
    anchors: list[float],
    tolerance: float = DEFAULT_SNAP_TOLERANCE,
) -> list[ChordEntry]:
    """Snap each chord's start onto the nearest anchor within *tolerance*.

    Strict monotonicity is preserved: a snap that would put a chord's start
    at or before the previous (already-decided) start, or past the next
    chord's original start, is skipped and the unsnapped time is kept
    instead. Every chord's end_time is recomputed as the next chord's
    (possibly snapped) start, and the last chord keeps its original end.
    """
    if not anchors or not chords:
        return chords

    new_starts: list[float] = []
    prev_start = float("-inf")
    for i, chord in enumerate(chords):
        next_start = chords[i + 1].start_time if i + 1 < len(chords) else float("inf")
        snapped = _nearest_anchor(chord.start_time, anchors, tolerance)
        use_snap = snapped is not None and prev_start < snapped < next_start
        new_start = snapped if use_snap else chord.start_time
        new_starts.append(new_start)
        prev_start = new_start

    result: list[ChordEntry] = []
    for i, chord in enumerate(chords):
        start = new_starts[i]
        end = new_starts[i + 1] if i + 1 < len(chords) else chord.end_time
        result.append(ChordEntry(
            start_time=round(start, 3),
            end_time=round(max(end, start), 3),
            chord=chord.chord,
            bass=chord.bass,
        ))
    return result
