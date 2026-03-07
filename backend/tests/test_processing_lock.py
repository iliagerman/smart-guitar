"""Unit tests: DB-level processing lock and lightweight-task cooldowns.

Verifies that:
- ``processing_job_id`` is set/cleared correctly during the job lifecycle.
- ``lyrics_failed`` / ``tabs_failed`` flags block automatic re-triggering.
- ``lyrics_attempted_at`` / ``tabs_attempted_at`` / ``merge_attempted_at``
  timestamps act as cooldowns to prevent re-enqueuing on every UI poll.
- ``create_and_process_job`` resets failure flags for a fresh retry.

These tests are lightweight (SQLite, no external services).
"""

from __future__ import annotations

import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from guitar_player.app_state import set_storage
from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.services.job_service import (
    JobService,
    _complete_job,
    _fail_job,
    _LIGHTWEIGHT_TASK_COOLDOWN_SECONDS,
)

TEST_USER_SUB = "test-lock-user"
TEST_USER_EMAIL = "test-lock@example.com"
SONG_NAME = "test_artist/test_song_lock"


@pytest.fixture()
async def _db(settings, storage):
    """Initialize DB + storage singletons and yield a session factory."""
    factory = init_db(settings)
    set_storage(storage)
    yield factory
    await close_db()


@pytest.fixture()
async def song(_db, storage):
    """Create a test song and clean up after."""
    async with _db() as session:
        song_dao = SongDAO(session)
        existing = await song_dao.get_by_song_name(SONG_NAME)
        if existing:
            await song_dao.delete(existing)
            await session.commit()

        song = await song_dao.create(
            title="Lock Test Song",
            artist="test_artist",
            song_name=SONG_NAME,
            audio_key=f"{SONG_NAME}/audio.mp3",
        )
        await session.commit()
        yield song

    # Cleanup DB
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_song_name(SONG_NAME)
        if s:
            await song_dao.delete(s)
            await session.commit()

    # Cleanup files
    base = getattr(storage, "_base_path", None)
    if base:
        song_dir = Path(base) / SONG_NAME
        if song_dir.exists():
            shutil.rmtree(song_dir, ignore_errors=True)


async def _reset_song_for_trigger(db_factory, song_id):
    """Clear processing lock, active jobs, and failure flags so trigger tests start clean."""
    async with db_factory() as session:
        song_dao = SongDAO(session)
        job_dao = JobDAO(session)
        s = await song_dao.get_by_id(song_id)
        if not s:
            return
        # Clear the processing lock
        s.processing_job_id = None
        s.lyrics_failed = False
        s.tabs_failed = False
        s.lyrics_attempted_at = None
        s.tabs_attempted_at = None
        s.merge_attempted_at = None
        s.lyrics_key = None
        s.tabs_key = None
        s.vocals_guitar_key = None
        # Fail any active jobs so they don't block triggers
        active = await job_dao.get_active_job(song_id)
        while active:
            await job_dao.update_status(active, "FAILED", error_message="test cleanup")
            await session.flush()
            active = await job_dao.get_active_job(song_id)
        await session.commit()


def _storage_base(storage) -> Path | None:
    """Get the base path from a LocalStorage instance."""
    base = getattr(storage, "_base_path", None)
    if base:
        return Path(base)
    return None


def _write_dummy_file(storage, key: str) -> Path | None:
    """Write a dummy file at the given storage key. Returns the path or None."""
    base = _storage_base(storage)
    if not base:
        return None
    p = base / key
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"dummy")
    return p


# ---- processing_job_id lifecycle ----


@pytest.mark.asyncio
async def test_processing_job_id_set_after_job_creation(_db, song, storage):
    """Creating a job sets processing_job_id on the song."""
    async with _db() as session:
        svc = JobService(session, storage)
        resp = await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        await session.commit()

    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        assert s.processing_job_id == resp.id


@pytest.mark.asyncio
async def test_processing_job_id_cleared_after_completion(_db, song, storage):
    """_complete_job clears processing_job_id on the song."""
    async with _db() as session:
        svc = JobService(session, storage)
        resp = await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        await session.commit()

    await _complete_job(resp.id, results=[])

    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        assert s.processing_job_id is None


@pytest.mark.asyncio
async def test_processing_job_id_cleared_after_failure(_db, song, storage):
    """_fail_job clears processing_job_id on the song."""
    async with _db() as session:
        svc = JobService(session, storage)
        resp = await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        await session.commit()

    await _fail_job(resp.id, "test failure")

    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        assert s.processing_job_id is None


# ---- Failure flags reset on new job creation ----


@pytest.mark.asyncio
async def test_create_job_resets_failure_flags(_db, song, storage):
    """create_and_process_job resets lyrics_failed and tabs_failed."""
    # Set failure flags
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        s.lyrics_failed = True
        s.tabs_failed = True
        await session.commit()

    async with _db() as session:
        svc = JobService(session, storage)
        await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        await session.commit()

    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        assert s.lyrics_failed is False
        assert s.tabs_failed is False


# ---- lyrics_failed blocks trigger ----


@pytest.mark.asyncio
async def test_lyrics_failed_blocks_trigger(_db, song, storage):
    """trigger_lyrics_transcription_if_missing returns False when lyrics_failed=True."""
    await _reset_song_for_trigger(_db, song.id)
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        s.lyrics_failed = True
        await session.commit()

    async with _db() as session:
        svc = JobService(session, storage)
        result = await svc.trigger_lyrics_transcription_if_missing(song.id)
        assert result is False


# ---- tabs_failed blocks trigger ----


@pytest.mark.asyncio
async def test_tabs_failed_blocks_trigger(_db, song, storage):
    """trigger_tabs_generation_if_missing returns False when tabs_failed=True."""
    await _reset_song_for_trigger(_db, song.id)
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        s.tabs_failed = True
        await session.commit()

    async with _db() as session:
        svc = JobService(session, storage)
        result = await svc.trigger_tabs_generation_if_missing(song.id)
        assert result is False


# ---- lyrics_attempted_at cooldown ----


@pytest.mark.asyncio
async def test_recent_lyrics_attempted_at_blocks_trigger(_db, song, storage):
    """trigger_lyrics_transcription_if_missing returns False when attempted recently."""
    await _reset_song_for_trigger(_db, song.id)
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        s.lyrics_attempted_at = datetime.now(timezone.utc)
        await session.commit()

    async with _db() as session:
        svc = JobService(session, storage)
        result = await svc.trigger_lyrics_transcription_if_missing(song.id)
        assert result is False


@pytest.mark.asyncio
async def test_expired_lyrics_attempted_at_does_not_block(_db, song, storage):
    """trigger_lyrics_transcription_if_missing proceeds past an expired cooldown."""
    await _reset_song_for_trigger(_db, song.id)

    expired = datetime.now(timezone.utc) - timedelta(
        seconds=_LIGHTWEIGHT_TASK_COOLDOWN_SECONDS + 60
    )
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        s.lyrics_attempted_at = expired
        s.vocals_key = f"{SONG_NAME}/vocals.mp3"
        await session.commit()

    dummy = _write_dummy_file(storage, f"{SONG_NAME}/vocals.mp3")

    enqueued = False

    def _fake_enqueue(sid):
        nonlocal enqueued
        enqueued = True

    try:
        with patch(
            "guitar_player.services.job_service._enqueue_lyrics_transcription",
            side_effect=_fake_enqueue,
        ):
            async with _db() as session:
                svc = JobService(session, storage)
                await svc.trigger_lyrics_transcription_if_missing(song.id)
    finally:
        if dummy:
            dummy.unlink(missing_ok=True)

    assert enqueued is True, "Expired cooldown should not block the trigger"


# ---- tabs_attempted_at cooldown ----


@pytest.mark.asyncio
async def test_recent_tabs_attempted_at_blocks_trigger(_db, song, storage):
    """trigger_tabs_generation_if_missing returns False when attempted recently."""
    await _reset_song_for_trigger(_db, song.id)
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        s.tabs_attempted_at = datetime.now(timezone.utc)
        await session.commit()

    async with _db() as session:
        svc = JobService(session, storage)
        result = await svc.trigger_tabs_generation_if_missing(song.id)
        assert result is False


@pytest.mark.asyncio
async def test_expired_tabs_attempted_at_does_not_block(_db, song, storage):
    """trigger_tabs_generation_if_missing proceeds past an expired cooldown."""
    await _reset_song_for_trigger(_db, song.id)

    expired = datetime.now(timezone.utc) - timedelta(
        seconds=_LIGHTWEIGHT_TASK_COOLDOWN_SECONDS + 60
    )
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        s.tabs_attempted_at = expired
        s.guitar_key = f"{SONG_NAME}/guitar.mp3"
        await session.commit()

    dummy = _write_dummy_file(storage, f"{SONG_NAME}/guitar.mp3")

    enqueued = False

    def _fake_enqueue(sid):
        nonlocal enqueued
        enqueued = True

    try:
        with patch(
            "guitar_player.services.job_service._enqueue_tabs_generation",
            side_effect=_fake_enqueue,
        ):
            async with _db() as session:
                svc = JobService(session, storage)
                await svc.trigger_tabs_generation_if_missing(song.id)
    finally:
        if dummy:
            dummy.unlink(missing_ok=True)

    assert enqueued is True, "Expired cooldown should not block the trigger"


# ---- merge_attempted_at cooldown ----


@pytest.mark.asyncio
async def test_recent_merge_attempted_at_blocks_trigger(_db, song, storage):
    """trigger_vocals_guitar_merge_if_missing returns False when attempted recently."""
    await _reset_song_for_trigger(_db, song.id)
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        s.merge_attempted_at = datetime.now(timezone.utc)
        await session.commit()

    async with _db() as session:
        svc = JobService(session, storage)
        result = await svc.trigger_vocals_guitar_merge_if_missing(song.id)
        assert result is False


@pytest.mark.asyncio
async def test_expired_merge_attempted_at_does_not_block(_db, song, storage):
    """trigger_vocals_guitar_merge_if_missing proceeds past an expired cooldown."""
    await _reset_song_for_trigger(_db, song.id)

    expired = datetime.now(timezone.utc) - timedelta(
        seconds=_LIGHTWEIGHT_TASK_COOLDOWN_SECONDS + 60
    )
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        s.merge_attempted_at = expired
        s.vocals_key = f"{SONG_NAME}/vocals.mp3"
        s.guitar_key = f"{SONG_NAME}/guitar.mp3"
        await session.commit()

    dummy_vocals = _write_dummy_file(storage, f"{SONG_NAME}/vocals.mp3")
    dummy_guitar = _write_dummy_file(storage, f"{SONG_NAME}/guitar.mp3")

    enqueued = False

    def _fake_enqueue(sid):
        nonlocal enqueued
        enqueued = True

    try:
        with patch(
            "guitar_player.services.job_service._enqueue_vocals_guitar_merge",
            side_effect=_fake_enqueue,
        ):
            async with _db() as session:
                svc = JobService(session, storage)
                await svc.trigger_vocals_guitar_merge_if_missing(song.id)
    finally:
        if dummy_vocals:
            dummy_vocals.unlink(missing_ok=True)
        if dummy_guitar:
            dummy_guitar.unlink(missing_ok=True)

    assert enqueued is True, "Expired cooldown should not block the trigger"


# ---- tabs_failed force override ----


@pytest.mark.asyncio
async def test_tabs_force_bypasses_failed_flag(_db, song, storage):
    """trigger_tabs_generation_if_missing(force=True) ignores tabs_failed."""
    await _reset_song_for_trigger(_db, song.id)
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        s.tabs_failed = True
        s.guitar_key = f"{SONG_NAME}/guitar.mp3"
        await session.commit()

    dummy = _write_dummy_file(storage, f"{SONG_NAME}/guitar.mp3")

    enqueued = False

    def _fake_enqueue(sid):
        nonlocal enqueued
        enqueued = True

    try:
        with patch(
            "guitar_player.services.job_service._enqueue_tabs_generation",
            side_effect=_fake_enqueue,
        ):
            async with _db() as session:
                svc = JobService(session, storage)
                await svc.trigger_tabs_generation_if_missing(song.id, force=True)
    finally:
        if dummy:
            dummy.unlink(missing_ok=True)

    assert enqueued is True, "force=True should bypass tabs_failed"


# ---- Idempotency: processing_job_id prevents duplicate jobs ----


@pytest.mark.asyncio
async def test_concurrent_creation_returns_same_job(_db, song, storage):
    """Two create_and_process_job calls return the same job via processing_job_id."""
    async with _db() as session:
        svc = JobService(session, storage)
        first = await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        await session.commit()

    async with _db() as session:
        svc = JobService(session, storage)
        second = await svc.create_and_process_job(
            user_sub="other-user",
            user_email="other@example.com",
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        await session.commit()

    assert first.id == second.id, "Both should return the same job via processing_job_id"


@pytest.mark.asyncio
async def test_stale_processing_lock_is_cleared(_db, song, storage):
    """A stale processing_job_id is cleared and a new job is created."""
    async with _db() as session:
        svc = JobService(session, storage)
        first = await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        # Artificially age the job
        job_dao = JobDAO(session)
        job = await job_dao.get_by_id(first.id)
        stale_time = datetime.now(timezone.utc) - timedelta(minutes=45)
        await job_dao.update(job, updated_at=stale_time)
        await session.commit()

    async with _db() as session:
        svc = JobService(session, storage)
        second = await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        await session.commit()

    assert second.id != first.id
    assert second.status == "PENDING"

    # Verify old job marked failed
    async with _db() as session:
        job_dao = JobDAO(session)
        old = await job_dao.get_by_id(first.id)
        assert old.status == "FAILED"

    # Verify new processing_job_id
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_id(song.id)
        assert s.processing_job_id == second.id
