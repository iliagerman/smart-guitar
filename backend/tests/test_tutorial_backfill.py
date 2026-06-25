"""Integration tests: on-demand tutorial-video recovery (S3-only).

Covers the four pieces of the fix:
1. detail loader fallback reads ``{song_name}/tutorial.json`` when the DB
   pointer ``external_strums_key`` is NULL (the read path).
2. ``fetch_tutorial_only`` writes a well-formed ``tutorial.json`` on success and
   a ``failed`` marker on miss (the write path), with no DB writes.
3. ``trigger_tutorial_if_missing`` enqueue/skip/cooldown logic via the S3 marker.
4. ``search_youtube_tutorial`` selects the highest-scored result from the
   prod-hardened ``YoutubeService.search`` output.

Network is always mocked. Storage + DB use the standard test fixtures.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest

import guitar_player.services.job_service as job_pkg
from guitar_player.app_state import set_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.services.job_service import JobService
from guitar_player.services.job_service import external_data, helpers
from guitar_player.services.song_service import SongService
from guitar_player.services.youtube_service import YouTubeSearchResult


def _make_song_service(session, storage):
    return SongService(session, storage, MagicMock(), MagicMock(), MagicMock())


def _song_dir(settings, song_name: str) -> Path:
    base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    return base / song_name.split("/")[0]


# ── 1. Loader fallback ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_detail_reads_tutorial_from_convention_file_when_key_null(settings, storage):
    """tutorial_url comes from {song_name}/tutorial.json even with external_strums_key NULL."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_tut_{uuid.uuid4().hex[:8]}/song"
    tutorial = {
        "tutorial_url": "https://www.youtube.com/watch?v=ABC123",
        "tutorial_links": [
            {"url": "https://www.youtube.com/watch?v=ABC123", "title": "How to play (lesson)"},
        ],
        "attempted_at": "2026-06-25T00:00:00+00:00",
        "status": "ready",
    }
    try:
        storage.write_json(f"{song_name}/tutorial.json", tutorial)

        async with factory() as session:
            song = await SongDAO(session).create(
                title="Some Popular Song",
                artist="Some Artist",
                song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            await session.commit()
            song_id = song.id
            assert song.external_strums_key is None

        async with factory() as session:
            detail = await _make_song_service(session, storage).get_song_detail(song_id)

        assert detail.tutorial_url == "https://www.youtube.com/watch?v=ABC123"
        assert len(detail.tutorial_links) == 1
    finally:
        async with factory() as session:
            s = await SongDAO(session).get_by_song_name(song_name)
            if s:
                await SongDAO(session).delete_by_id(s.id)
                await session.commit()
        shutil.rmtree(_song_dir(settings, song_name), ignore_errors=True)
        await close_db()


@pytest.mark.asyncio
async def test_detail_tutorial_none_when_no_files(settings, storage):
    """No songsterr_data.json and no tutorial.json -> tutorial_url is None."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_tut_none_{uuid.uuid4().hex[:8]}/song"
    try:
        async with factory() as session:
            song = await SongDAO(session).create(
                title="No Tutorial Song",
                artist="Artist",
                song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            await session.commit()
            song_id = song.id

        async with factory() as session:
            detail = await _make_song_service(session, storage).get_song_detail(song_id)

        assert detail.tutorial_url is None
        assert detail.tutorial_links == []
    finally:
        async with factory() as session:
            s = await SongDAO(session).get_by_song_name(song_name)
            if s:
                await SongDAO(session).delete_by_id(s.id)
                await session.commit()
        await close_db()


# ── 2. fetch_tutorial_only (write path) ────────────────────────────


@pytest.mark.asyncio
async def test_fetch_tutorial_only_writes_ready_marker(settings, storage, monkeypatch):
    """A found tutorial is written to tutorial.json with status=ready, no DB write."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_tut_fetch_{uuid.uuid4().hex[:8]}/song"

    async def _fake_youtube(title, artist):
        return (
            "https://www.youtube.com/watch?v=GOOD",
            [{"url": "https://www.youtube.com/watch?v=GOOD", "title": "guitar tutorial"}],
        )

    # No Tavily in test config; force the YouTube fallback path.
    monkeypatch.setattr(external_data, "search_youtube_tutorial", _fake_youtube)

    try:
        async with factory() as session:
            song = await SongDAO(session).create(
                title="Fetch Me", artist="Artist", song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            await session.commit()
            song_id = song.id

        await external_data.fetch_tutorial_only(song_id)

        key = f"{song_name}/tutorial.json"
        assert storage.file_exists(key)
        data = storage.read_json(key)
        assert data["tutorial_url"] == "https://www.youtube.com/watch?v=GOOD"
        assert data["status"] == "ready"
        assert data["attempted_at"]

        # No DB pointer should have been set (S3-only).
        async with factory() as session:
            db_song = await SongDAO(session).get_by_song_name(song_name)
            assert db_song.external_strums_key is None
    finally:
        async with factory() as session:
            s = await SongDAO(session).get_by_song_name(song_name)
            if s:
                await SongDAO(session).delete_by_id(s.id)
                await session.commit()
        shutil.rmtree(_song_dir(settings, song_name), ignore_errors=True)
        await close_db()


@pytest.mark.asyncio
async def test_fetch_tutorial_only_writes_failed_marker_on_miss(settings, storage, monkeypatch):
    """When no tutorial is found, a failed marker is written so we can cool down."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_tut_miss_{uuid.uuid4().hex[:8]}/song"

    async def _no_youtube(title, artist):
        return "", []

    monkeypatch.setattr(external_data, "search_youtube_tutorial", _no_youtube)

    try:
        async with factory() as session:
            song = await SongDAO(session).create(
                title="Obscure", artist="Nobody", song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            await session.commit()
            song_id = song.id

        await external_data.fetch_tutorial_only(song_id)

        data = storage.read_json(f"{song_name}/tutorial.json")
        assert data["tutorial_url"] == ""
        assert data["status"] == "failed"
        assert data["attempted_at"]
    finally:
        async with factory() as session:
            s = await SongDAO(session).get_by_song_name(song_name)
            if s:
                await SongDAO(session).delete_by_id(s.id)
                await session.commit()
        shutil.rmtree(_song_dir(settings, song_name), ignore_errors=True)
        await close_db()


# ── 3. trigger_tutorial_if_missing ─────────────────────────────────


@pytest.mark.asyncio
async def test_trigger_enqueues_when_no_tutorial(settings, storage, monkeypatch):
    factory = init_db(settings)
    set_storage(storage)
    song_name = f"test_tut_trig_{uuid.uuid4().hex[:8]}/song"

    calls: list = []
    monkeypatch.setattr(job_pkg, "_enqueue_tutorial_fetch", lambda sid: calls.append(sid))

    try:
        async with factory() as session:
            song = await SongDAO(session).create(
                title="Trigger Me", artist="Artist", song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            await session.commit()
            song_id = song.id

            enqueued = await JobService(session, storage).trigger_tutorial_if_missing(song_id)

        assert enqueued is True
        assert calls == [song_id]
    finally:
        async with factory() as session:
            s = await SongDAO(session).get_by_song_name(song_name)
            if s:
                await SongDAO(session).delete_by_id(s.id)
                await session.commit()
        await close_db()


@pytest.mark.asyncio
async def test_trigger_skips_when_tutorial_present(settings, storage, monkeypatch):
    factory = init_db(settings)
    set_storage(storage)
    song_name = f"test_tut_have_{uuid.uuid4().hex[:8]}/song"

    calls: list = []
    monkeypatch.setattr(job_pkg, "_enqueue_tutorial_fetch", lambda sid: calls.append(sid))

    try:
        storage.write_json(f"{song_name}/tutorial.json", {
            "tutorial_url": "https://www.youtube.com/watch?v=HAVE",
            "tutorial_links": [], "attempted_at": "2026-06-25T00:00:00+00:00",
            "status": "ready",
        })
        async with factory() as session:
            song = await SongDAO(session).create(
                title="Have It", artist="Artist", song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            await session.commit()
            song_id = song.id
            enqueued = await JobService(session, storage).trigger_tutorial_if_missing(song_id)

        assert enqueued is False
        assert calls == []
    finally:
        async with factory() as session:
            s = await SongDAO(session).get_by_song_name(song_name)
            if s:
                await SongDAO(session).delete_by_id(s.id)
                await session.commit()
        shutil.rmtree(_song_dir(settings, song_name), ignore_errors=True)
        await close_db()


@pytest.mark.asyncio
async def test_trigger_cooldown_on_recent_failure_then_retries_when_stale(settings, storage, monkeypatch):
    factory = init_db(settings)
    set_storage(storage)
    song_name = f"test_tut_cd_{uuid.uuid4().hex[:8]}/song"

    calls: list = []
    monkeypatch.setattr(job_pkg, "_enqueue_tutorial_fetch", lambda sid: calls.append(sid))

    try:
        async with factory() as session:
            song = await SongDAO(session).create(
                title="Cooldown", artist="Artist", song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            await session.commit()
            song_id = song.id

        # Recent failure -> skip.
        storage.write_json(f"{song_name}/tutorial.json", {
            "tutorial_url": "", "tutorial_links": [],
            "attempted_at": "2026-06-25T00:00:00+00:00", "status": "failed",
        })
        async with factory() as session:
            assert await JobService(session, storage).trigger_tutorial_if_missing(song_id) is False
        assert calls == []

        # Stale failure -> retry.
        storage.write_json(f"{song_name}/tutorial.json", {
            "tutorial_url": "", "tutorial_links": [],
            "attempted_at": "2000-01-01T00:00:00+00:00", "status": "failed",
        })
        async with factory() as session:
            assert await JobService(session, storage).trigger_tutorial_if_missing(song_id) is True
        assert calls == [song_id]
    finally:
        async with factory() as session:
            s = await SongDAO(session).get_by_song_name(song_name)
            if s:
                await SongDAO(session).delete_by_id(s.id)
                await session.commit()
        shutil.rmtree(_song_dir(settings, song_name), ignore_errors=True)
        await close_db()


# ── 4. search_youtube_tutorial uses YoutubeService + scoring ───────


@pytest.mark.asyncio
async def test_search_youtube_tutorial_picks_best_scored(monkeypatch):
    """Highest score_tutorial_link wins; result comes from YoutubeService.search."""
    results = [
        YouTubeSearchResult(youtube_id="official", title="Song (Official Music Video)"),
        YouTubeSearchResult(youtube_id="lesson", title="Song guitar tutorial lesson chords"),
        YouTubeSearchResult(youtube_id="live", title="Song (Live at Wembley)"),
    ]

    async def _fake_search(self, query, max_results=5):
        return results

    monkeypatch.setattr(
        "guitar_player.services.youtube_service.YoutubeService.search_tutorials",
        _fake_search,
    )

    best_url, links = await helpers.search_youtube_tutorial("Song", "Artist")

    assert best_url == "https://www.youtube.com/watch?v=lesson"
    assert links[0]["url"] == "https://www.youtube.com/watch?v=lesson"
    assert len(links) == 3
