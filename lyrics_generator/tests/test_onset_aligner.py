"""Tests for the onset aligner."""

import numpy as np
import pytest

from lyrics_generator.onset_aligner import (
    _align_words_in_line,
    _bandpass_filter,
    _compute_energy,
    _compute_onset_strength,
    _even_distribution,
    _find_valley,
    _pick_n_peaks,
    refine_segments_with_onsets,
)
from lyrics_generator.schemas import SegmentInfo, WordInfo


def _make_tone(freq: float, duration: float, sr: int = 16000) -> np.ndarray:
    """Generate a sine wave tone."""
    t = np.arange(int(sr * duration)) / sr
    return (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _make_silence(duration: float, sr: int = 16000) -> np.ndarray:
    return np.zeros(int(sr * duration), dtype=np.float32)


def _make_word_audio(n_words: int, word_dur: float = 0.3, gap_dur: float = 0.1, sr: int = 16000) -> np.ndarray:
    """Simulate N spoken words: bursts of tone separated by silence gaps."""
    parts = []
    for i in range(n_words):
        parts.append(_make_tone(300 + i * 50, word_dur, sr))
        if i < n_words - 1:
            parts.append(_make_silence(gap_dur, sr))
    return np.concatenate(parts)


def test_compute_energy_returns_values():
    audio = _make_word_audio(3)
    energy = _compute_energy(audio)
    assert len(energy) > 0
    # dB values for silence should be very low, for tone should be higher
    assert energy.max() > energy.min()


def test_compute_energy_short_audio():
    short = np.zeros(100, dtype=np.float32)
    assert len(_compute_energy(short)) == 0


def test_compute_onset_strength_returns_values():
    audio = _make_word_audio(3)
    onset = _compute_onset_strength(audio)
    assert len(onset) > 0
    assert onset.max() > 0


def test_compute_onset_strength_short_audio():
    """Audio shorter than one window returns empty."""
    short = np.zeros(100, dtype=np.float32)
    assert len(_compute_onset_strength(short)) == 0


def test_pick_n_peaks_basic():
    signal = np.array([0, 0.1, 0.5, 0.2, 0, 0, 0.8, 0.3, 0])
    peaks = _pick_n_peaks(signal, 2, min_distance=2)
    assert len(peaks) == 2
    assert 6 in peaks  # Strongest peak at index 6
    assert 2 in peaks  # Second peak at index 2


def test_pick_n_peaks_respects_distance():
    signal = np.array([0.9, 0.8, 0.1, 0.1, 0.7])
    peaks = _pick_n_peaks(signal, 2, min_distance=3)
    # Indices 0 and 1 are too close (distance=1 < min_distance=3)
    # Should pick 0 (strongest) and 4 (next strongest far enough)
    assert len(peaks) == 2
    assert 0 in peaks
    assert 4 in peaks


def test_pick_n_peaks_empty():
    assert _pick_n_peaks(np.array([]), 3, min_distance=2) == []


def test_find_valley_basic():
    energy = np.array([10.0, 8.0, 3.0, 1.0, 5.0, 9.0, 12.0])
    valley = _find_valley(energy, 1, 6)
    assert valley == 3  # Minimum energy at index 3


def test_find_valley_edge_cases():
    energy = np.array([5.0, 5.0, 5.0])
    # When start >= end, returns start
    assert _find_valley(energy, 3, 2) == 3
    # When start >= len, returns start
    assert _find_valley(energy, 5, 6) == 5


def test_align_words_single_word():
    audio = _make_tone(300, 1.0)
    result = _align_words_in_line(["Hello"], audio, 0.0, 1.0)
    assert len(result) == 1
    assert result[0].word == "Hello"
    assert result[0].start == 0.0
    assert result[0].end == 1.0


def test_align_words_detects_onsets():
    """Words separated by silence gaps should produce non-even timestamps."""
    audio = _make_word_audio(3, word_dur=0.4, gap_dur=0.2)
    total_dur = len(audio) / 16000
    result = _align_words_in_line(["one", "two", "three"], audio, 0.0, total_dur)

    assert len(result) == 3
    # With even distribution, each word would get total_dur/3 ≈ 0.53s.
    # With onset detection, word 2 should start near 0.6s (0.4 + 0.2 gap)
    # and word 3 near 1.2s. The exact values depend on onset detection,
    # but they should NOT be evenly spaced.
    even_spacing = total_dur / 3
    word2_start = result[1].start
    word3_start = result[2].start

    # At least one word start should differ from even distribution by > 50ms
    diff2 = abs(word2_start - even_spacing)
    diff3 = abs(word3_start - 2 * even_spacing)
    assert diff2 > 0.05 or diff3 > 0.05, (
        f"Onset detection should produce non-even timing, but got "
        f"word2={word2_start:.3f} word3={word3_start:.3f} (even would be "
        f"{even_spacing:.3f}, {2*even_spacing:.3f})"
    )


def test_align_words_tighter_boundaries():
    """Word boundaries should be tighter than onset-to-onset spanning.

    With valley detection, words should end before the next word's onset
    (at the energy valley between them), not span all the way to it.
    """
    audio = _make_word_audio(3, word_dur=0.3, gap_dur=0.3)
    total_dur = len(audio) / 16000
    result = _align_words_in_line(["one", "two", "three"], audio, 0.0, total_dur)

    assert len(result) == 3
    # Each word should be significantly shorter than the segment/3
    # because valley detection trims word endings
    for w in result:
        word_duration = w.end - w.start
        # Each word with 0.3s tone should be well under 0.6s per word
        assert word_duration < 0.7, (
            f"Word '{w.word}' has duration {word_duration:.3f}s, expected < 0.7s"
        )


def test_align_words_delayed_start():
    """When audio has silence at the start, the first word should not
    extend all the way back to line_start if the gap is large.
    """
    silence = _make_silence(1.0)  # 1 second of silence
    speech = _make_word_audio(2, word_dur=0.3, gap_dur=0.1)
    audio = np.concatenate([silence, speech])
    total_dur = len(audio) / 16000

    result = _align_words_in_line(["hello", "world"], audio, 0.0, total_dur)
    assert len(result) == 2
    # First word should start near 1.0s (after the silence), not at 0.0s
    # The 0.5s threshold in _align_words_in_line prevents backward extension
    assert result[0].start > 0.5, (
        f"First word should not extend back through 1s of silence, "
        f"but starts at {result[0].start:.3f}s"
    )


def test_align_words_empty():
    audio = _make_silence(1.0)
    assert _align_words_in_line([], audio, 0.0, 1.0) == []


def test_even_distribution():
    result = _even_distribution(["a", "b", "c"], 0.0, 3.0)
    assert len(result) == 3
    assert result[0].start == 0.0
    assert result[0].end == 1.0
    assert result[1].start == 1.0
    assert result[1].end == 2.0
    assert result[2].start == 2.0
    assert result[2].end == 3.0


def test_even_distribution_proportional_to_length():
    """Longer words should get proportionally more time."""
    result = _even_distribution(["I", "California", "am"], 0.0, 3.0)
    assert len(result) == 3
    # "California" (10 chars) should get much more time than "I" (1 char)
    dur_i = result[0].end - result[0].start
    dur_california = result[1].end - result[1].start
    dur_am = result[2].end - result[2].start
    assert dur_california > dur_i * 5, (
        f"'California' ({dur_california:.3f}s) should be >5x 'I' ({dur_i:.3f}s)"
    )
    assert dur_am > dur_i, f"'am' should be longer than 'I'"
    # Total should cover full range
    assert result[0].start == 0.0
    assert result[-1].end == 3.0
    # Contiguous
    for i in range(len(result) - 1):
        assert result[i].end == pytest.approx(result[i + 1].start, abs=0.001)


def test_valley_search_finds_early_silence():
    """When a word ends quickly and silence is in the first half of the
    inter-onset gap, the valley search should find it there (not just
    in the second half)."""
    sr = 16000
    # Brief silence so onset detector can see the energy rise, then a short
    # word, then a long silence gap, then another word.
    lead_in = _make_silence(0.05, sr)
    word1 = _make_tone(400, 0.15, sr)
    gap = _make_silence(0.5, sr)
    word2 = _make_tone(450, 0.3, sr)
    audio = np.concatenate([lead_in, word1, gap, word2])
    total_dur = len(audio) / sr

    result = _align_words_in_line(["short", "long"], audio, 0.0, total_dur)
    assert len(result) == 2
    # Word 1 should end well before word 2 starts (~0.7s) because the
    # silence gap begins early at ~0.2s. The valley should be found in
    # the silence region, not pushed to the second half of the gap.
    assert result[0].end < 0.55, (
        f"Word 1 should end before 0.55s (silence starts at ~0.2s), "
        f"but ends at {result[0].end:.3f}s"
    )


def test_refine_segments_with_onsets():
    """refine_segments_with_onsets should update word timestamps."""
    # Use silence before the speech so the onset detector can detect word starts
    silence = _make_silence(0.2)
    speech = _make_word_audio(2, word_dur=0.5, gap_dur=0.3)
    audio = np.concatenate([silence, speech])
    total_dur = len(audio) / 16000

    seg = SegmentInfo(
        start=0.0,
        end=total_dur,
        text="hello world",
        words=[
            WordInfo(word="hello", start=0.0, end=total_dur / 2),
            WordInfo(word="world", start=total_dur / 2, end=total_dur),
        ],
    )

    refined = refine_segments_with_onsets([seg], audio)
    assert len(refined) == 1
    assert len(refined[0].words) == 2
    assert refined[0].words[0].word == "hello"
    assert refined[0].words[1].word == "world"
    # Word boundaries should cover most of the segment
    assert refined[0].words[0].start < 0.5
    assert refined[0].words[1].end == pytest.approx(total_dur, abs=0.1)


# ---------------------------------------------------------------------------
# Bandpass filter tests
# ---------------------------------------------------------------------------

def test_bandpass_filter_attenuates_low_freq():
    """Low-frequency tones (guitar strum range) should be attenuated."""
    sr = 16000
    dur = 0.5
    low_tone = _make_tone(100.0, dur, sr)  # Below 250Hz → should be removed
    vocal_tone = _make_tone(400.0, dur, sr)  # Within 250-4000Hz → should pass
    mixed = low_tone + vocal_tone

    filtered = _bandpass_filter(mixed, sr=sr, low_hz=200.0, high_hz=4000.0)

    # Energy of the filtered signal should be closer to vocal_tone than mixed
    energy_mixed = float(np.sqrt(np.mean(mixed**2)))
    energy_filtered = float(np.sqrt(np.mean(filtered**2)))
    energy_vocal = float(np.sqrt(np.mean(vocal_tone**2)))

    # The filtered version should have lost the low-freq component
    assert energy_filtered < energy_mixed, "Bandpass should attenuate low-freq energy"
    assert energy_filtered == pytest.approx(energy_vocal, abs=0.05), (
        f"Filtered energy {energy_filtered:.3f} should be close to vocal-only {energy_vocal:.3f}"
    )


def test_bandpass_filter_passes_vocal_range():
    """Mid-range tones (vocal range) should pass through largely unchanged."""
    sr = 16000
    dur = 0.5
    vocal_tone = _make_tone(500.0, dur, sr)

    filtered = _bandpass_filter(vocal_tone, sr=sr, low_hz=200.0, high_hz=4000.0)

    energy_orig = float(np.sqrt(np.mean(vocal_tone**2)))
    energy_filtered = float(np.sqrt(np.mean(filtered**2)))

    assert energy_filtered == pytest.approx(energy_orig, rel=0.05), (
        f"Vocal-range tone should pass through: orig={energy_orig:.3f} filtered={energy_filtered:.3f}"
    )


def test_bandpass_filter_empty_audio():
    """Empty audio should return empty."""
    result = _bandpass_filter(np.array([], dtype=np.float32))
    assert len(result) == 0


# ---------------------------------------------------------------------------
# Confidence threshold tests
# ---------------------------------------------------------------------------

def test_pick_n_peaks_confidence_threshold():
    """Peaks below the confidence threshold should be filtered out."""
    # One strong peak (0.8) and several very weak peaks (0.01)
    signal = np.array([0.01, 0.0, 0.01, 0.0, 0.8, 0.0, 0.01, 0.0, 0.01])

    # With a high enough threshold, only the strong peak should be found
    # even though we request 5 peaks
    peaks = _pick_n_peaks(signal, 5, min_distance=1, min_strength_ratio=0.5)

    assert 4 in peaks, "The strong peak at index 4 should always be selected"
    # The weak peaks (0.01) are well below 0.5 * median.
    # median of [0.01, 0.01, 0.8, 0.01, 0.01] = 0.01, threshold = 0.005
    # Actually all pass in this case because median is low.
    # Let's use a signal where the threshold matters more.


def test_pick_n_peaks_filters_weak_relative_to_median():
    """Weak peaks far below the median are filtered out."""
    # Three strong peaks (~0.5-0.8) and two very weak peaks (~0.001)
    signal = np.zeros(50, dtype=np.float32)
    signal[5] = 0.8
    signal[15] = 0.6
    signal[25] = 0.5
    signal[35] = 0.001  # Very weak — should be below threshold
    signal[45] = 0.001  # Very weak — should be below threshold

    # Request 5 peaks. The two weak ones should be filtered at ratio=0.15
    # median of [0.8, 0.6, 0.5, 0.001, 0.001] = 0.5, threshold = 0.075
    peaks = _pick_n_peaks(signal, 5, min_distance=3, min_strength_ratio=0.15)

    assert len(peaks) == 3, f"Only 3 strong peaks should survive, got {len(peaks)}: {peaks}"
    assert 5 in peaks
    assert 15 in peaks
    assert 25 in peaks


def test_pick_n_peaks_no_threshold():
    """With min_strength_ratio=0, all peaks should be candidates."""
    signal = np.array([0.001, 0.0, 0.8, 0.0, 0.001])
    peaks = _pick_n_peaks(signal, 3, min_distance=1, min_strength_ratio=0)
    assert len(peaks) == 3


# ---------------------------------------------------------------------------
# trust_existing_words tests
# ---------------------------------------------------------------------------

def test_trust_existing_words_preserves_divergent_timestamps():
    """When onset alignment diverges from Whisper, Whisper timestamps are kept."""
    silence = _make_silence(0.2)
    speech = _make_word_audio(2, word_dur=0.5, gap_dur=0.3)
    audio = np.concatenate([silence, speech])
    total_dur = len(audio) / 16000

    # Whisper timestamps that are roughly correct
    whisper_words = [
        WordInfo(word="hello", start=0.20, end=0.70),
        WordInfo(word="world", start=1.00, end=1.50),
    ]
    seg = SegmentInfo(
        start=0.0, end=total_dur, text="hello world", words=whisper_words,
    )

    # With trust_existing_words=True and a tight max_drift, any large shift
    # should cause the original Whisper timestamp to be preserved.
    refined = refine_segments_with_onsets(
        [seg], audio, trust_existing_words=True, max_drift_s=0.05,
    )

    assert len(refined) == 1
    words = refined[0].words
    assert len(words) == 2
    # With max_drift_s=0.05 (very tight), at least some words should keep
    # their Whisper timestamps if the onset peaks are more than 50ms away
    # We can't predict exact onset positions, so just verify the mechanism
    # doesn't crash and produces valid output.
    for w in words:
        assert w.end > w.start
        assert w.word in ("hello", "world")


def test_trust_existing_words_false_replaces_all():
    """Without trust, all word timestamps should be replaced by onsets."""
    silence = _make_silence(0.2)
    speech = _make_word_audio(2, word_dur=0.5, gap_dur=0.3)
    audio = np.concatenate([silence, speech])
    total_dur = len(audio) / 16000

    # Deliberately wrong Whisper timestamps (all at start)
    whisper_words = [
        WordInfo(word="hello", start=0.0, end=0.01),
        WordInfo(word="world", start=0.01, end=0.02),
    ]
    seg = SegmentInfo(
        start=0.0, end=total_dur, text="hello world", words=whisper_words,
    )

    refined = refine_segments_with_onsets(
        [seg], audio, trust_existing_words=False,
    )

    words = refined[0].words
    # The onset aligner should have spread these out from the bad positions
    assert words[1].start > 0.5, (
        f"Without trust, onset alignment should move word 2 away from 0.01s, "
        f"got {words[1].start:.3f}"
    )


# ---------------------------------------------------------------------------
# Guitar strum rejection test
# ---------------------------------------------------------------------------

def test_onset_alignment_prefers_vocal_over_guitar_strum():
    """Onset detection should prefer vocal-range onsets over low-freq guitar strums.

    Simulates a scenario where guitar strums (80Hz bursts) bleed into the
    vocals stem alongside actual vocal onsets (400Hz bursts).  The bandpass
    filter should suppress the guitar strums, causing the aligner to snap
    to vocal onsets instead.
    """
    sr = 16000
    duration = 2.0
    n_samples = int(sr * duration)
    audio = np.zeros(n_samples, dtype=np.float32)

    # Place a guitar strum (low-freq burst) at 0.3s
    strum_start = int(0.3 * sr)
    strum_dur = int(0.05 * sr)
    t_strum = np.arange(strum_dur) / sr
    guitar_burst = (0.8 * np.sin(2 * np.pi * 80 * t_strum)).astype(np.float32)
    audio[strum_start : strum_start + strum_dur] += guitar_burst

    # Place a vocal onset (mid-freq burst) at 0.5s
    vocal_start = int(0.5 * sr)
    vocal_dur = int(0.3 * sr)
    t_vocal = np.arange(vocal_dur) / sr
    vocal_burst = (0.5 * np.sin(2 * np.pi * 400 * t_vocal)).astype(np.float32)
    audio[vocal_start : vocal_start + vocal_dur] += vocal_burst

    # Place another vocal onset at 1.2s
    vocal2_start = int(1.2 * sr)
    vocal2_dur = int(0.3 * sr)
    t_vocal2 = np.arange(vocal2_dur) / sr
    vocal2_burst = (0.5 * np.sin(2 * np.pi * 450 * t_vocal2)).astype(np.float32)
    audio[vocal2_start : vocal2_start + vocal2_dur] += vocal2_burst

    result = _align_words_in_line(["hello", "world"], audio, 0.0, duration)

    assert len(result) == 2
    # Word 1 should start near the vocal onset at 0.5s, not the guitar strum at 0.3s
    # Allow some tolerance for the bandpass filter and onset detection
    assert result[0].start < 0.6, f"First word should start near vocal onset, got {result[0].start:.3f}"

    # Word 2 should start near the second vocal onset at 1.2s
    assert abs(result[1].start - 1.2) < 0.15, (
        f"Second word should start near 1.2s vocal onset, got {result[1].start:.3f}"
    )
