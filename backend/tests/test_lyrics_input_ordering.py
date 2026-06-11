"""The full Whisper pass must transcribe the VOCALS STEM, not the full mix.

For a new song no stems exist when the job starts, so kicking off the full
transcription immediately means whisper hears drums/guitar bleed — a large
accuracy hit (this is how 1,083 production songs were originally built).
The fixed ordering is:

  * quick lyrics (fast LRCLIB/onset alignment) start immediately on the
    full mix — early UX feedback, alignment is bleed-tolerant;
  * the full Whisper transcription starts only after stem separation,
    on the isolated vocals stem.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

from guitar_player.app_state import set_storage
from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.services.job_service import stem_processing
from guitar_player.services.processing_service import (
    ChordRecognitionResult,
    SeparationResult,
    StemInfo,
)
from guitar_player.services.sync_service import ensure_default_user


@pytest.mark.asyncio
async def test_full_transcription_uses_vocals_stem_after_separation(
    settings, storage, monkeypatch,
):
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_lyrics_order_{uuid.uuid4().hex[:8]}/song"
    base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    song_dir = base / song_name
    song_dir.mkdir(parents=True)
    (song_dir / "audio.mp3").write_bytes(b"x")

    transcribe_calls: list[dict] = []

    async def fake_separate(self, audio_path, requested_outputs=None):
        # Separation produces the vocals stem on disk, like demucs would.
        (song_dir / "vocals.mp3").write_bytes(b"v")
        return SeparationResult(
            stems=[StemInfo(name="vocals", path=str(song_dir / "vocals.mp3"))],
            output_path=str(song_dir),
        )

    async def fake_recognize(self, audio_path):
        return ChordRecognitionResult(chords=[], output_path="")

    async def fake_transcribe(self, input_path, **kwargs):
        transcribe_calls.append({"input_path": input_path, **kwargs})

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(
        "guitar_player.services.processing_service.ProcessingService.separate_stems",
        fake_separate,
    )
    monkeypatch.setattr(
        "guitar_player.services.processing_service.ProcessingService.recognize_chords",
        fake_recognize,
    )
    monkeypatch.setattr(
        "guitar_player.services.processing_service.ProcessingService.transcribe_lyrics",
        fake_transcribe,
    )
    monkeypatch.setattr(
        "guitar_player.services.processing_service.ProcessingService.detect_bass",
        noop,
    )
    monkeypatch.setattr(stem_processing, "_do_merge", noop)
    monkeypatch.setattr(stem_processing, "_do_tabs", noop)
    monkeypatch.setattr(stem_processing, "_check_quick_lyrics", noop)

    try:
        async with factory() as session:
            song_dao = SongDAO(session)
            job_dao = JobDAO(session)
            user = await ensure_default_user(session, "order-test@example.com")
            song = await song_dao.create(
                title="Order Test", artist="Tester",
                song_name=song_name, audio_key=f"{song_name}/audio.mp3",
            )
            await song_dao.commit()
            job = await job_dao.create(
                user_id=user.id, song_id=song.id, status="PENDING",
                progress=0, stage="queued", descriptions=["vocals"],
            )
            await job_dao.commit()
            job_id = job.id

        await stem_processing.process_job(job_id)

        full_calls = [c for c in transcribe_calls if not c.get("fast_only")]
        quick_calls = [c for c in transcribe_calls if c.get("fast_only")]

        # The full Whisper pass must run on the isolated vocals stem.
        assert len(full_calls) == 1, f"expected one full transcription, got {transcribe_calls}"
        assert full_calls[0]["input_path"].endswith("vocals.mp3"), (
            f"full transcription used {full_calls[0]['input_path']} instead of the vocals stem"
        )
        # The quick pass runs early on the full mix for fast UX feedback.
        assert len(quick_calls) == 1
        assert quick_calls[0]["input_path"].endswith("audio.mp3")
    finally:
        async with factory() as session:
            song = await SongDAO(session).get_by_song_name(song_name)
            if song:
                jobs_dao = JobDAO(session)
                await jobs_dao.delete_by_song_ids([song.id])
                await SongDAO(session).delete_by_id(song.id)
                await session.commit()
        shutil.rmtree(song_dir.parent, ignore_errors=True)
        await close_db()
