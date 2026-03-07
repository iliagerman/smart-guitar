"""Integration test: search + LLM batch parsing + download + DB persistence + user history.

Tests the enriched search flow using "the house of rising sun" as the search term.
Downloads several songs via SongService.download_song() which handles:
  MP3 download, thumbnail download, LLM name parsing, storage upload, DB persist.

Verifies:
- YouTube search returns results
- LLM batch-parses all results into artist/song via Pydantic models
- Local existence check works correctly
- Results are sorted with local songs first
- Songs are persisted to the database
- Thumbnails are stored in each song's folder
- User history tracks downloaded songs (most recent first, limit 10)

Requires:
- Network access (YouTube)
- AWS credentials (Bedrock)
- Database (configured via APP_ENV=test)
"""

import asyncio
import shutil
from pathlib import Path

import pytest

from guitar_player.dao.song_dao import SongDAO
from guitar_player.services.artwork_service import ArtworkService
from guitar_player.services.llm_service import LlmService, ParsedSearchItem
from guitar_player.services.song_service import SongService
from guitar_player.services.youtube_service import YoutubeService
from guitar_player.storage import create_storage

TEST_USER_SUB = "test-search-user"
TEST_USER_EMAIL = "test-search@example.com"

# How many songs to download from search results
DOWNLOAD_COUNT = 3


async def _search_download_and_verify(
    project_root: Path, settings, session_factory, storage
) -> list[Path]:
    """Shared helper: search, LLM parse, download songs, verify DB + history.

    Returns list of song directories created in the storage bucket.
    """
    youtube = YoutubeService()
    llm = LlmService(settings)

    local_bucket = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    downloaded_songs = []
    song_dirs: list[Path] = []

    async with session_factory() as session:
        artwork = ArtworkService()
        song_service = SongService(session, storage, youtube, llm, artwork)

        # ── Phase 1: Search and LLM batch parsing ─────────────────────
        print(
            "\n[1/5] Searching YouTube for 'the house of rising sun' ...",
            flush=True,
        )
        raw_results = await youtube.search(
            "the house of rising sun", max_results=10
        )
        assert len(raw_results) > 0, "YouTube search returned no results"
        assert len(raw_results) <= 10
        print(f"  Found {len(raw_results)} results", flush=True)

        for i, r in enumerate(raw_results):
            print(
                f"  [{i + 1}] {r['title']} (id={r['youtube_id']})", flush=True
            )

        # ── Phase 2: Batch-parse via LLM ──────────────────────────────
        print(
            f"\n[2/5] Sending {len(raw_results)} titles to Bedrock LLM "
            "for batch parsing ...",
            flush=True,
        )
        parsed_items = await llm.parse_search_results(raw_results)

        assert len(parsed_items) == len(raw_results), (
            f"LLM returned {len(parsed_items)} items "
            f"but expected {len(raw_results)}"
        )

        for i, item in enumerate(parsed_items):
            print(
                f"  [{i + 1}] artist='{item.artist}', song='{item.song}'",
                flush=True,
            )
            assert isinstance(item, ParsedSearchItem)
            assert item.artist, f"Item {i + 1} has empty artist"
            assert item.song, f"Item {i + 1} has empty song"
            assert " " not in item.artist, (
                f"Artist not snake_case: '{item.artist}'"
            )
            assert " " not in item.song, (
                f"Song not snake_case: '{item.song}'"
            )

        # ── Phase 3: Enriched search with local existence check ───────
        print(
            "\n[3/5] Running enriched search (LLM + local check + sort) ...",
            flush=True,
        )
        enriched = await song_service.search_youtube_enriched(
            "the house of rising sun", max_results=10
        )
        assert len(enriched) > 0

        local_count = sum(1 for r in enriched if r.exists_locally)
        remote_count = len(enriched) - local_count
        print(f"  {local_count} local, {remote_count} remote", flush=True)

        for i, r in enumerate(enriched):
            status = "LOCAL" if r.exists_locally else "REMOTE"
            print(
                f"  [{i + 1}] {status} {r.artist}/{r.song} — {r.link}",
                flush=True,
            )

        # Verify sort order: all local before all remote
        seen_remote = False
        for r in enriched:
            if not r.exists_locally:
                seen_remote = True
            elif seen_remote:
                pytest.fail(
                    f"Local result '{r.artist}/{r.song}' "
                    "appears after a remote result"
                )

        # ── Phase 4: Download several songs via SongService ───────────
        print(
            f"\n[4/5] Downloading top {DOWNLOAD_COUNT} songs "
            "via SongService ...",
            flush=True,
        )

        # Pick non-local results to force real downloads
        to_download = [r for r in enriched if not r.exists_locally][
            :DOWNLOAD_COUNT
        ]
        if len(to_download) < DOWNLOAD_COUNT:
            to_download = enriched[:DOWNLOAD_COUNT]

        for i, result in enumerate(to_download):
            print(
                f"\n  [{i + 1}/{DOWNLOAD_COUNT}] Downloading: {result.title} "
                f"(id={result.youtube_id}) ...",
                flush=True,
            )
            song_resp = await song_service.download_song(
                result.youtube_id, TEST_USER_SUB, TEST_USER_EMAIL
            )
            await session.commit()
            downloaded_songs.append(song_resp)

            # Track the song directory for cleanup
            song_dir = local_bucket / song_resp.song_name
            if song_dir.is_dir():
                song_dirs.append(song_dir)

            print(f"    Song ID: {song_resp.id}", flush=True)
            print(f"    song_name: {song_resp.song_name}", flush=True)
            print(f"    audio_key: {song_resp.audio_key}", flush=True)
            print(f"    thumbnail_key: {song_resp.thumbnail_key}", flush=True)

            # Verify song has audio and thumbnail keys
            assert song_resp.audio_key, (
                f"Song {song_resp.id} has no audio_key"
            )
            assert song_resp.thumbnail_key, (
                f"Song {song_resp.id} has no thumbnail_key"
            )

            # Verify thumbnail file exists on disk
            thumb_path = local_bucket / song_resp.thumbnail_key
            assert thumb_path.is_file(), (
                f"Thumbnail not found on disk: {thumb_path}"
            )
            print(f"    Thumbnail verified: {thumb_path}", flush=True)

            # Verify audio file exists on disk
            audio_path = local_bucket / song_resp.audio_key
            assert audio_path.is_file(), (
                f"Audio not found on disk: {audio_path}"
            )

            # Small delay between downloads to avoid rate limiting
            if i < len(to_download) - 1:
                await asyncio.sleep(2)

        assert len(downloaded_songs) == DOWNLOAD_COUNT, (
            f"Expected {DOWNLOAD_COUNT} downloaded songs, "
            f"got {len(downloaded_songs)}"
        )

        # ── Phase 5: Verify DB persistence and user history ───────────
        print(
            "\n[5/5] Verifying DB persistence and user history ...",
            flush=True,
        )

        # Verify each song is in the DB
        for song_resp in downloaded_songs:
            song_dao = SongDAO(session)
            db_song = await song_dao.get_by_youtube_id(
                song_resp.youtube_id  # type: ignore[arg-type]
            )
            assert db_song is not None, (
                f"Song {song_resp.youtube_id} not found in DB"
            )
            assert db_song.audio_key == song_resp.audio_key
            assert db_song.thumbnail_key == song_resp.thumbnail_key
            print(
                f"  DB verified: {db_song.artist} / {db_song.title} "
                f"(id={db_song.id})",
                flush=True,
            )

        # Verify user history
        recent_resp = await song_service.list_recent_songs(
            offset=0, limit=10
        )
        recent = recent_resp.items
        print(f"\n  User history ({len(recent)} songs):", flush=True)
        for i, s in enumerate(recent):
            print(f"    [{i + 1}] {s.artist} / {s.title}", flush=True)

        # Use unique IDs — multiple downloads can resolve to the same
        # song_name when the LLM parses different titles identically.
        downloaded_ids = {s.id for s in downloaded_songs}
        history_ids = {s.id for s in recent}

        assert len(recent) >= len(downloaded_ids), (
            f"Expected at least {len(downloaded_ids)} unique songs in history, "
            f"got {len(recent)}"
        )

        # Verify the downloaded songs appear in history
        assert downloaded_ids.issubset(history_ids), (
            f"Downloaded songs not found in history. "
            f"Downloaded: {downloaded_ids}, History: {history_ids}"
        )

        # Verify history is ordered by most recent first
        last_downloaded = downloaded_songs[-1]
        assert recent[0].id == last_downloaded.id, (
            f"Most recent download ({last_downloaded.id}) is not first "
            f"in history (got {recent[0].id})"
        )

        # Verify history respects the limit of 10
        full_resp = await song_service.list_recent_songs(
            offset=0, limit=10
        )
        assert len(full_resp.items) <= 10, (
            f"History exceeds limit of 10: got {len(full_resp.items)}"
        )

    print(
        f"\nAll phases complete. {len(downloaded_songs)} songs "
        "downloaded and verified.",
        flush=True,
    )
    return song_dirs


@pytest.mark.asyncio
@pytest.mark.timeout(600)
async def test_search_with_cleanup(
    project_root: Path, settings, session_factory, storage
):
    """Search + download + verify, then clean up downloaded files."""
    song_dirs = await _search_download_and_verify(
        project_root, settings, session_factory, storage
    )

    print("\nCleaning up downloaded song directories ...", flush=True)
    for song_dir in song_dirs:
        if song_dir.is_dir():
            shutil.rmtree(song_dir, ignore_errors=True)
            # Remove artist dir if now empty (ignore .DS_Store)
            artist_dir = song_dir.parent
            if artist_dir.is_dir() and all(
                f.name == ".DS_Store" for f in artist_dir.iterdir()
            ):
                shutil.rmtree(artist_dir, ignore_errors=True)
            print(f"  Removed: {song_dir}", flush=True)
    print("Cleanup done.", flush=True)


@pytest.mark.asyncio
@pytest.mark.timeout(600)
async def test_search_no_cleanup(
    project_root: Path, settings, session_factory, storage
):
    """Search + download + verify, keep outputs for inspection."""
    song_dirs = await _search_download_and_verify(
        project_root, settings, session_factory, storage
    )

    for song_dir in song_dirs:
        print(f"\nOutputs kept at: {song_dir}", flush=True)
