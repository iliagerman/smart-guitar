"""Integration checks against disposable PostgreSQL and filesystem storage."""

import asyncio
import uuid
from unittest.mock import AsyncMock, patch

from guitar_player.app_state import set_storage
from guitar_player.config import get_settings
from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.database import close_db, init_db, safe_session
from guitar_player.exceptions import BadRequestError
from guitar_player.models import Base
from guitar_player.services.admin_service import AdminService
from guitar_player.services.job_service import JobService
from guitar_player.services.job_service.stem_processing import process_job
from guitar_player.services.processing_service import ProcessingService
from guitar_player.services.song_service.audio_healing import (
    _queue_missing_audio,
    heal_audio_and_thumbnail,
)
from guitar_player.services.youtube_service import YoutubeService
from guitar_player.storage import StorageBackend, create_storage


async def check_missing_audio(storage: StorageBackend, song_id: uuid.UUID) -> None:
    async with safe_session() as session:
        jobs = JobService(session, storage)
        try:
            await jobs.create_and_process_job(
                "generation-check",
                "generation@example.test",
                song_id,
                ["vocals"],
                processing=ProcessingService(get_settings()),
            )
        except BadRequestError:
            pass
        else:
            raise AssertionError("Missing audio must not dispatch a job")
        assert await JobDAO(session).get_active_job(song_id) is None
        job = await jobs.create_and_process_job(
            "generation-check",
            "generation@example.test",
            song_id,
            ["vocals"],
        )
        await session.commit()
    await process_job(job.id)
    async with safe_session() as session:
        saved = await JobDAO(session).get_by_id(job.id)
        song = await SongDAO(session).get_by_id(song_id)
        assert saved.status == "FAILED"
        assert song.processing_job_id is None
        manifest = storage.read_json(f"{song.song_name}/jobs/{job.id}/job_status.json")
        assert manifest["status"] == "FAILED"
        assert manifest["error_message"] == "Audio file not found"


async def check_queued_repair(storage: StorageBackend, song_id: uuid.UUID) -> None:
    async def publish(*args: object) -> None:
        async with safe_session() as session:
            song = await SongDAO(session).get_by_id(song_id)
            assert song.download_requested_at is not None
            assert song.audio_key == f"{song.song_name}/audio.mp3"

    async def queue() -> bool:
        async with safe_session() as session:
            return await _queue_missing_audio(song_id, SongDAO(session), "test-queue")

    with patch(
        "guitar_player.services.song_service.audio_healing.publish_download_request",
        new=AsyncMock(side_effect=publish),
    ) as publisher:
        assert sorted(await asyncio.gather(queue(), queue())) == [False, True]
        async with safe_session() as session:
            song = await SongDAO(session).get_by_id(song_id)
            result = await AdminService(session, storage)._handle_unrecoverable_song(
                song_id,
                song,
                None,
                None,
                [],
            )
            assert not result.deleted
            assert "audio_download_pending" in result.warnings
        assert publisher.await_count == 1


async def check_queue_failure(storage: StorageBackend, song_id: uuid.UUID) -> None:
    async with safe_session() as session:
        await SongDAO(session).update_by_id(song_id, download_requested_at=None)
        await session.commit()
    with patch(
        "guitar_player.services.song_service.audio_healing.publish_download_request",
        new=AsyncMock(side_effect=ConnectionError("queue unavailable")),
    ):
        async with safe_session() as session:
            try:
                await _queue_missing_audio(song_id, SongDAO(session), "test-queue")
            except ConnectionError:
                pass
            else:
                raise AssertionError("Queue failure must propagate")
    async with safe_session() as session:
        song = await SongDAO(session).get_by_id(song_id)
        assert song.download_requested_at is None
        response = await AdminService(session, storage)._handle_unrecoverable_song(
            song_id,
            song,
            "queue unavailable",
            ConnectionError("queue unavailable"),
            [],
        )
        assert not response.deleted
        assert await SongDAO(session).get_by_id(song_id) is not None


async def check_metadata_heal(storage: StorageBackend, song_id: uuid.UUID) -> None:
    with patch(
        "guitar_player.services.song_service.audio_healing.publish_download_request",
        new=AsyncMock(),
    ) as publisher:
        async with safe_session() as session:
            original = await SongDAO(session).get_by_id(song_id)
            storage.write_json(f"{original.song_name}/cover.jpg", {})
            assert await heal_audio_and_thumbnail(
                song_id,
                "generation-check",
                "generation@example.test",
                SongDAO(session),
                UserDAO(session),
                storage,
                YoutubeService(),
            )
        async with safe_session() as session:
            song = await SongDAO(session).get_by_id(song_id)
            assert (song.artist, song.title) == ("Pleasantries", "Apocalypse")
            assert song.song_name == original.song_name
            assert song.audio_key == original.audio_key
            assert song.download_requested_at is not None
        assert publisher.await_count == 1


async def check_dispatch_failure(storage: StorageBackend, song_id: uuid.UUID) -> None:
    async with safe_session() as session:
        song = await SongDAO(session).get_by_id(song_id)
    storage.write_json(song.audio_key, {"exists": True})
    with patch(
        "guitar_player.services.lambda_invoke.invoke_event",
        new=AsyncMock(side_effect=ConnectionError("Lambda unavailable")),
    ) as invoke:
        async with safe_session() as session:
            try:
                await JobService(session, storage).create_and_process_job(
                    "generation-check",
                    "generation@example.test",
                    song_id,
                    ["vocals"],
                    processing=ProcessingService(get_settings()),
                )
            except ConnectionError:
                pass
            else:
                raise AssertionError("Dispatch failure must propagate")
        job_id = uuid.UUID(invoke.await_args.kwargs["payload"]["job_id"])
    async with safe_session() as session:
        job = await JobDAO(session).get_by_id(job_id)
        song = await SongDAO(session).get_by_id(song_id)
        assert job.status == "FAILED"
        assert song.processing_job_id is None
        manifest = storage.read_json(f"{song.song_name}/jobs/{job_id}/job_status.json")
        assert manifest["status"] == "FAILED"


async def main() -> None:
    settings = get_settings()
    assert settings.db.url.startswith("postgresql") and settings.db.url.endswith(
        "/generation_check"
    ), "Use disposable PostgreSQL"
    factory = init_db(settings)
    async with factory() as session:
        connection = await session.connection()
        await connection.run_sync(Base.metadata.create_all)
        await session.commit()
    storage = create_storage(settings)
    set_storage(storage)
    song_name = f"generation_check/{uuid.uuid4()}"
    async with safe_session() as session:
        song = await SongDAO(session).create(
            song_name=song_name,
            title="Pleasantries",
            artist="Apocalypse",
            youtube_id="ue1-7qDI2NA",
            audio_key=f"{song_name}/audio.mp3",
        )
        await session.commit()
    try:
        await check_missing_audio(storage, song.id)
        await check_queued_repair(storage, song.id)
        await check_queue_failure(storage, song.id)
        await check_metadata_heal(storage, song.id)
        await check_dispatch_failure(storage, song.id)
        print(
            "PASS: audio readiness, failed manifest, repair commit/deduplication, pending preservation, queue and dispatch failures"
        )
    finally:
        for key in storage.list_files(song_name):
            storage.delete_file(key)
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
