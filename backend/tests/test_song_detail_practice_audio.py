"""Song detail: the lighter mixer stems and the strum accents measured on the audio."""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from guitar_player.app_state import set_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.schemas.song import SongDetailResponse
from guitar_player.services.song_service import SongService

ACCENTS = {
    "beats_per_bar": 4, "steps_per_beat": 2,
    "accents": [False, False, True, False, False, True, False, False],
    "strength": [0.9, 0.4, 1.2, 0.6, 1.0, 1.24, 1.0, 1.18], "bars": 100,
}


async def _fetch_detail(settings, storage, files: list[str], json_files: dict[str, object]) -> SongDetailResponse:
    factory = init_db(settings)
    set_storage(storage)
    song_name = f"test_practice_{uuid.uuid4().hex[:8]}/test_song"
    song_dir = Path(settings.storage.base_path or "../local_bucket_test").resolve() / song_name
    for name in files:
        (song_dir / name).parent.mkdir(parents=True, exist_ok=True)
        (song_dir / name).write_bytes(b"ID3")
    for name, data in json_files.items():
        (song_dir / name).write_text(json.dumps(data))
    try:
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="Practice Song", artist="Test Artist", song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
                vocals_key=f"{song_name}/vocals.mp3", guitar_key=f"{song_name}/guitar.mp3",
            )
            await song_dao.commit()
        async with factory() as session:
            service = SongService(session, storage, MagicMock(), MagicMock(), MagicMock())
            return await service.get_song_detail(song.id)
    finally:
        async with factory() as session:
            await SongDAO(session).delete_by_id(song.id)
            await session.commit()
        shutil.rmtree(song_dir.parent, ignore_errors=True)
        await close_db()


@pytest.mark.asyncio
async def test_detail_offers_the_mixer_copy_of_each_stem_that_has_one(settings, storage):
    """Stems with a mixer/ copy get its URL; the others play their full-size file."""
    detail = await _fetch_detail(
        settings, storage,
        ["audio.mp3", "vocals.mp3", "guitar.mp3", "mixer/vocals.mp3"], {},
    )

    assert detail.mixer_stems.vocals is not None
    assert detail.mixer_stems.vocals.endswith("/mixer/vocals.mp3")
    assert detail.mixer_stems.guitar is None
    assert detail.stems.guitar.endswith("/guitar.mp3")


@pytest.mark.asyncio
async def test_detail_carries_the_strum_accents_measured_on_the_audio(settings, storage):
    """strum_accents.json reaches the player as-is."""
    detail = await _fetch_detail(settings, storage, ["audio.mp3"], {"strum_accents.json": ACCENTS})

    assert detail.strum_accents is not None
    assert detail.strum_accents.accents == ACCENTS["accents"]
    assert detail.strum_accents.steps_per_beat == 2


@pytest.mark.asyncio
async def test_detail_has_no_accents_before_they_are_measured(settings, storage):
    detail = await _fetch_detail(settings, storage, ["audio.mp3"], {})

    assert detail.strum_accents is None
