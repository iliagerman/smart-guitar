"""Unit tests for audio_cleaner — uses synthetic audio, no real files needed."""

import os
import tempfile

import numpy as np
import soundfile as sf

from tabs_generator.audio_cleaner import bandpass_filter, clean_guitar_audio, noise_gate


def _make_sine(freq: float, duration: float = 1.0, sr: int = 22050) -> np.ndarray:
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    return np.sin(2 * np.pi * freq * t).astype(np.float32)


def test_bandpass_removes_sub_bass():
    """A 30Hz signal should be heavily attenuated by a 75Hz highpass."""
    sr = 22050
    low_signal = _make_sine(30, sr=sr)
    filtered = bandpass_filter(low_signal, sr, low_cut=75, high_cut=5000)
    # Energy should be significantly reduced
    assert np.max(np.abs(filtered)) < 0.3 * np.max(np.abs(low_signal))


def test_bandpass_passes_guitar_range():
    """A 440Hz signal (A4, common guitar note) should pass through."""
    sr = 22050
    guitar_signal = _make_sine(440, sr=sr)
    filtered = bandpass_filter(guitar_signal, sr, low_cut=75, high_cut=5000)
    # Should retain most energy
    assert np.max(np.abs(filtered)) > 0.7 * np.max(np.abs(guitar_signal))


def test_bandpass_removes_high_freq():
    """A 8000Hz signal should be attenuated by a 5000Hz lowpass."""
    sr = 22050
    high_signal = _make_sine(8000, sr=sr)
    filtered = bandpass_filter(high_signal, sr, low_cut=75, high_cut=5000)
    assert np.max(np.abs(filtered)) < 0.3 * np.max(np.abs(high_signal))


def test_noise_gate_silences_quiet_sections():
    """Quiet audio below the gate threshold should be suppressed."""
    sr = 22050
    quiet = _make_sine(440, sr=sr) * 0.001  # very quiet
    gated = noise_gate(quiet, threshold_db=-40, sr=sr)
    # Should be nearly silent
    assert np.max(np.abs(gated)) < 0.005


def test_noise_gate_passes_loud_sections():
    """Audio above the gate threshold should pass through."""
    sr = 22050
    loud = _make_sine(440, sr=sr) * 0.5
    gated = noise_gate(loud, threshold_db=-40, sr=sr)
    # Should retain most energy
    assert np.max(np.abs(gated)) > 0.3


def test_clean_guitar_audio_end_to_end():
    """Full cleaning pipeline should produce a valid output file."""
    sr = 22050
    # Mix of guitar-range signal and out-of-range noise
    guitar = _make_sine(440, sr=sr) * 0.5
    sub_bass = _make_sine(30, sr=sr) * 0.3
    mixed = guitar + sub_bass

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, "input.wav")
        output_path = os.path.join(tmpdir, "cleaned.wav")
        sf.write(input_path, mixed, sr)

        result_path = clean_guitar_audio(input_path, output_path)

        assert os.path.isfile(result_path)
        cleaned, out_sr = sf.read(result_path)
        assert len(cleaned) > 0
        assert out_sr == sr
