"""Unit tests: idempotent job creation.

Verifies that `create_and_process_job` returns an existing active job instead
of creating duplicates, while still allowing new jobs after completion/failure.

These tests are lightweight (SQLite, no external services) because we pass
``processing=None`` to skip background task enqueuing.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from guitar_player.app_state import set_storage
from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.services.job_service import JobService

TEST_USER_SUB = "test-idempotent-user"
TEST_USER_EMAIL = "test-idempotent@example.com"
SONG_NAME = "test_artist/test_song_idempotent"


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
            title="Idempotent Test Song",
            artist="test_artist",
            song_name=SONG_NAME,
            audio_key=f"{SONG_NAME}/audio.mp3",
        )
        await session.commit()
        yield song

    # Cleanup
    async with _db() as session:
        song_dao = SongDAO(session)
        s = await song_dao.get_by_song_name(SONG_NAME)
        if s:
            await song_dao.delete(s)
            await session.commit()


# ---- Tests ----


@pytest.mark.asyncio
async def test_creates_new_job_when_none_exists(_db, song, storage):
    """First call creates a new PENDING job."""
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

    assert resp.status == "PENDING"
    assert resp.song_id == song.id


@pytest.mark.asyncio
async def test_returns_existing_pending_job(_db, song, storage):
    """Calling again while a PENDING job exists returns the same job."""
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
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        await session.commit()

    assert second.id == first.id, "Should return the existing job, not create a new one"


@pytest.mark.asyncio
async def test_returns_existing_processing_job(_db, song, storage):
    """Calling again while a PROCESSING job exists returns the same job."""
    async with _db() as session:
        svc = JobService(session, storage)
        first = await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        # Advance job to PROCESSING
        job_dao = JobDAO(session)
        job = await job_dao.get_by_id(first.id)
        await job_dao.update_status(job, "PROCESSING")
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

    assert second.id == first.id, "Should return the existing PROCESSING job"


@pytest.mark.asyncio
async def test_creates_new_job_after_completed(_db, song, storage):
    """A COMPLETED job should not block creation of a new job."""
    async with _db() as session:
        svc = JobService(session, storage)
        first = await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        # Mark completed
        job_dao = JobDAO(session)
        job = await job_dao.get_by_id(first.id)
        await job_dao.update_status(job, "COMPLETED", results=[])
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

    assert second.id != first.id, "Should create a new job after the previous one completed"
    assert second.status == "PENDING"


@pytest.mark.asyncio
async def test_creates_new_job_after_failed(_db, song, storage):
    """A FAILED job should not block creation of a new job."""
    async with _db() as session:
        svc = JobService(session, storage)
        first = await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        # Mark failed
        job_dao = JobDAO(session)
        job = await job_dao.get_by_id(first.id)
        await job_dao.update_status(job, "FAILED", error_message="test failure")
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

    assert second.id != first.id, "Should create a new job after the previous one failed"
    assert second.status == "PENDING"


@pytest.mark.asyncio
async def test_stale_active_job_is_replaced(_db, song, storage):
    """A stale active job (>30 min) is marked FAILED and a new job is created."""
    async with _db() as session:
        svc = JobService(session, storage)
        first = await svc.create_and_process_job(
            user_sub=TEST_USER_SUB,
            user_email=TEST_USER_EMAIL,
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        # Artificially age the job to make it stale (>30 min)
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

    assert second.id != first.id, "Should create a new job after the stale one"
    assert second.status == "PENDING"

    # Verify old job was marked FAILED
    async with _db() as session:
        job_dao = JobDAO(session)
        old_job = await job_dao.get_by_id(first.id)
        assert old_job.status == "FAILED"
        assert "Stale job" in (old_job.error_message or "")


@pytest.mark.asyncio
async def test_different_user_gets_existing_active_job(_db, song, storage):
    """A different user calling create_and_process_job gets the existing active job."""
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

    # Different user
    async with _db() as session:
        svc = JobService(session, storage)
        second = await svc.create_and_process_job(
            user_sub="different-user-sub",
            user_email="other@example.com",
            song_id=song.id,
            descriptions=["vocals", "guitar"],
            processing=None,
        )
        await session.commit()

    assert second.id == first.id, "Different user should get the same active job"
