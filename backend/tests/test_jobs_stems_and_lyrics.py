"""Integration test: job processing produces expected stems + lyrics.

Regression covered:
- Frontend submits canonical stem names ("vocals", "guitar", "guitar_removed")
  but the demucs service expects output keys ("vocals_isolated", "guitar_isolated", ...).
  If we forward canonical names directly, only "guitar_removed" is produced and
  lyrics transcription fails because the vocals stem does not exist.

Requires:
- Running demucs/chords/lyrics servers (managed by fixtures)
- Local test storage (../local_bucket_test)
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from guitar_player.app_state import set_storage
from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.services.job_service import JobService
from guitar_player.services.processing_service import ProcessingService


TEST_USER_SUB = "test-jobs-user"
TEST_USER_EMAIL = "test-jobs@example.com"


async def _wait_for_job_completion(job_id, timeout_s: float = 900) -> str:
    """Poll job status until COMPLETED/FAILED or timeout."""
    from guitar_player.database import get_session_factory

    deadline = time.monotonic() + timeout_s
    last_status: str | None = None
    while time.monotonic() < deadline:
        factory = get_session_factory()
        async with factory() as session:
            job = await JobDAO(session).get_by_id(job_id)
            assert job is not None
            last_status = job.status
            if job.status in {"COMPLETED", "FAILED"}:
                return job.status
        await asyncio.sleep(2)

    raise TimeoutError(
        f"Job {job_id} did not finish within {timeout_s}s (last_status={last_status})"
    )


@pytest.mark.asyncio
@pytest.mark.timeout(900)
async def test_job_processing_translates_stems_and_generates_lyrics(
    demucs_server,
    chords_server,
    lyrics_server,
    tabs_server,
    settings,
    storage,
):
    # Initialize global DB + storage singletons (used by background job processing).
    factory = init_db(settings)
    set_storage(storage)

    song_name = "bob_dylan/knocking_on_heavens_door"
    local_bucket = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    song_dir = local_bucket / song_name
    assert song_dir.is_dir(), f"Test song dir missing: {song_dir}"

    audio_files = sorted(song_dir.glob("*.mp3"))
    assert audio_files, f"No audio found in test song dir: {song_dir}"
    audio_file = audio_files[0]

    generated_files: list[Path] = []

    try:
        # Create a Song DB record pointing at the existing mp3.
        async with factory() as session:
            song_dao = SongDAO(session)
            existing = await song_dao.get_by_song_name(song_name)
            if existing:
                await song_dao.delete(existing)
                await session.commit()

            song = await song_dao.create(
                title="Knockin' On Heaven's Door (test)",
                artist="bob_dylan",
                song_name=song_name,
                audio_key=f"{song_name}/{audio_file.name}",
            )
            await session.commit()

            job_service = JobService(session, storage)
            processing = ProcessingService(settings)

            # Mimic frontend payload: canonical stem names.
            job_resp = await job_service.create_and_process_job(
                user_sub=TEST_USER_SUB,
                user_email=TEST_USER_EMAIL,
                song_id=song.id,
                descriptions=["vocals", "guitar", "guitar_removed"],
                mode="isolate",
                processing=processing,
            )
            job_id = job_resp.id

            # Important: background processing uses its own DB sessions; commit so it can see the job.
            await session.commit()

        status = await _wait_for_job_completion(job_id, timeout_s=900)
        assert status == "COMPLETED", (
            f"Job did not complete successfully (status={status})"
        )

        # Verify expected artifacts exist on disk (.mp3).
        stem_names = ["guitar", "vocals", "guitar_removed"]
        for stem in stem_names:
            mp3 = song_dir / f"{stem}.mp3"
            generated_files.append(mp3)
            assert mp3.is_file(), f"Expected output missing: {stem}.mp3"
        chords_path = song_dir / "chords.json"
        generated_files.append(chords_path)
        assert chords_path.is_file(), f"Expected output missing: {chords_path}"

        lyrics_path = song_dir / "lyrics.json"
        generated_files.append(lyrics_path)
        assert lyrics_path.is_file(), f"Expected output missing: {lyrics_path}"

        tabs_path = song_dir / "tabs.json"
        generated_files.append(tabs_path)
        assert tabs_path.is_file(), f"Expected output missing: {tabs_path}"

        # Verify vocals+guitar merged stem was produced.
        vg_mp3 = song_dir / "vocals_guitar.mp3"
        generated_files.append(vg_mp3)
        assert vg_mp3.is_file(), (
            f"Expected output missing: vocals_guitar.mp3"
        )

        # Also verify Song DB keys were set for the produced stems.
        async with factory() as session:
            db_song = await SongDAO(session).get_by_song_name(song_name)
            assert db_song is not None
            assert db_song.guitar_key and storage.file_exists(db_song.guitar_key)
            assert db_song.vocals_key and storage.file_exists(db_song.vocals_key)
            assert db_song.guitar_removed_key and storage.file_exists(
                db_song.guitar_removed_key
            )
            assert db_song.chords_key and storage.file_exists(db_song.chords_key)
            assert db_song.lyrics_key and storage.file_exists(db_song.lyrics_key)
            assert db_song.tabs_key and storage.file_exists(db_song.tabs_key)
            assert db_song.vocals_guitar_key and storage.file_exists(
                db_song.vocals_guitar_key
            )

    finally:
        # Clean up only generated artifacts; keep the source audio file.
        for p in generated_files:
            try:
                if p.is_file():
                    p.unlink()
            except Exception:
                pass

        # Also remove generated sidecar files if they were created.
        for extra in [
            "chords.lab",
            "chords_intermediate.json",
            "chords_beginner.json",
            "chords_beginner_capo_5.json",
            "chords_beginner_capo_7.json",
            "tabs.json",
            "vocals_guitar.mp3",
        ]:
            try:
                f = song_dir / extra
                if f.is_file():
                    f.unlink()
            except Exception:
                pass

        await close_db()
