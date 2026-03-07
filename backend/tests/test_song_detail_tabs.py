"""Tests for tabs data in the song detail endpoint."""

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
from guitar_player.services.song_service import SongService


def _make_song_service(session, storage):
    """Create a SongService with stub dependencies (youtube, llm, artwork)."""
    return SongService(session, storage, MagicMock(), MagicMock(), MagicMock())


SAMPLE_TABS = {
    "tuning": ["E2", "A2", "D3", "G3", "B3", "E4"],
    "notes": [
        {
            "start_time": 0.50,
            "end_time": 0.82,
            "string": 3,
            "fret": 0,
            "midi_pitch": 55,
            "confidence": 0.92,
        },
        {
            "start_time": 0.83,
            "end_time": 1.20,
            "string": 4,
            "fret": 1,
            "midi_pitch": 60,
            "confidence": 0.87,
        },
        {
            "start_time": 1.21,
            "end_time": 1.55,
            "string": 3,
            "fret": 2,
            "midi_pitch": 57,
            "confidence": 0.94,
        },
    ],
}


def _write_tabs_to_storage(settings, tabs_key: str, data: dict) -> Path:
    """Write a tabs JSON file directly to the local storage path."""
    base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    path = base / tabs_key
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)
    return path


@pytest.mark.asyncio
async def test_song_detail_includes_tabs(settings, storage):
    """Song with a tabs_key returns tabs array in the detail response."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_tabs_{uuid.uuid4().hex[:8]}/test_song"
    tabs_key = f"{song_name}/tabs.json"
    created_dirs: list[Path] = []

    try:
        # Write a tabs.json file to storage
        tabs_path = _write_tabs_to_storage(settings, tabs_key, SAMPLE_TABS)
        created_dirs.append(tabs_path.parent.parent)

        # Create a song with tabs_key set
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="Test Song With Tabs",
                artist="Test Artist",
                song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            song.tabs_key = tabs_key
            await session.commit()
            song_id = song.id

        # Fetch song detail
        async with factory() as session:
            song_service = _make_song_service(session, storage)
            detail = await song_service.get_song_detail(song_id)

        assert len(detail.tabs) == 3
        assert detail.tabs[0].start_time == 0.50
        assert detail.tabs[0].string == 3
        assert detail.tabs[0].fret == 0
        assert detail.tabs[0].midi_pitch == 55
        assert detail.tabs[0].confidence == 0.92

    finally:
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.get_by_song_name(song_name)
            if song:
                await song_dao.delete(song)
                await session.commit()
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)
        await close_db()


@pytest.mark.asyncio
async def test_song_detail_empty_tabs_when_missing(settings, storage):
    """Song without tabs_key returns empty tabs list."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_no_tabs_{uuid.uuid4().hex[:8]}/test_song"

    try:
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="Test Song Without Tabs",
                artist="Test Artist",
                song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            await session.commit()
            song_id = song.id

        async with factory() as session:
            song_service = _make_song_service(session, storage)
            detail = await song_service.get_song_detail(song_id)

        assert detail.tabs == []

    finally:
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.get_by_song_name(song_name)
            if song:
                await song_dao.delete(song)
                await session.commit()
        await close_db()


@pytest.mark.asyncio
async def test_song_detail_tabs_structure(settings, storage):
    """Each tab note has the correct fields and value ranges."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_tabs_struct_{uuid.uuid4().hex[:8]}/test_song"
    tabs_key = f"{song_name}/tabs.json"
    created_dirs: list[Path] = []

    try:
        tabs_path = _write_tabs_to_storage(settings, tabs_key, SAMPLE_TABS)
        created_dirs.append(tabs_path.parent.parent)

        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="Test Song Tabs Structure",
                artist="Test Artist",
                song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            song.tabs_key = tabs_key
            await session.commit()
            song_id = song.id

        async with factory() as session:
            song_service = _make_song_service(session, storage)
            detail = await song_service.get_song_detail(song_id)

        for note in detail.tabs:
            assert isinstance(note.start_time, float)
            assert isinstance(note.end_time, float)
            assert note.end_time > note.start_time
            assert isinstance(note.string, int)
            assert 0 <= note.string <= 5
            assert isinstance(note.fret, int)
            assert 0 <= note.fret <= 24
            assert isinstance(note.midi_pitch, int)
            assert 0 <= note.confidence <= 1.0

    finally:
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.get_by_song_name(song_name)
            if song:
                await song_dao.delete(song)
                await session.commit()
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)
        await close_db()
