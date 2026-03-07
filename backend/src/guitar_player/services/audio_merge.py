"""Audio merge utility — mix two audio stems into one using FFmpeg."""

import logging
import os
import subprocess
import tempfile

from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)

_FFMPEG_TIMEOUT = 120  # seconds


def merge_audio_stems(input_a: str, input_b: str, output: str) -> None:
    """Mix two audio files into a single MP3 file using FFmpeg amix filter.

    Both inputs are mixed at their original volume levels (normalize=0).
    Output is encoded as MP3 CBR 192 kbps for accurate browser currentTime.
    """
    cmd = [
        "ffmpeg",
        "-y",
        "-i", input_a,
        "-i", input_b,
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0",
        "-codec:a", "libmp3lame",
        "-b:a", "192k",
        output,
    ]
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
        import shutil

        shutil.rmtree(tmp_dir, ignore_errors=True)
