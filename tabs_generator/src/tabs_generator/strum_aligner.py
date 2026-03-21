"""Align external strum patterns to detected beat grid.

Takes strumming patterns extracted from Guitar Pro files and aligns them
to the audio's detected beat positions using tempo scaling and
cross-correlation offset detection.
"""

import logging
from dataclasses import dataclass

import numpy as np

from tabs_generator.external_strum_parser import ExternalStrumPattern

logger = logging.getLogger(__name__)


@dataclass
class AlignedStrum:
    """A strum event aligned to actual audio timestamps."""

    id: int
    start_time: float
    end_time: float
    direction: str  # "down" | "up"
    confidence: float
    num_strings: int
    onset_spread_ms: float = 0.0


def _compute_cross_correlation_offset(
    external_times: list[float],
    beat_times: list[float],
    resolution: float = 0.01,
    max_offset: float = 30.0,
) -> tuple[float, float]:
    """Find the time offset that best aligns external strum times with detected beats.

    Uses cross-correlation on binary onset vectors.

    Returns:
        (best_offset, correlation_strength) where offset is added to external times.
    """
    if not external_times or not beat_times:
        return 0.0, 0.0

    duration = max(max(external_times), max(beat_times)) + max_offset
    n_bins = int(duration / resolution) + 1

    # Create binary onset vectors
    ext_vector = np.zeros(n_bins)
    for t in external_times:
        idx = int(t / resolution)
        if 0 <= idx < n_bins:
            ext_vector[idx] = 1.0

    beat_vector = np.zeros(n_bins)
    for t in beat_times:
        idx = int(t / resolution)
        if 0 <= idx < n_bins:
            beat_vector[idx] = 1.0

    # Cross-correlate
    max_lag = int(max_offset / resolution)
    best_corr = 0.0
    best_offset = 0.0

    for lag in range(-max_lag, max_lag + 1):
        offset = lag * resolution
        corr = 0.0
        for t in external_times:
            shifted = t + offset
            idx = int(shifted / resolution)
            if 0 <= idx < n_bins:
                # Check if there's a beat nearby (within 50ms tolerance)
                window = 5  # 50ms at 10ms resolution
                start = max(0, idx - window)
                end = min(n_bins, idx + window + 1)
                if np.any(beat_vector[start:end]):
                    corr += 1.0

        if corr > best_corr:
            best_corr = corr
            best_offset = offset

    # Normalize correlation strength
    strength = best_corr / max(len(external_times), 1)

    return best_offset, strength


def _snap_to_beat_grid(
    time: float,
    beat_times: list[float],
    snap_tolerance: float = 0.1,
) -> float:
    """Snap a time to the nearest beat if within tolerance, otherwise keep as-is."""
    if not beat_times:
        return time

    # Binary search for nearest beat
    idx = np.searchsorted(beat_times, time)

    best_dist = float("inf")
    best_beat = time

    for candidate_idx in (idx - 1, idx):
        if 0 <= candidate_idx < len(beat_times):
            dist = abs(beat_times[candidate_idx] - time)
            if dist < best_dist:
                best_dist = dist
                best_beat = beat_times[candidate_idx]

    if best_dist <= snap_tolerance:
        return best_beat
    return time


def align_strums(
    pattern: ExternalStrumPattern,
    beat_times: list[float],
    detected_bpm: float,
    min_confidence: float = 0.6,
) -> list[AlignedStrum] | None:
    """Align external strum pattern to detected beat grid.

    Args:
        pattern: External strumming pattern from Guitar Pro file.
        beat_times: Detected beat positions in seconds from the audio.
        detected_bpm: Detected BPM from the audio.
        min_confidence: Minimum alignment confidence to accept the result.

    Returns:
        List of AlignedStrum events, or None if alignment quality is too low.
    """
    if not pattern.strums or not beat_times:
        logger.info("Cannot align: no strums or no beat_times")
        return None

    source_bpm = pattern.source_bpm
    if source_bpm <= 0:
        source_bpm = 120.0

    # Check BPM compatibility
    tempo_ratio = detected_bpm / source_bpm

    # Also check double/half time
    best_ratio = tempo_ratio
    for candidate_ratio in [tempo_ratio, tempo_ratio * 2, tempo_ratio / 2]:
        if abs(candidate_ratio - 1.0) < abs(best_ratio - 1.0):
            best_ratio = candidate_ratio

    if abs(best_ratio - 1.0) > 0.2:
        logger.info(
            "BPM mismatch too large: source=%.1f detected=%.1f ratio=%.2f",
            source_bpm,
            detected_bpm,
            best_ratio,
        )
        return None

    # Scale external times by tempo ratio
    scaled_times = [s.time_seconds * best_ratio for s in pattern.strums]

    # Find best time offset via cross-correlation
    offset, corr_strength = _compute_cross_correlation_offset(
        scaled_times, beat_times
    )

    logger.info(
        "Alignment: ratio=%.3f, offset=%.3fs, correlation=%.3f",
        best_ratio,
        offset,
        corr_strength,
    )

    if corr_strength < min_confidence:
        logger.info(
            "Alignment confidence too low: %.3f < %.3f",
            corr_strength,
            min_confidence,
        )
        return None

    # Apply offset and snap to beat grid
    song_duration = beat_times[-1] + 10.0 if beat_times else 0.0
    aligned: list[AlignedStrum] = []

    for i, strum in enumerate(pattern.strums):
        aligned_time = strum.time_seconds * best_ratio + offset
        snapped_time = _snap_to_beat_grid(aligned_time, beat_times)

        # Skip strums before the song starts or too far after
        if snapped_time < -0.5 or snapped_time > song_duration:
            continue

        # Estimate end_time from next strum or a small default
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
