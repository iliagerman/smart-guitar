"""Integration test: admin triggers tabs generation when missing.

Use case covered:
- A song exists with a guitar stem on disk.
- tabs.json is missing.
- Admin path should enqueue tabs generation and eventually persist tabs_key.

Requires:
- Running tabs server (managed by fixture)
- Local test storage (../local_bucket_test)
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from guitar_player.app_state import set_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.services.job_service import JobService


async def _wait_for_file(storage, key: str, timeout_s: float = 180) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if storage.file_exists(key):
            return
        await asyncio.sleep(1.5)
    raise TimeoutError(f"Timed out waiting for storage key to exist: {key}")


@pytest.mark.asyncio
@pytest.mark.timeout(300)
async def test_admin_enqueues_tabs_generation_when_missing(
    tabs_server,
    settings,
    storage,
):
    # Initialize global DB + storage singletons (used by background tasks).
    factory = init_db(settings)
    set_storage(storage)

    song_name = "tabs_generation"
    local_bucket = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    song_dir = local_bucket / song_name
    assert song_dir.is_dir(), f"Test song dir missing: {song_dir}"

    guitar_path = song_dir / "guitar.mp3"
    assert guitar_path.is_file(), f"Test guitar stem missing: {guitar_path}"

    tabs_key = f"{song_name}/tabs.json"

    # Ensure we're exercising the missing-tabs path.
    if storage.file_exists(tabs_key):
        try:
            Path(storage.get_url(tabs_key)).unlink(missing_ok=True)
        except Exception:
            pass

    try:
        # Create a Song DB record pointing at the existing guitar stem.
        async with factory() as session:
            song_dao = SongDAO(session)
            existing = await song_dao.get_by_song_name(song_name)
            if existing:
                await song_dao.delete(existing)
                await session.commit()

            song = await song_dao.create(
                title="Tabs Generation Test Song",
                artist="test",
                song_name=song_name,
                audio_key=f"{song_name}/guitar.mp3",  # not used here, but non-null helps other flows
                guitar_key=f"{song_name}/guitar.mp3",
            )
            await session.commit()

            job_service = JobService(session, storage)
            enqueued = await job_service.trigger_tabs_generation_if_missing(song.id)

            # It should enqueue work because tabs.json is missing.
            assert enqueued is True
            await session.commit()

        # Wait for tabs.json to appear.
        await _wait_for_file(storage, tabs_key, timeout_s=180)

        # And verify the DB key is persisted.
        async with factory() as session:
            db_song = await SongDAO(session).get_by_song_name(song_name)
            assert db_song is not None
            assert db_song.tabs_key == tabs_key
            assert storage.file_exists(db_song.tabs_key)

    finally:
        # Cleanup generated artifact so it doesn't affect other tests.
        try:
            if storage.file_exists(tabs_key):
                Path(storage.get_url(tabs_key)).unlink(missing_ok=True)
        except Exception:
            pass

        await close_db()
