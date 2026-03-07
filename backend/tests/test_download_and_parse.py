"""Integration test: YouTube search + download + LLM name parsing.

Requires:
- Network access (YouTube)
- AWS credentials (Bedrock)
"""

import os
import shutil
import tempfile

import pytest

from guitar_player.services.llm_service import LlmService
from guitar_player.services.youtube_service import YoutubeService


@pytest.mark.asyncio
@pytest.mark.timeout(120)
async def test_search_download_and_parse_eagles_hotel_california(settings):
    """Search YouTube, download MP3, parse title via Bedrock LLM."""
    youtube = YoutubeService()
    llm = LlmService(settings)

    # 1. Search YouTube
    print("\n[1/3] Searching YouTube for 'Eagles Hotel California' ...", flush=True)
    results = await youtube.search("Eagles Hotel California", max_results=5)
    assert len(results) > 0, "YouTube search returned no results"

    first = results[0]
    youtube_id = first["youtube_id"]
    title = first["title"]
    print(f"  Found: {title} (id={youtube_id})", flush=True)
    assert youtube_id, "No youtube_id in first result"
    assert title, "No title in first result"

    # 2. Download MP3
    print(f"\n[2/3] Downloading MP3 for {youtube_id} ...", flush=True)
    tmp_dir = tempfile.mkdtemp(prefix="test_dl_")
    try:
        local_mp3, raw_title = await youtube.download(youtube_id, tmp_dir)

        size_mb = os.path.getsize(local_mp3) / (1024 * 1024)
        print(f"  Downloaded: {local_mp3} ({size_mb:.1f} MB)", flush=True)
        assert os.path.isfile(local_mp3), f"Downloaded MP3 not found: {local_mp3}"
        assert os.path.getsize(local_mp3) > 0, "Downloaded MP3 is empty"

        # 3. Parse title with LLM
        print(f"\n[3/3] Parsing title with Bedrock LLM: '{title}' ...", flush=True)
        parsed = await llm.parse_song_name(title)
        print(f"  Parsed: artist='{parsed.artist}', song='{parsed.song}'", flush=True)

        assert parsed.artist == "eagles", f"Expected artist 'eagles', got '{parsed.artist}'"
        assert parsed.song == "hotel_california", f"Expected song 'hotel_california', got '{parsed.song}'"

        print("\nAll phases complete.", flush=True)

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
