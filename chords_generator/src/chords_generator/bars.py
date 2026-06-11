"""Bar (measure) grid from the detected beat grid.

Assumes 4/4 — the overwhelming default for the catalog. The phase (which
beat is beat 1) is chosen so the most chord changes land on bar starts,
since chords overwhelmingly change on downbeats.
"""

from __future__ import annotations

from chords_generator.schemas import ChordResult

BEATS_PER_BAR = 4
# A chord change within this distance of a bar start counts as "on" it.
_ON_BAR_TOLERANCE_S = 0.08


def compute_bar_starts(
    beats: list[float], chords: list[ChordResult],
) -> list[float]:
    """Return bar start times: every 4th beat, phase-aligned to chord changes."""
    if len(beats) < BEATS_PER_BAR:
        return []

    change_times = [c.start_time for c in chords if c.chord != "N"]

    def on_bar_count(phase: int) -> int:
        bar_starts = beats[phase::BEATS_PER_BAR]
        count = 0
        for t in change_times:
            # bar_starts is sorted; binary search would be overkill for ~100 items
            count += any(abs(t - b) <= _ON_BAR_TOLERANCE_S for b in bar_starts)
        return count

    best_phase = 0
    if change_times:
        best_phase = max(range(BEATS_PER_BAR), key=on_bar_count)

    return [round(b, 3) for b in beats[best_phase::BEATS_PER_BAR]]
