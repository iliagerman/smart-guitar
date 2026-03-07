"""Unit tests for audio merge utility."""

import os
import subprocess
import tempfile
from pathlib import Path

import pytest

from guitar_player.services.audio_merge import merge_audio_stems


def _generate_test_audio(path: str, freq: int = 440, duration: float = 2.0) -> None:
    """Generate a short MP3 test tone using FFmpeg (input format doesn't matter)."""
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "lavfi",
        "-i", f"sine=frequency={freq}:duration={duration}",
        "-codec:a", "libmp3lame",
        "-q:a", "6",
        "-f", "mp3",
        path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, f"Failed to generate test audio: {result.stderr}"


def _get_duration(path: str) -> float:
    """Get audio duration in seconds using ffprobe."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, f"ffprobe failed: {result.stderr}"
    return float(result.stdout.strip())


@pytest.fixture
def tmp_dir():
    """Create a temporary directory for test files."""
    d = tempfile.mkdtemp(prefix="test_merge_")
    yield d
    import shutil
    shutil.rmtree(d, ignore_errors=True)


def test_merge_audio_stems_produces_valid_output(tmp_dir: str) -> None:
    """Merging two audio files produces a valid MP3 output."""
    input_a = os.path.join(tmp_dir, "vocals.mp3")
    input_b = os.path.join(tmp_dir, "guitar.mp3")
    output = os.path.join(tmp_dir, "merged.mp3")

    _generate_test_audio(input_a, freq=440, duration=2.0)
    _generate_test_audio(input_b, freq=880, duration=2.0)

    merge_audio_stems(input_a, input_b, output)

    assert Path(output).is_file()
    assert Path(output).stat().st_size > 0

    # Verify output is a valid audio file with correct duration.
    out_duration = _get_duration(output)
    assert out_duration == pytest.approx(2.0, abs=0.5)


def test_merge_audio_stems_uses_longest_duration(tmp_dir: str) -> None:
    """Output duration matches the longer of the two inputs."""
    input_a = os.path.join(tmp_dir, "short.mp3")
    input_b = os.path.join(tmp_dir, "long.mp3")
    output = os.path.join(tmp_dir, "merged.mp3")

    _generate_test_audio(input_a, freq=440, duration=1.0)
    _generate_test_audio(input_b, freq=880, duration=3.0)

    merge_audio_stems(input_a, input_b, output)

    out_duration = _get_duration(output)
    assert out_duration == pytest.approx(3.0, abs=0.5)


def test_merge_audio_stems_missing_input_raises(tmp_dir: str) -> None:
    """Merging with a missing input file raises RuntimeError."""
    input_a = os.path.join(tmp_dir, "exists.mp3")
    input_b = os.path.join(tmp_dir, "does_not_exist.mp3")
    output = os.path.join(tmp_dir, "merged.mp3")

    _generate_test_audio(input_a, freq=440, duration=1.0)

    with pytest.raises(RuntimeError, match="FFmpeg merge failed"):
        merge_audio_stems(input_a, input_b, output)


def test_merge_audio_stems_overwrites_existing_output(tmp_dir: str) -> None:
    """Output file is overwritten if it already exists (FFmpeg -y flag)."""
    input_a = os.path.join(tmp_dir, "vocals.mp3")
    input_b = os.path.join(tmp_dir, "guitar.mp3")
    output = os.path.join(tmp_dir, "merged.mp3")

    _generate_test_audio(input_a, freq=440, duration=1.0)
    _generate_test_audio(input_b, freq=880, duration=1.0)

    # Create a dummy output file.
    Path(output).write_text("placeholder")

    merge_audio_stems(input_a, input_b, output)

    assert Path(output).stat().st_size > len("placeholder")
