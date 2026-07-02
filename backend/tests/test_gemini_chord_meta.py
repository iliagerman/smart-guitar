"""Integration test: the Gemini chord path must not drop autochord's bar_starts.

``fetch_gemini_chords`` used to overwrite chord_meta.json wholesale, silently
dropping the ``bar_starts`` grid written earlier by the autochord pipeline
and breaking the bars view / strum grid. Storage + DB use the standard test
fixtures; the network-facing Gemini call is mocked.
"""

from __future__ import annotations

import shutil
import types
import uuid
from pathlib import Path

import pytest

from guitar_player.app_state import set_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.services import gemini_chord_service
from guitar_player.services.gemini_chord_service import GeminiChordEntry, GeminiChordResult
from guitar_player.services.job_service import lyrics_chords


def _song_dir(settings, song_name: str) -> Path:
    base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    return base / song_name.split("/")[0]


@pytest.mark.asyncio
async def test_fetch_gemini_chords_preserves_existing_bar_starts(settings, storage, monkeypatch):
    """chord_meta.json keeps bar_starts written by autochord after Gemini runs."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_gemini_meta_{uuid.uuid4().hex[:8]}/song"

    fake_settings = types.SimpleNamespace(gemini=types.SimpleNamespace(api_key="fake-key"))
    monkeypatch.setattr("guitar_player.config.get_settings", lambda: fake_settings)

    async def _fake_detect_chords(audio_path, api_key, tutorial_context):
        return GeminiChordResult(
            chords=[
                GeminiChordEntry(start_time=0.0, end_time=2.0, chord="G"),
                GeminiChordEntry(start_time=2.0, end_time=4.0, chord="D"),
            ],
            key="G",
            capo=0,
            bpm=100,
        )

    monkeypatch.setattr(gemini_chord_service, "detect_chords", _fake_detect_chords)

    try:
        storage.write_json(f"{song_name}/chord_meta.json", {
            "bpm": 100.0, "bar_starts": [0.0, 2.4, 4.8, 7.2],
        })
        audio_key = f"{song_name}/audio.mp3"
        audio_path = Path(storage.resolve_service_path(audio_key))
        audio_path.parent.mkdir(parents=True, exist_ok=True)
        audio_path.write_bytes(b"fake-audio")

        async with factory() as session:
            song = await SongDAO(session).create(
                title="Some Song", artist="Some Artist", song_name=song_name,
                audio_key=audio_key, duration_seconds=10,
            )
            await session.commit()
            song_id = song.id

        await lyrics_chords.fetch_gemini_chords(song_id)

        meta = storage.read_json(f"{song_name}/chord_meta.json")
        assert meta["bar_starts"] == [0.0, 2.4, 4.8, 7.2]
        assert meta["key"] == "G"
    finally:
        async with factory() as session:
            s = await SongDAO(session).get_by_song_name(song_name)
            if s:
                await SongDAO(session).delete_by_id(s.id)
                await session.commit()
        shutil.rmtree(_song_dir(settings, song_name), ignore_errors=True)
        await close_db()
