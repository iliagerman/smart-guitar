"""Strum pattern generation combining rhythmic fallback patterns with onset detection.

Two complementary approaches:

1. **Rhythmic fallback patterns**: Given chord durations and beat positions from
    librosa, generate a guitar-like strum groove using beat and off-beat slots.
    This provides a plausible pattern even when we do not have reliable onset
    evidence from the audio.

2. **Onset-based detection**: Where Basic Pitch provides multi-note chord
   groups, analyze the temporal ordering of note onsets to determine actual
   strum direction from the audio. These override the beat-aligned defaults.

The combined result gives full beat coverage (every beat in every chord gets
a strum direction) while using real audio evidence where available.
"""

import logging
from statistics import median
from dataclasses import dataclass

from tabs_generator.schemas import NoteResult, StrumEvent
from tabs_generator.tab_converter import group_into_chords

logger = logging.getLogger(__name__)

_DEFAULT_CHORD_ATTACK_WINDOW_S = 0.12
_ONE_BEAT_PATTERN: tuple[tuple[float, str], ...] = ((0.0, "down"),)
_TWO_BEAT_PATTERN: tuple[tuple[float, str], ...] = (
    (0.0, "down"),
    (0.68, "up"),
)
_THREE_BEAT_PATTERN: tuple[tuple[float, str], ...] = (
    (0.0, "down"),
    (0.44, "down"),
    (0.82, "up"),
)
_FOUR_BEAT_PATTERN: tuple[tuple[float, str], ...] = (
    (0.0, "down"),
    (0.25, "down"),
    (0.38, "up"),
    (0.62, "up"),
    (0.78, "down"),
    (0.92, "up"),
)


# ---------------------------------------------------------------------------
# Chord entry type (matches chords.json shape)
# ---------------------------------------------------------------------------


@dataclass
class ChordInfo:
    """A chord from chords.json."""

    start_time: float
    end_time: float
    chord: str


# ---------------------------------------------------------------------------
# Spearman rank correlation (for onset-based direction)
# ---------------------------------------------------------------------------


def _spearman_rank_correlation(x: list[float], y: list[float]) -> float:
    """Compute Spearman rank correlation for two equal-length sequences.

    Returns a value in [-1.0, 1.0]. With only 2 items, returns +1 or -1
    based on whether the ordering agrees or disagrees.

    For tied ranks, uses average rank assignment.
    """
    n = len(x)
    if n < 2:
        return 0.0

    def _rank(values: list[float]) -> list[float]:
        indexed = sorted(range(n), key=lambda i: values[i])
        ranks = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j < n - 1 and values[indexed[j + 1]] == values[indexed[j]]:
                j += 1
            avg_rank = (i + j) / 2.0 + 1.0  # 1-based average rank
            for k in range(i, j + 1):
                ranks[indexed[k]] = avg_rank
            i = j + 1
        return ranks

    rx = _rank(x)
    ry = _rank(y)

    mean_rx = sum(rx) / n
    mean_ry = sum(ry) / n

    num = sum((rx[i] - mean_rx) * (ry[i] - mean_ry) for i in range(n))
    den_x = sum((rx[i] - mean_rx) ** 2 for i in range(n))
    den_y = sum((ry[i] - mean_ry) ** 2 for i in range(n))

    den = (den_x * den_y) ** 0.5
    if den == 0.0:
        return 0.0

    return num / den


# ---------------------------------------------------------------------------
# Onset-based direction analysis (for a single chord group)
# ---------------------------------------------------------------------------


def _analyze_chord_direction(
    notes: list[NoteResult],
    indices: list[int],
    min_onset_spread_ms: float,
    full_confidence_spread_ms: float,
    min_strum_confidence: float,
) -> tuple[str, float, float]:
    """Determine strum direction for a single chord group from onset timing.

    Returns:
        (direction, confidence, onset_spread_ms)
    """
    pairs = [(notes[i].string, notes[i].start_time) for i in indices]

    start_times = [t for _, t in pairs]
    onset_spread_ms = (max(start_times) - min(start_times)) * 1000.0

    if onset_spread_ms < min_onset_spread_ms:
        return ("ambiguous", 0.0, onset_spread_ms)

    string_indices = [float(s) for s, _ in pairs]
    onsets = [t for _, t in pairs]
    correlation = _spearman_rank_correlation(string_indices, onsets)

    spread_range = full_confidence_spread_ms - min_onset_spread_ms
    if spread_range > 0:
        onset_factor = min(
            1.0, max(0.0, (onset_spread_ms - min_onset_spread_ms) / spread_range)
        )
    else:
        onset_factor = 1.0

    confidence = onset_factor * abs(correlation)

    if confidence < min_strum_confidence:
        return ("ambiguous", round(confidence, 3), onset_spread_ms)

    direction = "down" if correlation > 0 else "up"
    return (direction, round(confidence, 3), onset_spread_ms)


# ---------------------------------------------------------------------------
# Onset-based detection (original approach — now a helper)
# ---------------------------------------------------------------------------


@dataclass
class _OnsetStrum:
    """Intermediate onset-based strum result."""

    start_time: float
    end_time: float
    direction: str
    confidence: float
    num_strings: int
    onset_spread_ms: float
    note_indices: list[int]


def _detect_onset_strums(
    notes: list[NoteResult],
    onset_tolerance: float = 0.03,
    min_onset_spread_ms: float = 2.0,
    full_confidence_spread_ms: float = 5.0,
    min_strum_confidence: float = 0.3,
    min_chord_size: int = 2,
) -> list[_OnsetStrum]:
    """Detect strums from note onset timing (original approach).

    Returns intermediate results without assigning strum_ids yet.
    """
    groups = group_into_chords(notes, onset_tolerance)
    results: list[_OnsetStrum] = []

    for group in groups:
        if len(group) < min_chord_size:
            continue

        direction, confidence, onset_spread_ms = _analyze_chord_direction(
            notes,
            group,
            min_onset_spread_ms,
            full_confidence_spread_ms,
            min_strum_confidence,
        )

        start_time = min(notes[i].start_time for i in group)
        end_time = max(notes[i].end_time for i in group)

        results.append(
            _OnsetStrum(
                start_time=start_time,
                end_time=end_time,
                direction=direction,
                confidence=confidence,
                num_strings=len(group),
                onset_spread_ms=round(onset_spread_ms, 3),
                note_indices=list(group),
            )
        )

    return results


# ---------------------------------------------------------------------------
# Rhythmic fallback pattern generation
# ---------------------------------------------------------------------------


@dataclass
class _PatternSlot:
    """Candidate rhythmic slot for synthetic fallback strums."""

    time: float
    direction: str


def _estimate_local_beat_duration(
    chord: ChordInfo,
    beat_times: list[float],
    bpm: float,
) -> float:
    """Estimate beat duration near a chord from the detected beat grid."""
    fallback = 60.0 / max(30.0, bpm)
    if len(beat_times) < 2:
        return fallback

    intervals: list[float] = []
    for idx in range(len(beat_times) - 1):
        start = beat_times[idx]
        end = beat_times[idx + 1]
        if end <= start:
            continue
        if end < chord.start_time - fallback or start > chord.end_time + fallback:
            continue
        intervals.append(end - start)

    if not intervals:
        intervals = [
            beat_times[idx + 1] - beat_times[idx]
            for idx in range(len(beat_times) - 1)
            if beat_times[idx + 1] > beat_times[idx]
        ]

    return median(intervals) if intervals else fallback


def _choose_fallback_pattern(estimated_beats: float) -> tuple[tuple[float, str], ...]:
    """Choose a synthetic strum template based on chord duration in beats."""
    if estimated_beats < 1.5:
        return _ONE_BEAT_PATTERN
    if estimated_beats < 2.5:
        return _TWO_BEAT_PATTERN
    if estimated_beats < 3.5:
        return _THREE_BEAT_PATTERN
    return _FOUR_BEAT_PATTERN


def _build_chord_pattern_slots(
    chord: ChordInfo,
    beat_times: list[float],
    bpm: float,
) -> list[_PatternSlot]:
    """Build synthetic strum slots for a single chord.

    The template varies with chord duration so short chords get sparse, more
    believable attacks while longer chords receive a fuller groove.
    """
    chord_duration = max(0.05, chord.end_time - chord.start_time)
    beat_duration = _estimate_local_beat_duration(chord, beat_times, bpm)
    estimated_beats = chord_duration / max(0.05, beat_duration)
    template = _choose_fallback_pattern(estimated_beats)

    slots: list[_PatternSlot] = []
    seen_times: set[float] = set()
    for offset_ratio, direction in template:
        time = chord.start_time + (chord_duration * offset_ratio)
        time = min(time, chord.end_time - 0.01)
        rounded = round(time, 4)
        if rounded in seen_times:
            continue
        seen_times.add(rounded)
        slots.append(_PatternSlot(time=time, direction=direction))

    if not slots:
        return [_PatternSlot(time=chord.start_time, direction="down")]

    if slots[0].time - chord.start_time > _DEFAULT_CHORD_ATTACK_WINDOW_S:
        slots.insert(0, _PatternSlot(time=chord.start_time, direction="down"))

    return slots


def _generate_beat_aligned_strums(
    chords: list[ChordInfo],
    beat_times: list[float],
    bpm: float,
) -> list[StrumEvent]:
    """Generate fallback strum events within each chord's duration.

    Uses chord-duration-aware strumming templates rather than one repeated
    global groove. Short chords get sparse attacks; longer chords get fuller
    patterns. This avoids every chord looking like the same U/D treadmill.

    If a chord has no pattern slots inside it (short chord or gap in beats),
    a single strum is placed at the chord's start time.
    """
    if not chords or not beat_times:
        return []

    strums: list[StrumEvent] = []
    strum_id = 0

    for chord in chords:
        if chord.chord == "N":
            continue

        chord_slots = _build_chord_pattern_slots(chord, beat_times, bpm)

        for slot_index, slot in enumerate(chord_slots):
            if slot_index + 1 < len(chord_slots):
                end_t = chord_slots[slot_index + 1].time
            else:
                end_t = chord.end_time

            if end_t <= slot.time:
                end_t = chord.end_time

            strums.append(
                StrumEvent(
                    id=strum_id,
                    start_time=slot.time,
                    end_time=end_t,
                    direction=slot.direction,
                    confidence=0.45,
                    num_strings=0,
                    onset_spread_ms=0.0,
                )
            )
            strum_id += 1

    return strums


# ---------------------------------------------------------------------------
# Combining beat-aligned and onset-based
# ---------------------------------------------------------------------------


def _merge_strums(
    beat_strums: list[StrumEvent],
    onset_strums: list[_OnsetStrum],
    merge_tolerance: float = 0.05,
) -> list[StrumEvent]:
    """Merge onset-detected directions into beat-aligned strum events.

    For each beat-aligned strum, check if there's an onset-detected strum
    near the same time. If so, and the onset detection has a non-ambiguous
    direction, override the beat-aligned direction with the detected one
    and boost confidence.
    """
    merged: list[StrumEvent] = []

    for bs in beat_strums:
        # Find closest onset strum
        best_onset: _OnsetStrum | None = None
        best_dist = float("inf")

        for os_ in onset_strums:
            if os_.direction == "ambiguous":
                continue
            dist = abs(bs.start_time - os_.start_time)
            if dist < merge_tolerance and dist < best_dist:
                best_dist = dist
                best_onset = os_

        if best_onset is not None:
            # Override with onset-detected direction
            merged.append(
                StrumEvent(
                    id=bs.id,
                    start_time=bs.start_time,
                    end_time=bs.end_time,
                    direction=best_onset.direction,
                    confidence=min(1.0, best_onset.confidence + 0.3),
                    num_strings=best_onset.num_strings,
                    onset_spread_ms=best_onset.onset_spread_ms,
                )
            )
        else:
            merged.append(bs)

    return merged


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def detect_strums(
    notes: list[NoteResult],
    onset_tolerance: float = 0.03,
    min_onset_spread_ms: float = 2.0,
    full_confidence_spread_ms: float = 5.0,
    min_strum_confidence: float = 0.3,
    min_chord_size: int = 2,
    chords: list[ChordInfo] | None = None,
    beat_times: list[float] | None = None,
    bpm: float = 120.0,
) -> tuple[list[NoteResult], list[StrumEvent]]:
    """Detect/generate strum patterns combining beat-aligned and onset-based approaches.

    When chords and beat_times are provided, generates beat-aligned strum
    patterns and merges onset-detected directions where available. This gives
    full coverage (every beat gets a strum direction) while using real audio
    evidence where it exists.

    When chords or beat_times are not available, falls back to onset-only
    detection (original behavior).

    Args:
        notes: Notes with string/fret positions assigned.
        onset_tolerance: Max time gap (seconds) for notes in same chord group.
        min_onset_spread_ms: Minimum onset spread for direction detection.
        full_confidence_spread_ms: Onset spread at which onset factor reaches 1.0.
        min_strum_confidence: Minimum confidence for non-ambiguous direction.
        min_chord_size: Minimum notes to classify as a strum.
        chords: Chord entries from chords.json (optional).
        beat_times: Beat positions in seconds from librosa (optional).
        bpm: Detected BPM (used for logging).

    Returns:
        (notes, strum_events) — notes have strum_id set where applicable,
        strum_events is the list of all strum events.
    """
    # Step 1: Always run onset detection on the notes
    onset_strums = _detect_onset_strums(
        notes,
        onset_tolerance=onset_tolerance,
        min_onset_spread_ms=min_onset_spread_ms,
        full_confidence_spread_ms=full_confidence_spread_ms,
        min_strum_confidence=min_strum_confidence,
        min_chord_size=min_chord_size,
    )

    # Step 2: If we have chords + beats, generate beat-aligned patterns and merge
    if chords and beat_times:
        beat_strums = _generate_beat_aligned_strums(chords, beat_times, bpm)
        strum_events = _merge_strums(beat_strums, onset_strums)

        logger.info(
            "Combined strum detection: bpm=%.1f, %d beat-aligned strums, "
            "%d onset strums, %d merged total (%d down, %d up)",
            bpm,
            len(beat_strums),
            len(onset_strums),
            len(strum_events),
            sum(1 for s in strum_events if s.direction == "down"),
            sum(1 for s in strum_events if s.direction == "up"),
        )
    else:
        # Fallback: onset-only mode (original behavior)
        strum_events = []
        strum_id = 0
        for os_ in onset_strums:
            strum_events.append(
                StrumEvent(
                    id=strum_id,
                    start_time=os_.start_time,
                    end_time=os_.end_time,
                    direction=os_.direction,
                    confidence=os_.confidence,
                    num_strings=os_.num_strings,
                    onset_spread_ms=os_.onset_spread_ms,
                )
            )

            for i in os_.note_indices:
                notes[i].strum_id = strum_id

            strum_id += 1

        logger.info(
            "Onset-only strum detection: %d strums (%d down, %d up, %d ambiguous)",
            len(strum_events),
            sum(1 for s in strum_events if s.direction == "down"),
            sum(1 for s in strum_events if s.direction == "up"),
            sum(1 for s in strum_events if s.direction == "ambiguous"),
        )

    return notes, strum_events
