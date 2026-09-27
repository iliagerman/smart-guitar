"""Integration tests: auto-heal strumming when it's missing.

Covers:
- trigger_external_strums_if_missing re-generates when the stored
  songsterr_data.json is valid but has no strum sections (cooldown-gated),
  and skips when sections are present or a recent attempt was made.
- _fetch_strum_patterns passes the configured Tavily key through to the LLM
  lookup (rather than the old hard-coded None).
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

import guitar_player.services.job_service as job_pkg
from guitar_player.app_state import set_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.services.job_service import JobService
from guitar_player.services.job_service import external_data
from guitar_player.services.job_service.helpers import utcnow


ARTIST = "Travis"
TITLE = "Sing"


def _song_dir(settings, song_name: str) -> Path:
    base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    return base / song_name.split("/")[0]


def _songsterr_payload(sections: list[dict], *, with_tab_rhythm: bool = True) -> dict:
    payload = {
        "matched_artist": ARTIST,
        "matched_title": TITLE,
        "tabs": [{"t": 0.0}],
        "sections": sections,
        "tutorial_url": "https://www.youtube.com/watch?v=xeFEWBN5O5A",
        "tutorial_links": [],
    }
    if with_tab_rhythm:
        payload["tab_rhythm"] = None  # tab checked, no usable pattern
    return payload


_SECTION = {"name": "Verse", "start_time": 0.0, "end_time": 10.0, "strum_pattern": ["down", "up"]}


async def _make_song(factory, song_name: str, key: str, attempted_at=None):
    async with factory() as session:
        dao = SongDAO(session)
        song = await dao.create(
            title=TITLE, artist=ARTIST, song_name=song_name,
            audio_key=f"{song_name}/audio.mp3",
            external_strums_key=key,
        )
        if attempted_at is not None:
            await dao.update_by_id(song.id, external_strums_attempted_at=attempted_at)
        await session.commit()
        return song.id


async def _cleanup(factory, settings, song_name: str):
    async with factory() as session:
        s = await SongDAO(session).get_by_song_name(song_name)
        if s:
            await SongDAO(session).delete_by_id(s.id)
            await session.commit()
    shutil.rmtree(_song_dir(settings, song_name), ignore_errors=True)
    await close_db()


@pytest.mark.asyncio
async def test_skips_when_strum_sections_present(settings, storage, monkeypatch):
    factory = init_db(settings)
    set_storage(storage)
    song_name = f"test_strum_have_{uuid.uuid4().hex[:8]}/song"
    key = f"{song_name}/songsterr_data.json"
    calls: list = []
    monkeypatch.setattr(job_pkg, "_enqueue_external_strums_fetch", lambda sid: calls.append(sid))
    try:
        storage.write_json(key, _songsterr_payload([_SECTION]))
        song_id = await _make_song(factory, song_name, key)
        async with factory() as session:
            enqueued = await JobService(session, storage).trigger_external_strums_if_missing(song_id)
        assert enqueued is False
        assert calls == []
    finally:
        await _cleanup(factory, settings, song_name)


@pytest.mark.asyncio
async def test_regenerates_when_sections_empty_and_no_recent_attempt(settings, storage, monkeypatch):
    factory = init_db(settings)
    set_storage(storage)
    song_name = f"test_strum_empty_{uuid.uuid4().hex[:8]}/song"
    key = f"{song_name}/songsterr_data.json"
    calls: list = []
    monkeypatch.setattr(job_pkg, "_enqueue_external_strums_fetch", lambda sid: calls.append(sid))
    try:
        storage.write_json(key, _songsterr_payload([]))  # tutorial present, NO strums
        song_id = await _make_song(factory, song_name, key, attempted_at=None)
        async with factory() as session:
            enqueued = await JobService(session, storage).trigger_external_strums_if_missing(song_id)
        assert enqueued is True
        assert calls == [song_id]
    finally:
        await _cleanup(factory, settings, song_name)


@pytest.mark.asyncio
async def test_skips_empty_sections_when_recent_attempt(settings, storage, monkeypatch):
    factory = init_db(settings)
    set_storage(storage)
    song_name = f"test_strum_cd_{uuid.uuid4().hex[:8]}/song"
    key = f"{song_name}/songsterr_data.json"
    calls: list = []
    monkeypatch.setattr(job_pkg, "_enqueue_external_strums_fetch", lambda sid: calls.append(sid))
    try:
        storage.write_json(key, _songsterr_payload([]))
        song_id = await _make_song(factory, song_name, key, attempted_at=utcnow())
        async with factory() as session:
            enqueued = await JobService(session, storage).trigger_external_strums_if_missing(song_id)
        assert enqueued is False
        assert calls == []
    finally:
        await _cleanup(factory, settings, song_name)


@pytest.mark.asyncio
async def test_fetch_strum_patterns_passes_tavily_key(settings, monkeypatch):
    """_fetch_strum_patterns must forward the configured Tavily key, not None."""
    captured: dict = {}

    class _FakeLlm:
        def __init__(self, _settings):
            pass

        async def lookup_strum_patterns(self, artist, title, tavily_api_key=None):
            captured["tavily_api_key"] = tavily_api_key
            return None

    async def _no_youtube(title, artist):
        return "", []

    monkeypatch.setattr("guitar_player.services.llm_service.LlmService", _FakeLlm)
    monkeypatch.setattr(external_data, "search_youtube_tutorial", _no_youtube)

    await external_data._fetch_strum_patterns(settings, ARTIST, TITLE, 200.0)

    assert captured["tavily_api_key"] == settings.tavily.api_key


@pytest.mark.asyncio
async def test_refreshes_once_when_saved_before_tab_rhythm_existed(settings, storage, monkeypatch):
    """A file with strum sections but no tab_rhythm field predates tab patterns: refetch it."""
    factory = init_db(settings)
    set_storage(storage)
    song_name = f"test_strum_old_{uuid.uuid4().hex[:8]}/song"
    key = f"{song_name}/songsterr_data.json"
    calls: list = []
    monkeypatch.setattr(job_pkg, "_enqueue_external_strums_fetch", lambda sid: calls.append(sid))
    try:
        storage.write_json(key, _songsterr_payload([_SECTION], with_tab_rhythm=False))
        song_id = await _make_song(factory, song_name, key)
        async with factory() as session:
            enqueued = await JobService(session, storage).trigger_external_strums_if_missing(song_id)
        assert enqueued is True
        assert calls == [song_id]
    finally:
        await _cleanup(factory, settings, song_name)


@pytest.mark.asyncio
async def test_fetch_records_tab_rhythm_even_without_a_tab(settings, storage, monkeypatch):
    """No Songsterr tab still writes tab_rhythm (null), so the song is not refetched on every open."""
    factory = init_db(settings)
    set_storage(storage)
    song_name = f"test_strum_notab_{uuid.uuid4().hex[:8]}/song"

    async def _no_songsterr(*_a, **_k):
        return None

    async def _llm_sections(*_a, **_k):
        return [_SECTION], "", "", []

    monkeypatch.setattr(external_data, "_fetch_songsterr_result", _no_songsterr)
    monkeypatch.setattr(external_data, "_fetch_strum_patterns", _llm_sections)
    try:
        song_id = await _make_song(factory, song_name, None)
        await external_data.fetch_external_strums(song_id)

        data = storage.read_json(f"{song_name}/songsterr_data.json")
        assert "tab_rhythm" in data
        assert data["tab_rhythm"] is None
        async with factory() as session:
            enqueued = await JobService(session, storage).trigger_external_strums_if_missing(song_id)
        assert enqueued is False
    finally:
        await _cleanup(factory, settings, song_name)
