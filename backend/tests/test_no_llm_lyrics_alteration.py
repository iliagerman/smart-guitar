"""Lyrics must never be altered by an LLM after transcription.

The ver3 "corrected" lyrics (LLM merge of quick wording onto whisper timing)
produced non-monotonic / overlapping segment timestamps that made the lyrics
display jump back and forward during playback. The whole LLM alteration layer
(ver3 merge + preamble cleanup) is removed: whisper output is served verbatim.

These tests pin that contract:
1. The LLM merge/cleanup helpers no longer exist.
2. Song detail never resurrects a leftover lyrics_corrected.json (no
   auto-rediscovery) and never invokes the LLM.
3. Persisting lyrics results does not rewrite lyrics.json.
"""

from __future__ import annotations

import importlib
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

QUICK_LYRICS = {
    "source": "quick",
    "segments": [{"start": 0.0, "end": 2.0, "text": "hello world", "words": []}],
}
REGULAR_LYRICS = {
    "source": "whisper",
    "segments": [{"start": 0.1, "end": 2.1, "text": "hello world", "words": []}],
}
CORRECTED_LYRICS = {
    "source": "llm_quick_words_regular_timing",
    "segments": [{"start": 5.0, "end": 2.0, "text": "corrupted", "words": []}],
}


def _write_json(settings, key: str, data: dict) -> Path:
    base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    path = base / key
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)
    return path


def test_llm_lyrics_alteration_helpers_removed():
    """The ver3 merge and LLM preamble cleanup must not exist anywhere."""
    lyrics_chords = importlib.import_module(
        "guitar_player.services.job_service.lyrics_chords"
    )
    assert not hasattr(lyrics_chords, "ensure_corrected_lyrics")
    assert not hasattr(lyrics_chords, "cleanup_lyrics_preamble")

    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("guitar_player.services.lyrics_correction")

    from guitar_player.services.llm_service import LlmService

    assert not hasattr(LlmService, "align_lyrics_segments")
    assert not hasattr(LlmService, "align_lyrics_segments_sync")
    assert not hasattr(LlmService, "cleanup_lyrics_preamble")


@pytest.mark.asyncio
async def test_song_detail_ignores_leftover_corrected_file(settings, storage):
    """A stale lyrics_corrected.json in storage must NOT be rediscovered:
    the song row stays untouched and the response carries no ver3 lyrics."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_nover3_{uuid.uuid4().hex[:8]}/song"
    created_dirs: list[Path] = []
    try:
        p1 = _write_json(settings, f"{song_name}/lyrics_quick.json", QUICK_LYRICS)
        _write_json(settings, f"{song_name}/lyrics.json", REGULAR_LYRICS)
        _write_json(settings, f"{song_name}/lyrics_corrected.json", CORRECTED_LYRICS)
        created_dirs.append(p1.parent.parent)

        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="No Ver3 Test",
                artist="Test Artist",
                song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
                lyrics_key=f"{song_name}/lyrics.json",
                lyrics_quick_key=f"{song_name}/lyrics_quick.json",
            )
            await song_dao.commit()
            song_id = song.id

        llm_mock = MagicMock()
        async with factory() as session:
            service = SongService(session, storage, MagicMock(), llm_mock, MagicMock())
            detail = await service.get_song_detail(song_id)

        # No LLM involvement on the request path.
        assert llm_mock.method_calls == []
        # The leftover file must not be served under any field.
        assert getattr(detail, "corrected_lyrics", []) == []
        assert getattr(detail, "ver3_lyrics", []) == []
        # Whisper lyrics are served verbatim as ver2.
        assert detail.ver2_lyrics[0].text == "hello world"
        # No auto-rediscovery: the song row must not gain the corrected key.
        async with factory() as session:
            refreshed = await SongDAO(session).get_by_id(song_id)
            assert refreshed.lyrics_corrected_key is None
    finally:
        async with factory() as session:
            song = await SongDAO(session).get_by_song_name(song_name)
            if song:
                await SongDAO(session).delete_by_id(song.id)
                await session.commit()
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)
        await close_db()


@pytest.mark.asyncio
async def test_persist_lyrics_results_serves_whisper_verbatim(settings, storage):
    """Persisting lyrics results must keep lyrics.json byte-identical (no
    preamble cleanup) and must not create lyrics_corrected.json."""
    from guitar_player.services.job_service.lyrics_chords import (
        _persist_lyrics_results,
    )

    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_verbatim_{uuid.uuid4().hex[:8]}/song"
    created_dirs: list[Path] = []
    try:
        p1 = _write_json(settings, f"{song_name}/lyrics_quick.json", QUICK_LYRICS)
        lyrics_path = _write_json(settings, f"{song_name}/lyrics.json", REGULAR_LYRICS)
        created_dirs.append(p1.parent.parent)
        before = lyrics_path.read_bytes()

        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="Verbatim Test",
                artist="Test Artist",
                song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            await song_dao.commit()
            song_id = song.id

        await _persist_lyrics_results(storage, song_id, song_name)

        assert lyrics_path.read_bytes() == before
        assert not storage.file_exists(f"{song_name}/lyrics_corrected.json")
        async with factory() as session:
            refreshed = await SongDAO(session).get_by_id(song_id)
            assert refreshed.lyrics_key == f"{song_name}/lyrics.json"
            assert refreshed.lyrics_quick_key == f"{song_name}/lyrics_quick.json"
            assert refreshed.lyrics_corrected_key is None
    finally:
        async with factory() as session:
            song = await SongDAO(session).get_by_song_name(song_name)
            if song:
                await SongDAO(session).delete_by_id(song.id)
                await session.commit()
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)
        await close_db()
