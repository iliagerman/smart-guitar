"""Align external strum patterns to detected beat grid.

Takes strumming patterns from Songsterr and aligns them to the audio's
detected beat positions using tempo scaling and cross-correlation offset.
"""

import bisect
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ExternalStrum:
    beat_position: float
    time_seconds: float
    direction: str  # "down" | "up"
    num_strings: int


@dataclass
class ExternalStrumPattern:
    source: str
    source_bpm: float
    strums: list[ExternalStrum] = field(default_factory=list)


@dataclass
class AlignedStrum:
    id: int
    start_time: float
    end_time: float
    direction: str
    confidence: float
    num_strings: int
    onset_spread_ms: float = 0.0


def _compute_cross_correlation_offset(
    external_times: list[float],
    beat_times: list[float],
    max_offset: float = 30.0,
    step: float = 0.05,
    tolerance: float = 0.08,
) -> tuple[float, float]:
    """Find the time offset that best aligns external strum times with detected beats.

    Only uses strums that fall on downbeats (near beat positions in the source)
    for correlation, since sub-beat strums aren't expected to land on detected beats.
    """
    if not external_times or not beat_times:
        return 0.0, 0.0

    sorted_beats = sorted(beat_times)
    best_corr = 0.0
    best_offset = 0.0
    n_steps = int(max_offset / step)

    for lag_i in range(-n_steps, n_steps + 1):
        offset = lag_i * step
        corr = 0.0
        for t in external_times:
            shifted = t + offset
            idx = bisect.bisect_left(sorted_beats, shifted)
            for ci in (idx - 1, idx):
                if 0 <= ci < len(sorted_beats):
                    if abs(sorted_beats[ci] - shifted) <= tolerance:
                        corr += 1.0
                        break
        if corr > best_corr:
            best_corr = corr
            best_offset = offset

    strength = best_corr / max(len(external_times), 1)
    return best_offset, strength


def _compute_downbeat_correlation(
    external_times: list[float],
    external_beat_positions: list[float],
    beat_times: list[float],
    offset: float,
    ratio: float,
    tolerance: float = 0.12,
) -> float:
    """Compute alignment quality using only strums on integer beat positions.

    Strums on sub-beats (eighths, sixteenths) aren't expected to align with
    detected beats, so we only check strums near integer beat positions.
    """
    sorted_beats = sorted(beat_times)
    matches = 0
    checked = 0

    for t, bp in zip(external_times, external_beat_positions):
        # Only check strums near integer beat positions
        frac = bp % 1.0
        if frac > 0.15 and frac < 0.85:
            continue

        checked += 1
        shifted = t * ratio + offset
        idx = bisect.bisect_left(sorted_beats, shifted)
        for ci in (idx - 1, idx):
            if 0 <= ci < len(sorted_beats):
                if abs(sorted_beats[ci] - shifted) <= tolerance:
                    matches += 1
                    break

    return matches / max(checked, 1)


def _snap_to_beat_grid(
    time: float,
    beat_times: list[float],
    snap_tolerance: float = 0.1,
) -> float:
    """Snap a time to the nearest beat if within tolerance."""
    if not beat_times:
        return time

    idx = bisect.bisect_left(beat_times, time)
    best_dist = float("inf")
    best_beat = time

    for ci in (idx - 1, idx):
        if 0 <= ci < len(beat_times):
            dist = abs(beat_times[ci] - time)
            if dist < best_dist:
                best_dist = dist
                best_beat = beat_times[ci]

    return best_beat if best_dist <= snap_tolerance else time


def align_strums(
    pattern: ExternalStrumPattern,
    beat_times: list[float],
    detected_bpm: float,
    min_confidence: float = 0.6,
) -> list[AlignedStrum] | None:
    """Align external strum pattern to detected beat grid."""
    if not pattern.strums or not beat_times:
        logger.info("Cannot align: no strums or no beat_times")
        return None

    source_bpm = pattern.source_bpm
    if source_bpm <= 0:
        source_bpm = 120.0

    # Check BPM compatibility (including double/half time)
    tempo_ratio = detected_bpm / source_bpm
    best_ratio = tempo_ratio
    for candidate in [tempo_ratio, tempo_ratio * 2, tempo_ratio / 2]:
        if abs(candidate - 1.0) < abs(best_ratio - 1.0):
            best_ratio = candidate

    if abs(best_ratio - 1.0) > 0.2:
        logger.info(
            "BPM mismatch too large: source=%.1f detected=%.1f ratio=%.2f",
            source_bpm, detected_bpm, best_ratio,
        )
        return None

    scaled_times = [s.time_seconds * best_ratio for s in pattern.strums]

    # Find best offset using all strums
    offset, raw_corr = _compute_cross_correlation_offset(scaled_times, beat_times)

    # Measure quality using only downbeat strums (on integer beat positions)
    beat_positions = [s.beat_position for s in pattern.strums]
    raw_times = [s.time_seconds for s in pattern.strums]
    downbeat_corr = _compute_downbeat_correlation(
        raw_times, beat_positions, beat_times, offset, best_ratio,
    )

    logger.info(
        "Alignment: ratio=%.3f, offset=%.3fs, raw_corr=%.3f, downbeat_corr=%.3f",
        best_ratio, offset, raw_corr, downbeat_corr,
    )

    corr_strength = max(raw_corr, downbeat_corr)

    if corr_strength < min_confidence:
        logger.info("Alignment confidence too low: %.3f < %.3f", corr_strength, min_confidence)
        return None

    song_duration = beat_times[-1] + 10.0
    aligned: list[AlignedStrum] = []

    for i, strum in enumerate(pattern.strums):
        aligned_time = strum.time_seconds * best_ratio + offset
        snapped_time = _snap_to_beat_grid(aligned_time, beat_times)

        if snapped_time < -0.5 or snapped_time > song_duration:
            continue

        if i + 1 < len(pattern.strums):
            next_time = pattern.strums[i + 1].time_seconds * best_ratio + offset
            end_time = min(next_time, snapped_time + 1.0)
        else:
            end_time = snapped_time + 0.5

        aligned.append(
            AlignedStrum(
                id=len(aligned),
                start_time=round(snapped_time, 4),
                end_time=round(end_time, 4),
                direction=strum.direction,
                confidence=round(min(0.95, corr_strength + 0.15), 3),
                num_strings=strum.num_strings,
            )
        )

    if not aligned:
        logger.info("No strums remained after alignment and filtering")
        return None

    logger.info(
        "Aligned %d strums (%d down, %d up)",
        len(aligned),
        sum(1 for s in aligned if s.direction == "down"),
        sum(1 for s in aligned if s.direction == "up"),
    )

    return aligned
