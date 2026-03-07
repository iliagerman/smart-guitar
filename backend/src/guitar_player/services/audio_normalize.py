"""Audio normalization utilities.

Goal: ensure we have a single, browser-friendly canonical audio timebase.

We transcode the original audio (often downloaded as OGG) into MP3 CBR 192kbps,
matching stem encoding settings used elsewhere in the project.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile

from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)

_FFMPEG_TIMEOUT_S = 180


def transcode_audio_to_mp3_cbr192(input_path: str, output_path: str) -> None:
    """Transcode an audio file to MP3 CBR 192kbps.

    Output is intentionally MP3 CBR for more stable HTMLAudioElement.currentTime
    across browsers compared to VBR and some container/codec combos.
    """

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-vn",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "192k",
        output_path,
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=_FFMPEG_TIMEOUT_S,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"FFmpeg transcode failed (exit {result.returncode}): {result.stderr}"
        )


async def ensure_canonical_audio_mp3(
    storage: StorageBackend,
    *,
    song_name: str,
    source_audio_key: str,
    canonical_filename: str = "audio.mp3",
) -> str | None:
    """Ensure canonical MP3 exists for a song and return its key.

    If `song_name/audio.mp3` already exists, this is a no-op.
    Otherwise it downloads `source_audio_key`, transcodes, and uploads.

    Returns the canonical key on success, or None on failure.
    """

    canonical_key = f"{song_name}/{canonical_filename}"
    if storage.file_exists(canonical_key):
        return canonical_key

    tmp_dir = tempfile.mkdtemp(prefix="canon_audio_")
    try:
        ext = os.path.splitext(source_audio_key)[1].lower() or ".audio"
        src_local = os.path.join(tmp_dir, f"source{ext}")
        out_local = os.path.join(tmp_dir, canonical_filename)

        storage.download_to_local(source_audio_key, src_local)
        transcode_audio_to_mp3_cbr192(src_local, out_local)
        storage.upload_file(out_local, canonical_key)

        logger.info(
            "Canonicalized audio for %s: %s -> %s",
            song_name,
            source_audio_key,
            canonical_key,
        )
        return canonical_key
    except Exception:
        logger.exception(
            "Failed to canonicalize audio for %s from %s", song_name, source_audio_key
        )
        return None
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
