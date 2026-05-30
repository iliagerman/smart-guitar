"""Tests for ver3 (corrected) lyrics generation.

ver3 = quick-lyrics wording aligned onto regular-lyrics timing, merged by an
LLM. It must be produced in the processing/orchestrator context, NEVER inside
the GET /songs/{id} request path (a synchronous LLM call there caused the
intermittent 10s load timeout).
"""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from guitar_player.app_state import set_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.services.job_service.lyrics_chords import ensure_corrected_lyrics
from guitar_player.services.song_service import SongService

QUICK_LYRICS = {
    "source": "quick",
    "segments": [{"start": 0.0, "end": 2.0, "text": "hello world", "words": []}],
}
REGULAR_LYRICS = {
    "source": "whisper",
    "segments": [{"start": 0.1, "end": 2.1, "text": "hello world", "words": []}],
}


def _write_json(settings, key: str, data: dict) -> Path:
    base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    path = base / key
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)
    return path


@pytest.mark.asyncio
async def test_get_song_detail_does_not_invoke_llm_merge(settings, storage):
    """GET song detail must NOT run the LLM lyrics merge, even when ver1+ver2
    exist and ver3 is missing. The merge belongs in background processing."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_ver3_get_{uuid.uuid4().hex[:8]}/song"
    created_dirs: list[Path] = []
    try:
        p1 = _write_json(settings, f"{song_name}/lyrics_quick.json", QUICK_LYRICS)
        _write_json(settings, f"{song_name}/lyrics.json", REGULAR_LYRICS)
        created_dirs.append(p1.parent.parent)

        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="Ver3 Get Test",
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

        # The request path must not have called the LLM aligner at all.
        llm_mock.align_lyrics_segments_sync.assert_not_called()
        # And it must not have synchronously produced ver3.
        corrected_key = f"{song_name}/lyrics_corrected.json"
        assert not storage.file_exists(corrected_key)
        assert detail.corrected_lyrics == []
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
async def test_ensure_corrected_lyrics_generates_file(settings, storage):
    """ensure_corrected_lyrics merges the two sources and writes ver3."""
    set_storage(storage)
    song_name = f"test_ver3_gen_{uuid.uuid4().hex[:8]}/song"
    corrected_key = f"{song_name}/lyrics_corrected.json"
    created_dirs: list[Path] = []
    try:
        p1 = _write_json(settings, f"{song_name}/lyrics_quick.json", QUICK_LYRICS)
        _write_json(settings, f"{song_name}/lyrics.json", REGULAR_LYRICS)
        created_dirs.append(p1.parent.parent)

        merged = {"source": "llm_quick_words_regular_timing", "segments": [
            {"start": 0.1, "end": 2.1, "text": "hello world", "words": []}
        ]}
        diag = MagicMock(aligned_words=2, total_words=2, mapping_groups=1)

        with patch(
            "guitar_player.services.job_service.lyrics_chords.merge_lyrics_with_llm",
            return_value=(merged, diag),
        ) as merge_mock:
            result = await ensure_corrected_lyrics(storage, song_name)

        assert result is True
        merge_mock.assert_called_once()
        assert storage.file_exists(corrected_key)
        assert storage.read_json(corrected_key)["segments"][0]["text"] == "hello world"
    finally:
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)


@pytest.mark.asyncio
async def test_ensure_corrected_lyrics_skips_when_already_present(settings, storage):
    """If ver3 already exists, no LLM work is done."""
    set_storage(storage)
    song_name = f"test_ver3_skip_{uuid.uuid4().hex[:8]}/song"
    created_dirs: list[Path] = []
    try:
        p1 = _write_json(settings, f"{song_name}/lyrics_quick.json", QUICK_LYRICS)
        _write_json(settings, f"{song_name}/lyrics.json", REGULAR_LYRICS)
        _write_json(settings, f"{song_name}/lyrics_corrected.json", REGULAR_LYRICS)
        created_dirs.append(p1.parent.parent)

        with patch(
            "guitar_player.services.job_service.lyrics_chords.merge_lyrics_with_llm",
        ) as merge_mock:
            result = await ensure_corrected_lyrics(storage, song_name)

        assert result is True
        merge_mock.assert_not_called()
    finally:
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)


@pytest.mark.asyncio
async def test_ensure_corrected_lyrics_skips_when_source_missing(settings, storage):
    """If a source lyrics file is missing, generation is skipped (no LLM call)."""
    set_storage(storage)
    song_name = f"test_ver3_nosrc_{uuid.uuid4().hex[:8]}/song"
    created_dirs: list[Path] = []
    try:
        # Only the regular lyrics exist; quick is missing.
        p1 = _write_json(settings, f"{song_name}/lyrics.json", REGULAR_LYRICS)
        created_dirs.append(p1.parent.parent)

        with patch(
            "guitar_player.services.job_service.lyrics_chords.merge_lyrics_with_llm",
        ) as merge_mock:
            result = await ensure_corrected_lyrics(storage, song_name)

        assert result is False
        merge_mock.assert_not_called()
        assert not storage.file_exists(f"{song_name}/lyrics_corrected.json")
    finally:
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)
