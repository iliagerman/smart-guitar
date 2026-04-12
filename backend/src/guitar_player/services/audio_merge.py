"""Audio merge utilities for cached playback mixes."""

import logging
import os
import shutil
import subprocess
import tempfile

from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)

_FFMPEG_TIMEOUT = 120  # seconds


def merge_audio_files(input_paths: list[str], output: str) -> None:
    """Mix multiple audio files into one CBR MP3 using FFmpeg amix."""
    if len(input_paths) < 2:
        raise ValueError("At least two audio inputs are required to build a mix")

    filter_inputs = "".join(f"[{idx}:a]" for idx in range(len(input_paths)))
    cmd = ["ffmpeg", "-y"]
    for path in input_paths:
        cmd.extend(["-i", path])
    cmd.extend([
        "-filter_complex",
        f"{filter_inputs}amix=inputs={len(input_paths)}:duration=longest:normalize=0",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "192k",
        output,
    ])

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=_FFMPEG_TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"FFmpeg merge failed (exit {result.returncode}): {result.stderr}"
        )


def merge_audio_stems(input_a: str, input_b: str, output: str) -> None:
    """Backward-compatible wrapper for merging exactly two stems."""
    merge_audio_files([input_a, input_b], output)


def build_stem_mix_key(song_name: str, stem_names: list[str]) -> str:
    """Return the cached storage key for a canonical stem combination."""
    canonical = "__".join(sorted(stem_names))
    return f"{song_name}/mixes/{canonical}.mp3"


async def ensure_stem_mix(
    storage: StorageBackend,
    song_name: str,
    stem_keys: list[tuple[str, str]],
) -> str:
    """Create and cache a mixed playback file for the requested stems."""
    output_key = build_stem_mix_key(song_name, [name for name, _ in stem_keys])
    if storage.file_exists(output_key):
        return output_key

    tmp_dir = tempfile.mkdtemp(prefix="stem_mix_")
    try:
        local_inputs: list[str] = []
        for stem_name, stem_key in stem_keys:
            local_path = os.path.join(tmp_dir, f"{stem_name}.mp3")
            storage.download_to_local(stem_key, local_path)
            local_inputs.append(local_path)

        output_local = os.path.join(tmp_dir, os.path.basename(output_key))
        merge_audio_files(local_inputs, output_local)
        storage.upload_file(output_local, output_key)
        logger.info("Created cached stem mix -> %s", output_key)
        return output_key
    except Exception:
        logger.exception("Failed to create cached stem mix for %s", song_name)
        raise
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def merge_vocals_guitar_stem(
    storage: StorageBackend,
    song_name: str,
    vocals_key: str,
    guitar_key: str,
) -> str | None:
    """Merge vocals + guitar stems and upload the result.

    Downloads both stems to a temp directory, runs FFmpeg, and uploads
    the merged file. Works with both LocalStorage and S3Storage.

    Returns the storage key on success, or None on failure.
    """
    output_key = f"{song_name}/vocals_guitar.mp3"

    tmp_dir = tempfile.mkdtemp(prefix="merge_")
    try:
        vocals_local = os.path.join(tmp_dir, "vocals.mp3")
        guitar_local = os.path.join(tmp_dir, "guitar.mp3")
        output_local = os.path.join(tmp_dir, "vocals_guitar.mp3")

        storage.download_to_local(vocals_key, vocals_local)
        storage.download_to_local(guitar_key, guitar_local)

        merge_audio_stems(vocals_local, guitar_local, output_local)

        storage.upload_file(output_local, output_key)
        logger.info("Merged vocals+guitar -> %s", output_key)
        return output_key
    except Exception:
        logger.exception("Failed to merge vocals+guitar for %s", song_name)
        return None
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
