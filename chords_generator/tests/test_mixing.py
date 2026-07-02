"""Unit tests for additive stem mixing — tiny synthetic audio, no real songs."""

import numpy as np
import pytest
import soundfile as sf

from chords_generator.mixing import mix_audio_files


def _write_wav(path, samples: np.ndarray, sr: int = 8000) -> None:
    sf.write(str(path), samples, sr)


def test_mix_audio_files_sums_stems_sample_for_sample(tmp_path):
    sr = 8000
    a = np.full(sr, 0.1, dtype=np.float32)
    b = np.full(sr, 0.2, dtype=np.float32)
    path_a, path_b = tmp_path / "a.wav", tmp_path / "b.wav"
    _write_wav(path_a, a, sr)
    _write_wav(path_b, b, sr)

    out_path = tmp_path / "mixed.wav"
    mix_audio_files([str(path_a), str(path_b)], str(out_path))

    mixed, out_sr = sf.read(str(out_path))
    assert out_sr == sr
    assert mixed == pytest.approx(0.3, abs=1e-3)


def test_mix_audio_files_normalizes_only_when_clipping(tmp_path):
    sr = 8000
    a = np.full(sr, 0.7, dtype=np.float32)
    b = np.full(sr, 0.7, dtype=np.float32)
    path_a, path_b = tmp_path / "a.wav", tmp_path / "b.wav"
    _write_wav(path_a, a, sr)
    _write_wav(path_b, b, sr)

    out_path = tmp_path / "mixed.wav"
    mix_audio_files([str(path_a), str(path_b)], str(out_path))

    mixed, _ = sf.read(str(out_path))
    # Sum (1.4) clips, so the result is normalized down to a peak of 1.0.
    assert np.max(np.abs(mixed)) == pytest.approx(1.0, abs=1e-3)


def test_mix_audio_files_raises_on_empty_input(tmp_path):
    with pytest.raises(ValueError):
        mix_audio_files([], str(tmp_path / "mixed.wav"))


def test_mix_audio_files_raises_on_sample_rate_mismatch(tmp_path):
    a = np.full(8000, 0.1, dtype=np.float32)
    b = np.full(8000, 0.2, dtype=np.float32)
    path_a, path_b = tmp_path / "a.wav", tmp_path / "b.wav"
    _write_wav(path_a, a, sr=8000)
    _write_wav(path_b, b, sr=16000)

    with pytest.raises(ValueError, match="ample rate"):
        mix_audio_files([str(path_a), str(path_b)], str(tmp_path / "mixed.wav"))
