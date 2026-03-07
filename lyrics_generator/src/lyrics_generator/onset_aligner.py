"""Audio onset detection for word-level alignment within LRC lines.

Uses energy-based onset detection on the vocals audio to find where each
word starts within a line, producing more accurate word timestamps than
even distribution.

The approach:
1. Compute log-energy (RMS in dB) in small windows across each line's audio.
2. Compute onset strength as the half-wave-rectified first derivative.
3. Pick N onset peaks (one per word) to locate actual word starts.
4. Find energy valleys between consecutive onsets to tighten word boundaries.
"""

from __future__ import annotations

import logging

import numpy as np

from .schemas import SegmentInfo, WordInfo

logger = logging.getLogger(__name__)

_SR = 16000  # Analysis sample rate (matches faster-whisper default)
_HOP_S = 0.010  # 10ms hop between energy frames
_WIN_S = 0.025  # 25ms energy window
_MIN_PEAK_DISTANCE_S = 0.06  # Minimum 60ms between detected onsets

# Vocal bandpass filter range (Hz).  Attenuates guitar-strum transients that
# bleed through Demucs vocal separation and would otherwise dominate onset
# detection (strums have very sharp low-freq transients).
_VOCAL_LOW_HZ = 250.0
_VOCAL_HIGH_HZ = 4000.0


def load_audio(audio_path: str) -> np.ndarray:
    """Load audio as mono float32 at 16kHz using faster-whisper's decoder."""
    from faster_whisper.audio import decode_audio

    return decode_audio(audio_path, sampling_rate=_SR)


def _bandpass_filter(
    samples: np.ndarray,
    sr: int = _SR,
    low_hz: float = _VOCAL_LOW_HZ,
    high_hz: float = _VOCAL_HIGH_HZ,
    transition_hz: float = 50.0,
) -> np.ndarray:
    """Apply an FFT-based bandpass filter to focus on vocal frequencies.

    Attenuates guitar strum transients (low freq) and pick noise (high freq)
    that bleed into the vocals stem from imperfect Demucs separation.

    Uses cosine (Hann) tapers over *transition_hz* at each edge instead of
    a brick-wall cutoff, avoiding Gibbs-phenomenon ringing that can shift
    onset detection timing by 10-30ms.
    """
    n = len(samples)
    if n == 0:
        return samples
    freqs = np.fft.rfftfreq(n, d=1.0 / sr)
    fft = np.fft.rfft(samples)

    # Build smooth gain mask with cosine tapers at the edges
    low_start = max(0.0, low_hz - transition_hz)
    high_end = high_hz + transition_hz

    gain = np.ones_like(freqs)
    # Below passband: zero
    gain[freqs < low_start] = 0.0
    # Low taper: cosine ramp from 0 to 1
    low_taper = (freqs >= low_start) & (freqs < low_hz)
    if transition_hz > 0 and np.any(low_taper):
        gain[low_taper] = 0.5 * (1.0 - np.cos(np.pi * (freqs[low_taper] - low_start) / transition_hz))
    # High taper: cosine ramp from 1 to 0
    high_taper = (freqs > high_hz) & (freqs <= high_end)
    if transition_hz > 0 and np.any(high_taper):
        gain[high_taper] = 0.5 * (1.0 + np.cos(np.pi * (freqs[high_taper] - high_hz) / transition_hz))
    # Above passband: zero
    gain[freqs > high_end] = 0.0

    fft *= gain
    return np.fft.irfft(fft, n=n).astype(np.float32)


def _compute_energy(samples: np.ndarray) -> np.ndarray:
    """Compute per-frame log-RMS energy (dB scale).

    Returns one value per hop (10ms). Uses log scale for better sensitivity
    across the dynamic range of vocals.
    """
    hop = int(_HOP_S * _SR)
    win = int(_WIN_S * _SR)

    if len(samples) < win:
        return np.array([])

    n_frames = (len(samples) - win) // hop + 1
    energy = np.empty(n_frames)

    for i in range(n_frames):
        frame = samples[i * hop : i * hop + win]
        rms = np.sqrt(np.mean(frame**2) + 1e-10)
        energy[i] = 20.0 * np.log10(rms + 1e-10)  # dB scale

    return energy


def _compute_onset_strength(samples: np.ndarray) -> np.ndarray:
    """Compute onset strength from log-energy.

    Returns one value per hop (10ms), representing how sharply energy
    increased at that frame. High values = likely word/syllable onset.
    """
    energy = _compute_energy(samples)

    if len(energy) < 2:
        return np.array([])

    # Half-wave rectified first difference: only rising edges
    onset = np.diff(energy)
    onset = np.maximum(onset, 0)

    return onset


def _pick_n_peaks(
    signal: np.ndarray,
    n: int,
    min_distance: int,
    *,
    min_strength_ratio: float = 0.25,
) -> list[int]:
    """Pick the top N peaks from a 1-D signal, respecting minimum distance.

    Peaks whose strength is below ``min_strength_ratio * median_strength``
    are discarded before selection.  This filters out weak peaks caused by
    guitar bleed or noise that would otherwise be chosen when the requested
    N exceeds the number of genuine vocal onsets.

    Returns frame indices sorted by time.
    """
    if len(signal) == 0 or n <= 0:
        return []

    # Find all local maxima (plus check edges)
    candidates: list[tuple[int, float]] = []
    for i in range(len(signal)):
        left_ok = i == 0 or signal[i] >= signal[i - 1]
        right_ok = i == len(signal) - 1 or signal[i] >= signal[i + 1]
        if left_ok and right_ok and signal[i] > 0:
            candidates.append((i, float(signal[i])))

    # Filter out peaks below the confidence threshold
    if candidates and min_strength_ratio > 0:
        strengths = [s for _, s in candidates]
        median_strength = float(np.median(strengths))
        threshold = median_strength * min_strength_ratio
        candidates = [(idx, s) for idx, s in candidates if s >= threshold]

    # Sort by strength descending
    candidates.sort(key=lambda x: -x[1])

    # Greedily pick, respecting minimum distance
    selected: list[int] = []
    for frame_idx, _ in candidates:
        if len(selected) >= n:
            break
        if any(abs(frame_idx - s) < min_distance for s in selected):
            continue
        selected.append(frame_idx)

    selected.sort()
    return selected


def _find_valley(energy: np.ndarray, start_frame: int, end_frame: int) -> int:
    """Find the frame with minimum energy between two frames.

    Used to locate the silence gap between consecutive words.
    """
    if start_frame >= end_frame or start_frame >= len(energy):
        return start_frame
    end_frame = min(end_frame, len(energy))
    region = energy[start_frame:end_frame]
    return start_frame + int(np.argmin(region))


def _align_words_in_line(
    words: list[str],
    audio: np.ndarray,
    line_start: float,
    line_end: float,
) -> list[WordInfo]:
    """Align words within a single line using onset detection.

    Finds N onset peaks (one per word) and tightens boundaries by detecting
    energy valleys between consecutive onsets.
    """
    n = len(words)
    if n == 0:
        return []
    if n == 1:
        return [WordInfo(word=words[0], start=round(line_start, 3), end=round(line_end, 3))]

    # Extract the audio segment for this line
    s0 = max(0, int(line_start * _SR))
    s1 = min(len(audio), int(line_end * _SR))
    segment = audio[s0:s1]

    if len(segment) < int(_WIN_S * _SR):
        return _even_distribution(words, line_start, line_end)

    # Apply vocal bandpass filter to suppress guitar bleed before computing
    # energy.  This is the key fix for onset detection picking up strum
    # transients instead of vocal onsets.
    filtered = _bandpass_filter(segment)
    energy = _compute_energy(filtered)
    onset = _compute_onset_strength(filtered)

    if len(onset) == 0:
        return _even_distribution(words, line_start, line_end)

    min_dist = max(1, int(_MIN_PEAK_DISTANCE_S / _HOP_S))

    # Find N onset peaks — one per word (including the first word).
    # This detects the actual start of each word rather than assuming
    # the first word begins at line_start.
    all_peaks = _pick_n_peaks(onset, n, min_dist)

    logger.debug(
        "align_words line=%.2f-%.2f: requested=%d peaks, found=%d",
        line_start, line_end, n, len(all_peaks),
    )

    if len(all_peaks) >= n:
        # Convert onset frame indices to absolute times
        # +1 because onset is from np.diff (offset by one frame)
        onset_times = [line_start + (f + 1) * _HOP_S for f in all_peaks]
    elif len(all_peaks) > 0:
        # Found some but not enough. Missing onsets are typically at the
        # start (the first word's onset is hard to detect when audio begins
        # with vocals). Distribute missing words before the first detected peak.
        detected_times = [line_start + (f + 1) * _HOP_S for f in all_peaks]
        missing = n - len(detected_times)
        first_detected = detected_times[0]
        pre_gap = first_detected - line_start
        if pre_gap > 0 and missing > 0:
            step = pre_gap / (missing + 1)
            prefix = [line_start + (i + 1) * step for i in range(missing)]
            onset_times = prefix + detected_times
        else:
            # If no room before first peak, fill after the last peak
            onset_times = list(detected_times)
            while len(onset_times) < n:
                last = onset_times[-1]
                remaining = n - len(onset_times)
                gap = (line_end - last) / (remaining + 1)
                onset_times.append(last + gap)
    else:
        return _even_distribution(words, line_start, line_end)

    # Tighten word boundaries using energy valleys.
    # Instead of word_i ending at word_{i+1}'s onset, find the energy
    # minimum between consecutive onsets. The valley marks the silence
    # gap — split there so each word only covers its active vocal region.
    result: list[WordInfo] = []
    for i, word in enumerate(words):
        ws = onset_times[i]

        if i + 1 < n:
            # Find the energy valley between this onset and the next
            frame_start = int((onset_times[i] - line_start) / _HOP_S)
            frame_end = int((onset_times[i + 1] - line_start) / _HOP_S)

            # Search the full inter-onset range for the energy valley, but
            # prefer second-half valleys (words tend to end near the midpoint)
            # unless a first-half valley is significantly deeper (3dB).
            mid_frame = (frame_start + frame_end) // 2
            full_valley = _find_valley(energy, frame_start + 1, frame_end)
            if full_valley < mid_frame and mid_frame < frame_end:
                second_half_valley = _find_valley(energy, mid_frame, frame_end)
                depth_advantage = energy[second_half_valley] - energy[full_valley]
                valley_frame = full_valley if depth_advantage >= 3.0 else second_half_valley
            else:
                valley_frame = full_valley
            we = line_start + valley_frame * _HOP_S
            # Ensure end > start
            if we <= ws:
                we = onset_times[i + 1]
        else:
            we = line_end

        # Ensure end > start
        if we <= ws:
            we = ws + 0.05

        result.append(WordInfo(word=word, start=round(ws, 3), end=round(we, 3)))

    # Extend first word backward to line_start for continuous coverage,
    # but only if the pre-word region is mostly silent (not an
    # instrumental pickup).  Use energy analysis instead of a fixed
    # threshold to avoid absorbing guitar pickups into the first word.
    gap_to_start = result[0].start - line_start
    if 0 < gap_to_start < 0.8:
        gap_end_frame = int(gap_to_start / _HOP_S)
        if gap_end_frame > 0 and gap_end_frame <= len(energy):
            gap_energy = energy[:gap_end_frame]
            seg_25th = float(np.percentile(energy, 25))
            if float(np.median(gap_energy)) <= seg_25th:
                result[0] = WordInfo(
                    word=result[0].word,
                    start=round(line_start, 3),
                    end=result[0].end,
                )
        elif gap_to_start < 0.3:
            # Very short gap with insufficient energy data — extend anyway
            result[0] = WordInfo(
                word=result[0].word,
                start=round(line_start, 3),
                end=result[0].end,
            )

    return result


def _even_distribution(words: list[str], start: float, end: float) -> list[WordInfo]:
    """Fallback: distribute words proportionally by character count.

    Longer words get proportionally more time than short ones, providing
    a better approximation of natural pronunciation rhythm than uniform
    distribution.
    """
    duration = end - start
    char_counts = [max(len(w), 1) for w in words]
    total_chars = sum(char_counts)
    result: list[WordInfo] = []
    t = start
    for i, w in enumerate(words):
        wd = duration * char_counts[i] / total_chars
        ws = t
        we = round(t + wd, 3) if i < len(words) - 1 else round(end, 3)
        result.append(WordInfo(word=w, start=round(ws, 3), end=we))
        t = we
    return result


def refine_segments_with_onsets(
    segments: list[SegmentInfo],
    audio: np.ndarray,
    *,
    trust_existing_words: bool = False,
    max_drift_s: float = 0.25,
) -> list[SegmentInfo]:
    """Replace evenly-distributed word timestamps with onset-detected ones.

    Args:
        segments: Segments with word timestamps (from LRC or Whisper).
        audio: Mono float32 audio at 16kHz (from load_audio).
        trust_existing_words: When True (e.g. Whisper source), preserve the
            original word timestamp if the onset-aligned time diverges by
            more than *max_drift_s*.  Prevents onset alignment from making
            already-decent Whisper timestamps worse when peaks correspond to
            guitar bleed rather than vocal onsets.
        max_drift_s: Maximum allowed drift (seconds) between the onset-aligned
            and original word start before the original is preserved.

    Returns:
        New list of SegmentInfo with onset-aligned word timestamps.
    """
    refined: list[SegmentInfo] = []
    total_words = 0
    preserved_words = 0

    for seg in segments:
        word_texts = [w.word for w in seg.words] if seg.words else seg.text.split()
        if not word_texts:
            refined.append(seg)
            continue

        aligned_words = _align_words_in_line(word_texts, audio, seg.start, seg.end)

        # When the source already has meaningful word timestamps (Whisper),
        # keep the original where the onset-aligned version drifts too far.
        if trust_existing_words and seg.words and len(seg.words) == len(aligned_words):
            merged: list[WordInfo] = []
            for orig, aligned in zip(seg.words, aligned_words):
                total_words += 1
                if abs(aligned.start - orig.start) > max_drift_s:
                    preserved_words += 1
                    merged.append(WordInfo(
                        word=aligned.word,
                        start=orig.start,
                        end=orig.end,
                    ))
                else:
                    merged.append(aligned)
            aligned_words = merged

        refined.append(
            SegmentInfo(
                start=seg.start,
                end=seg.end,
                text=seg.text,
                words=aligned_words,
            )
        )

    if trust_existing_words and total_words > 0:
        logger.info(
            "Refined %d segments: %d/%d words preserved from Whisper (drift > %.0fms)",
            len(refined), preserved_words, total_words, max_drift_s * 1000,
        )
    else:
        logger.info("Refined %d segments with onset detection", len(refined))

    return refined


# ---------------------------------------------------------------------------
# Fast-track: speech detection + plain lyrics alignment
# ---------------------------------------------------------------------------


def detect_speech_segments(
    audio: np.ndarray,
    *,
    min_speech_s: float = 0.3,
    min_silence_s: float = 0.25,
) -> list[tuple[float, float]]:
    """Detect speech regions using energy thresholding on bandpass-filtered audio.

    1. Bandpass filter (250-4000 Hz vocal range)
    2. Compute per-frame RMS energy
    3. Dynamic threshold: frames above (median + 0.3 * (mean - median)) = speech
    4. Merge speech frames within *min_silence_s* of each other
    5. Discard segments shorter than *min_speech_s*

    Returns:
        List of (start_seconds, end_seconds) tuples for detected speech regions.
    """
    filtered = _bandpass_filter(audio)
    energy = _compute_energy(filtered)

    if len(energy) < 2:
        return []

    median_e = float(np.median(energy))
    mean_e = float(np.mean(energy))
    threshold = median_e + 0.3 * (mean_e - median_e)

    # Mark frames as speech/silence
    is_speech = energy >= threshold

    # Convert frame mask to contiguous regions
    regions: list[tuple[float, float]] = []
    in_region = False
    region_start = 0.0

    for i, speech in enumerate(is_speech):
        t = i * _HOP_S
        if speech and not in_region:
            region_start = t
            in_region = True
        elif not speech and in_region:
            regions.append((region_start, t))
            in_region = False

    # Close final region if still in speech at end of audio
    if in_region:
        regions.append((region_start, len(energy) * _HOP_S))

    if not regions:
        return []

    # Merge regions separated by less than min_silence_s
    merged: list[tuple[float, float]] = [regions[0]]
    for start, end in regions[1:]:
        prev_start, prev_end = merged[-1]
        if start - prev_end < min_silence_s:
            merged[-1] = (prev_start, end)
        else:
            merged.append((start, end))

    # Discard segments shorter than min_speech_s
    return [(s, e) for s, e in merged if e - s >= min_speech_s]


def align_plain_lyrics(
    lines: list[str],
    audio: np.ndarray,
    total_duration: float,
) -> list[SegmentInfo]:
    """Align plain lyrics (no timestamps) to audio using speech detection.

    Uses energy-based speech segment detection to find vocal regions, then
    maps text lines to those regions and refines word boundaries with onset
    detection.

    Args:
        lines: Non-empty text lines from plain lyrics.
        audio: Mono float32 audio at 16kHz (from load_audio).
        total_duration: Total audio duration in seconds.

    Returns:
        List of SegmentInfo with word-level timestamps.
    """
    if not lines:
        return []

    speech_regions = detect_speech_segments(audio)

    if not speech_regions:
        # Fallback: distribute lines evenly across the audio
        logger.warning("No speech detected; distributing %d lines evenly", len(lines))
        return _distribute_lines_evenly(lines, 0.0, total_duration, audio)

    n_lines = len(lines)
    n_regions = len(speech_regions)

    if n_lines == n_regions:
        # 1:1 mapping
        pairs = list(zip(lines, speech_regions))
    elif n_lines <= n_regions:
        # More speech regions than lines — assign lines to the longest regions
        sorted_regions = sorted(
            enumerate(speech_regions),
            key=lambda x: x[1][1] - x[1][0],
            reverse=True,
        )
        selected = sorted(sorted_regions[:n_lines], key=lambda x: x[0])
        pairs = [(lines[i], speech_regions[idx]) for i, (idx, _) in enumerate(selected)]
    else:
        # More lines than regions — group consecutive lines into regions
        pairs = _group_lines_into_regions(lines, speech_regions)

    segments: list[SegmentInfo] = []
    for text, (seg_start, seg_end) in pairs:
        words = text.split()
        if not words:
            continue
        aligned_words = _align_words_in_line(words, audio, seg_start, seg_end)
        segments.append(SegmentInfo(
            start=round(seg_start, 3),
            end=round(seg_end, 3),
            text=text,
            words=aligned_words,
        ))

    logger.info(
        "Plain lyrics aligned: %d lines -> %d segments (%d speech regions detected)",
        n_lines, len(segments), n_regions,
    )
    return segments


def _group_lines_into_regions(
    lines: list[str],
    regions: list[tuple[float, float]],
) -> list[tuple[str, tuple[float, float]]]:
    """Group N lines (N > M) into M speech regions proportionally.

    Distributes lines across regions based on region duration — longer
    regions get more lines.
    """
    n_lines = len(lines)
    n_regions = len(regions)
    durations = [e - s for s, e in regions]
    total_dur = sum(durations)

    # Assign line counts proportionally, ensuring each region gets at least 1
    line_counts: list[int] = []
    remaining = n_lines
    for i, dur in enumerate(durations):
        if i == n_regions - 1:
            count = remaining
        else:
            count = max(1, round(n_lines * dur / total_dur))
            count = min(count, remaining - (n_regions - 1 - i))
        line_counts.append(count)
        remaining -= count

    pairs: list[tuple[str, tuple[float, float]]] = []
    line_idx = 0
    for region, count in zip(regions, line_counts):
        group_text = " ".join(lines[line_idx : line_idx + count])
        pairs.append((group_text, region))
        line_idx += count

    return pairs


def _distribute_lines_evenly(
    lines: list[str],
    start: float,
    end: float,
    audio: np.ndarray,
) -> list[SegmentInfo]:
    """Fallback: distribute lines evenly across a time range with onset alignment."""
    duration = end - start
    n = len(lines)
    seg_dur = duration / n

    segments: list[SegmentInfo] = []
    for i, text in enumerate(lines):
        seg_start = start + i * seg_dur
        seg_end = start + (i + 1) * seg_dur if i < n - 1 else end
        words = text.split()
        if not words:
            continue
        aligned_words = _align_words_in_line(words, audio, seg_start, seg_end)
        segments.append(SegmentInfo(
            start=round(seg_start, 3),
            end=round(seg_end, 3),
            text=text,
            words=aligned_words,
        ))
    return segments
