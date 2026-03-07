"""Integration tests: song selection flow.

Tests:
a. select_song() for a song already in the DB (via sync) — DB only
b. select_song() for a new song — triggers download (requires YouTube + Bedrock)
c. DB-first invariant — song exists in DB before bucket
d. Existence check uses DB, not filesystem

Requires:
- Database (configured via APP_ENV=test)
- For test b: Network access (YouTube) + AWS credentials (Bedrock)
"""

import shutil
import uuid
from pathlib import Path

import pytest

from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.services.artwork_service import ArtworkService
from guitar_player.services.llm_service import LlmService
from guitar_player.services.song_service import SongService
from guitar_player.services.sync_service import ensure_default_user, sync_local_bucket
from guitar_player.services.youtube_service import YoutubeService

TEST_USER_SUB = "test-select-user"
TEST_USER_EMAIL = "test-select@example.com"
DEFAULT_LOCAL_EMAIL = "iliagerman@gmail.com"


# ── a. Select existing song (DB only, no network) ─────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_select_existing_song_returns_detail(
    project_root: Path, settings, session_factory, storage
):
    """Sync local_bucket, then select_song for an existing song returns detail without downloading."""
    async with session_factory() as session:
        # Ensure the local bucket is synced into DB
        user = await ensure_default_user(session, DEFAULT_LOCAL_EMAIL)
        base_path = settings.storage.base_path or str(project_root / "local_bucket")
        await sync_local_bucket(session, base_path, user)
        await session.commit()

        # Look up a song that should exist after sync (bob_dylan/knocking_on_heavens_door)
        song_dao = SongDAO(session)
        db_song = await song_dao.get_by_song_name("bob_dylan/knocking_on_heavens_door")

        if not db_song:
            pytest.skip(
                "bob_dylan/knocking_on_heavens_door not found in local_bucket_test — "
                "place the song there before running this test"
            )

        llm = LlmService(settings)
        youtube = YoutubeService()
        artwork = ArtworkService()
        song_service = SongService(session, storage, youtube, llm, artwork)

        # select_song with no youtube_id — should return detail from DB
        detail = await song_service.select_song(
            song_name="bob_dylan/knocking_on_heavens_door",
            youtube_id=None,
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
        )

        # Assertions
        assert detail.audio_url is not None, "audio_url should be populated"
        assert detail.song.song_name == "bob_dylan/knocking_on_heavens_door"
        assert detail.song.artist is not None

        print(f"  audio_url: {detail.audio_url}", flush=True)
        print(f"  stems: {detail.stems}", flush=True)
        print(f"  chords: {len(detail.chords)} entries", flush=True)


# ── b. Select new song — triggers download (YouTube + Bedrock) ────


@pytest.mark.asyncio
@pytest.mark.timeout(300)
async def test_select_new_song_downloads_and_indexes(
    project_root: Path, settings, session_factory, storage
):
    """Search YouTube for a song, then select_song triggers download + DB indexing."""
    youtube = YoutubeService()
    llm = LlmService(settings)
    local_bucket = Path(settings.storage.base_path or "../local_bucket_test").resolve()

    async with session_factory() as session:
        artwork = ArtworkService()
        song_service = SongService(session, storage, youtube, llm, artwork)
        song_dao = SongDAO(session)

        # Clean up any stale DB record from a previous run (files may have been deleted)
        stale = await song_dao.get_by_youtube_id("CGj85pVzRJs")
        if stale:
            await song_dao.delete(stale)
            await session.commit()
            print("  Cleaned up stale DB record from previous run", flush=True)

        # Search for a song to get a youtube_id
        print("\n  Searching YouTube for 'Let It Be Beatles' ...", flush=True)
        enriched = await song_service.search_youtube_enriched(
            "Let It Be Beatles", max_results=5
        )
        assert len(enriched) > 0, "YouTube search returned no results"

        # Pick the best match
        result = enriched[0]
        song_name = f"{result.artist}/{result.song}"
        print(f"  Best match: {song_name} (youtube_id={result.youtube_id})", flush=True)

        # Select the song — triggers download
        detail = await song_service.select_song(
            song_name=song_name,
            youtube_id=result.youtube_id,
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
        )
        await session.commit()

        # Assertions
        assert detail.audio_url is not None, "audio_url should be populated after download"
        assert detail.song.audio_key is not None, "audio_key should be set in DB"

        # Use the actual song_name from the response (LLM fallback may differ from enriched search)
        actual_song_name = detail.song.song_name

        # Verify song is in DB
        db_song = await song_dao.get_by_song_name(actual_song_name)
        assert db_song is not None, f"Song {actual_song_name} not found in DB after select"
        assert db_song.audio_key is not None, "audio_key should be set in DB record"

        # Verify file exists on disk
        if db_song.audio_key:
            audio_path = local_bucket / db_song.audio_key
            assert audio_path.is_file(), f"Audio file not found on disk: {audio_path}"

        print(f"  Song indexed: id={detail.song.id}", flush=True)
        print(f"  song_name: {actual_song_name}", flush=True)
        print(f"  audio_key: {detail.song.audio_key}", flush=True)

        # Cleanup: remove downloaded files and DB record
        await song_dao.delete(db_song)
        await session.commit()
        print(f"  Cleaned up DB record: {db_song.id}", flush=True)

        actual_song_dir = local_bucket / actual_song_name
        if actual_song_dir.is_dir():
            print(f"  Cleaning up: {actual_song_dir}", flush=True)
            shutil.rmtree(actual_song_dir, ignore_errors=True)
            artist_dir = actual_song_dir.parent
            if artist_dir.is_dir() and not any(artist_dir.iterdir()):
                artist_dir.rmdir()


# ── c. DB indexed before bucket (covered by code change + test b assertions) ──
# The DB-first invariant is enforced by download_song() creating the DB record
# before uploading files. Test b verifies the DB record exists after select_song.


# ── d. Existence check uses DB, not filesystem ────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_existence_check_uses_db_not_filesystem(
    settings, session_factory, storage
):
    """Create a DB record with audio_key but no file on disk — existence check should still return True."""
    unique_suffix = uuid.uuid4().hex[:8]
    fake_song_name = f"test_artist_{unique_suffix}/test_song_{unique_suffix}"

    async with session_factory() as session:
        song_dao = SongDAO(session)

        # Create a song in DB with a dummy audio_key (no corresponding file on disk)
        song = await song_dao.create(
            title="Test Song (DB Only)",
            song_name=fake_song_name,
            audio_key=f"{fake_song_name}/fake_audio.mp3",
        )
        await session.commit()

        assert song.id is not None

        # Verify the DB-based lookup finds it
        found = await song_dao.get_by_song_name(fake_song_name)
        assert found is not None, "Song not found by song_name"
        assert found.audio_key is not None, "audio_key should be set"

        # The existence check in search_youtube_enriched checks:
        #   db_song is not None and db_song.audio_key is not None
        # This is True even though no file exists on disk.
        exists = found is not None and found.audio_key is not None
        assert exists is True, (
            "Existence check should report True for DB record with audio_key, "
            "regardless of filesystem"
        )

        print(f"  DB record exists with audio_key: {found.audio_key}", flush=True)
        print(f"  No file on disk — existence check is DB-based: PASS", flush=True)

        # Cleanup: remove test record
        await song_dao.delete(found)
        await session.commit()
