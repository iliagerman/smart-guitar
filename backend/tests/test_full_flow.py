"""Full pipeline integration test: search + download + parse + demucs + chords.

Requires:
- Network access (YouTube)
- AWS credentials (Bedrock)
- Running demucs and chords servers (managed by fixtures)
"""

import asyncio
import os
import shutil
import tempfile
from pathlib import Path

import pytest

from guitar_player.services.llm_service import LlmService
from guitar_player.services.processing_service import ProcessingService
from guitar_player.services.youtube_service import YoutubeService


async def _search_download_and_process(
    settings,
) -> tuple[Path, str]:
    """Shared helper: search, download, parse, separate stems, recognize chords, transcribe lyrics.

    Returns (song_dir, song_name) where song_dir is the local_bucket path
    containing all outputs.
    """
    youtube = YoutubeService()
    llm = LlmService(settings)
    processing = ProcessingService(settings)

    local_bucket = Path(settings.storage.base_path or "../local_bucket_test").resolve()

    # 1. Search YouTube
    print("\n[1/6] Searching YouTube for 'Eagles Hotel California' ...", flush=True)
    results = await youtube.search("Eagles Hotel California", max_results=5)
    assert len(results) > 0, "YouTube search returned no results"

    first = results[0]
    youtube_id = first["youtube_id"]
    title = first["title"]
    print(f"  Found: {title} (id={youtube_id})", flush=True)

    # 2. Download MP3
    print(f"\n[2/6] Downloading MP3 for {youtube_id} ...", flush=True)
    tmp_dir = tempfile.mkdtemp(prefix="test_full_")
    try:
        local_mp3, raw_title = await youtube.download(youtube_id, tmp_dir)
        size_mb = os.path.getsize(local_mp3) / (1024 * 1024)
        print(f"  Downloaded: {local_mp3} ({size_mb:.1f} MB)", flush=True)
        assert os.path.isfile(local_mp3)

        # 3. Parse title with LLM
        print(f"\n[3/6] Parsing title with Bedrock LLM: '{title}' ...", flush=True)
        parsed = await llm.parse_song_name(title)
        print(f"  Parsed: artist='{parsed.artist}', song='{parsed.song}'", flush=True)
        assert parsed.artist == "eagles", f"Expected 'eagles', got '{parsed.artist}'"
        assert parsed.song == "hotel_california", f"Expected 'hotel_california', got '{parsed.song}'"

        song_name = f"{parsed.artist}/{parsed.song}"
        song_dir = local_bucket / parsed.artist / parsed.song

        # 4. Copy audio to local_bucket under the parsed path
        print(f"\n[4/6] Copying audio to {song_dir} ...", flush=True)
        song_dir.mkdir(parents=True, exist_ok=True)
        dest_mp3 = song_dir / os.path.basename(local_mp3)
        shutil.copy2(local_mp3, dest_mp3)
        print(f"  Copied: {dest_mp3}", flush=True)

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    # 5. Stem separation and chord recognition in parallel
    print(f"\n[5/6] Running stem separation + chord recognition in parallel ...", flush=True)
    separation, chords = await asyncio.gather(
        processing.separate_stems(str(dest_mp3)),
        processing.recognize_chords(str(dest_mp3)),
    )

    # Verify stems
    print(f"  Stems: {len(separation.stems)} returned:", flush=True)
    for stem in separation.stems:
        exists = os.path.isfile(stem.path)
        print(f"    {stem.name}: {stem.path} (exists={exists})", flush=True)
    assert len(separation.stems) > 0, "No stems returned from demucs"
    for stem in separation.stems:
        assert os.path.isfile(stem.path), f"Stem file not found: {stem.name} -> {stem.path}"

    # Verify chords
    print(f"  Chords: {len(chords.chords)} recognized, output: {chords.output_path}", flush=True)
    assert chords.output_path, "No chords output path returned"
    assert len(chords.chords) > 0, "No chords recognized"

    # 6. Lyrics transcription on vocals stem
    print("\n[6/6] Running lyrics transcription on vocals stem ...", flush=True)
    vocals_stem = next((s for s in separation.stems if s.name == "vocals"), None)
    if vocals_stem:
        lyrics = await processing.transcribe_lyrics(vocals_stem.path)
        print(f"  Lyrics: {len(lyrics.segments)} segments", flush=True)
        assert lyrics.output_path, "No lyrics output path"
        assert len(lyrics.segments) > 0, "No lyrics segments transcribed"

    print(f"\nAll phases complete. Output at: {song_dir}", flush=True)
    return song_dir, song_name


@pytest.mark.asyncio
@pytest.mark.timeout(900)
async def test_full_flow_with_cleanup(demucs_server, chords_server, lyrics_server, settings):
    """Full pipeline: search + download + parse + demucs + chords + lyrics, then clean up."""
    song_dir, song_name = await _search_download_and_process(settings)

    # Verify outputs exist before cleanup
    assert song_dir.is_dir(), f"Song directory not found: {song_dir}"

    # Clean up
    print(f"\nCleaning up {song_dir} ...", flush=True)
    shutil.rmtree(song_dir, ignore_errors=True)
    # Also remove the artist dir if now empty (ignore .DS_Store)
    artist_dir = song_dir.parent
    if artist_dir.is_dir() and all(
        f.name == ".DS_Store" for f in artist_dir.iterdir()
    ):
        shutil.rmtree(artist_dir, ignore_errors=True)
    print("Cleanup done.", flush=True)


@pytest.mark.asyncio
@pytest.mark.timeout(900)
async def test_full_flow_no_cleanup(demucs_server, chords_server, lyrics_server, settings):
    """Full pipeline: search + download + parse + demucs + chords + lyrics, keep output."""
    song_dir, song_name = await _search_download_and_process(settings)

    assert song_dir.is_dir(), f"Song directory not found: {song_dir}"
    print(f"\nOutputs kept at: {song_dir}", flush=True)
