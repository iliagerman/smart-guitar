"""Tests for community chord sheet integration (from external sources).

Covers the SongRecord DTO, song detail assembly with community chords
converted to ChordOption objects, and UG content parsing.
"""

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
from guitar_player.schemas.records import SongRecord
from guitar_player.services.song_service import SongService
from guitar_player.services.ug_chord_fetcher import parse_ug_content


def _make_song_service(session, storage):
    """Create a SongService with stub dependencies."""
    return SongService(session, storage, MagicMock(), MagicMock(), MagicMock())


SAMPLE_STATIC_CHORDS_MULTI = {
    "source": "community",
    "versions": [
        {
            "capo": 0,
            "key": "G",
            "rating": 4.9,
            "lines": [
                {"type": "section", "text": "Intro", "chords": []},
                {
                    "type": "instrumental",
                    "text": "",
                    "chords": [
                        {"chord": "G", "position": 0},
                        {"chord": "D", "position": 6},
                    ],
                },
                {"type": "empty", "text": "", "chords": []},
                {"type": "section", "text": "Verse 1", "chords": []},
                {
                    "type": "lyric",
                    "text": "When I find myself in times of trouble",
                    "chords": [
                        {"chord": "Am", "position": 0},
                        {"chord": "C", "position": 18},
                    ],
                },
                {
                    "type": "lyric",
                    "text": "Mother Mary comes to me",
                    "chords": [{"chord": "G", "position": 0}],
                },
            ],
        },
        {
            "capo": 2,
            "key": "Em",
            "rating": 4.7,
            "lines": [
                {"type": "section", "text": "Verse 1", "chords": []},
                {
                    "type": "lyric",
                    "text": "When I find myself in times of trouble",
                    "chords": [{"chord": "Em", "position": 0}],
                },
            ],
        },
    ],
    "tab_content": "E|---0---|\nB|---1---|",
}


def _write_static_chords_to_storage(settings, key: str, data: dict) -> Path:
    """Write a static_chords.json file directly to the local storage path."""
    base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    path = base / key
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)
    return path


class TestSongRecordHasStaticChordsFields:
    """SongRecord must mirror the Song model's static_chords columns."""

    def test_song_record_has_static_chords_key(self):
        """SongRecord must have static_chords_key field."""
        record = SongRecord(
            id=uuid.uuid4(),
            created_at="2026-01-01T00:00:00",
            updated_at="2026-01-01T00:00:00",
            title="Test",
            song_name="test",
            static_chords_key="test/static_chords.json",
        )
        assert record.static_chords_key == "test/static_chords.json"

    def test_song_record_has_static_chords_failed(self):
        """SongRecord must have static_chords_failed field."""
        record = SongRecord(
            id=uuid.uuid4(),
            created_at="2026-01-01T00:00:00",
            updated_at="2026-01-01T00:00:00",
            title="Test",
            song_name="test",
            static_chords_failed=True,
        )
        assert record.static_chords_failed is True

    def test_song_record_has_static_chords_attempted_at(self):
        """SongRecord must have static_chords_attempted_at field."""
        record = SongRecord(
            id=uuid.uuid4(),
            created_at="2026-01-01T00:00:00",
            updated_at="2026-01-01T00:00:00",
            title="Test",
            song_name="test",
            static_chords_attempted_at="2026-01-01T12:00:00",
        )
        assert record.static_chords_attempted_at is not None

    def test_song_record_defaults_are_safe(self):
        """New static_chords fields default to None/False so existing songs work."""
        record = SongRecord(
            id=uuid.uuid4(),
            created_at="2026-01-01T00:00:00",
            updated_at="2026-01-01T00:00:00",
            title="Test",
            song_name="test",
        )
        assert record.static_chords_key is None
        assert record.static_chords_failed is False
        assert record.static_chords_attempted_at is None


@pytest.mark.asyncio
async def test_song_detail_converts_community_chords_to_options(settings, storage):
    """Community chord versions appear as ChordOption objects in the detail response."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_community_{uuid.uuid4().hex[:8]}/test_song"
    static_key = f"{song_name}/static_chords.json"
    created_dirs: list[Path] = []

    try:
        chords_path = _write_static_chords_to_storage(settings, static_key, SAMPLE_STATIC_CHORDS_MULTI)
        created_dirs.append(chords_path.parent.parent)

        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="Test Song With Community Chords",
                artist="Test Artist",
                song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
                duration_seconds=240,
                static_chords_key=static_key,
            )
            await song_dao.commit()
            song_id = song.id

        async with factory() as session:
            song_service = _make_song_service(session, storage)
            detail = await song_service.get_song_detail(song_id)

        # Should have community versions as ChordOption objects
        community_opts = [
            o for o in detail.chord_options
            if o.description.startswith("Community chord sheet")
        ]
        assert len(community_opts) == 2

        # First version: Sheet 1
        sheet1 = community_opts[0]
        assert sheet1.name == "Sheet 1"
        assert sheet1.capo == 0
        assert len(sheet1.chords) > 0
        assert sheet1.chords[0].chord == "G"  # First chord from instrumental line
        assert sheet1.lyrics is not None
        assert len(sheet1.lyrics) > 0
        assert sheet1.lyrics[0].text == "When I find myself in times of trouble"

        # Second version: Sheet 2
        sheet2 = community_opts[1]
        assert sheet2.name == "Sheet 2"
        assert sheet2.capo == 2

        # Primary chords should be from community source
        assert detail.chord_source == "community"
        assert len(detail.chords) > 0

    finally:
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.get_by_song_name(song_name)
            if song:
                await song_dao.delete_by_id(song.id)
                await session.commit()
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)
        await close_db()


@pytest.mark.asyncio
async def test_song_detail_empty_when_no_community_chords(settings, storage):
    """Song without static_chords_key has no community chord options."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_no_community_{uuid.uuid4().hex[:8]}/test_song"

    try:
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="Test Song Without Community Chords",
                artist="Test Artist",
                song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
            )
            await session.commit()
            song_id = song.id

        async with factory() as session:
            song_service = _make_song_service(session, storage)
            detail = await song_service.get_song_detail(song_id)

        community_opts = [
            o for o in detail.chord_options
            if o.description.startswith("Community chord sheet")
        ]
        assert len(community_opts) == 0

    finally:
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.get_by_song_name(song_name)
            if song:
                await song_dao.delete_by_id(song.id)
                await session.commit()
        await close_db()


@pytest.mark.asyncio
async def test_community_chords_have_timing(settings, storage):
    """Community chords converted to ChordEntry should have estimated timing."""
    factory = init_db(settings)
    set_storage(storage)

    song_name = f"test_timing_{uuid.uuid4().hex[:8]}/test_song"
    static_key = f"{song_name}/static_chords.json"
    created_dirs: list[Path] = []

    try:
        chords_path = _write_static_chords_to_storage(settings, static_key, SAMPLE_STATIC_CHORDS_MULTI)
        created_dirs.append(chords_path.parent.parent)

        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="Test Timing",
                artist="Test Artist",
                song_name=song_name,
                audio_key=f"{song_name}/audio.mp3",
                duration_seconds=180,
                static_chords_key=static_key,
            )
            await song_dao.commit()
            song_id = song.id

        async with factory() as session:
            song_service = _make_song_service(session, storage)
            detail = await song_service.get_song_detail(song_id)

        community_opts = [
            o for o in detail.chord_options
            if o.description.startswith("Community chord sheet")
        ]
        assert len(community_opts) >= 1

        # Check that chords have proper timing
        chords = community_opts[0].chords
        assert len(chords) > 0
        for chord in chords:
            assert chord.start_time >= 0
            assert chord.end_time > chord.start_time
            assert chord.chord != ""

        # Check that lyrics have timing
        lyrics = community_opts[0].lyrics
        assert lyrics is not None
        assert len(lyrics) > 0
        for segment in lyrics:
            assert segment.start >= 0
            assert segment.end > segment.start
            assert len(segment.words) > 0

    finally:
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.get_by_song_name(song_name)
            if song:
                await song_dao.delete_by_id(song.id)
                await session.commit()
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)
        await close_db()


class TestUGContentParser:
    """Tests for parse_ug_content — the Ultimate Guitar chord sheet parser."""

    def test_section_header(self):
        """[Verse 1] is parsed as a section line."""
        lines = parse_ug_content("[Verse 1]")
        assert len(lines) == 1
        assert lines[0].type == "section"
        assert lines[0].text == "Verse 1"

    def test_inline_chords(self):
        """Inline [ch]...[/ch] tags are parsed with correct positions."""
        content = "[ch]Am[/ch]When I [ch]C[/ch]find myself"
        lines = parse_ug_content(content)
        assert len(lines) == 1
        assert lines[0].type == "lyric"
        assert lines[0].text == "AmWhen I Cfind myself"
        assert len(lines[0].chords) == 2
        assert lines[0].chords[0].chord == "Am"
        assert lines[0].chords[0].position == 0
        assert lines[0].chords[1].chord == "C"

    def test_chord_only_line_followed_by_lyrics(self):
        """Two-line format: chord-only line + lyrics line."""
        content = "[ch]Am[/ch]       [ch]C[/ch]\nWhen I find myself"
        lines = parse_ug_content(content)
        assert len(lines) == 1
        assert lines[0].type == "lyric"
        assert lines[0].text == "When I find myself"
        assert len(lines[0].chords) == 2
        assert lines[0].chords[0].chord == "Am"
        assert lines[0].chords[1].chord == "C"

    def test_standalone_chord_line(self):
        """Chord-only line without a following lyrics line is instrumental."""
        content = "[ch]G[/ch]   [ch]D[/ch]   [ch]Em[/ch]"
        lines = parse_ug_content(content)
        assert len(lines) == 1
        assert lines[0].type == "instrumental"
        assert len(lines[0].chords) == 3

    def test_empty_lines(self):
        """Empty lines produce empty type."""
        content = "line 1\n\nline 2"
        lines = parse_ug_content(content)
        assert any(line.type == "empty" for line in lines)

    def test_tab_wrapper_stripped(self):
        """[tab] and [/tab] wrapper tags are removed."""
        content = "[tab][ch]Am[/ch]Hello[/tab]"
        lines = parse_ug_content(content)
        assert len(lines) == 1
        assert "[tab]" not in lines[0].text

    def test_full_song_structure(self):
        """A realistic chord sheet parses into the expected structure."""
        content = (
            "[Intro]\n"
            "[ch]G[/ch]   [ch]D[/ch]\n"
            "\n"
            "[Verse 1]\n"
            "[ch]Am[/ch]       [ch]C[/ch]\n"
            "When I find myself in times of trouble\n"
            "[ch]G[/ch]\n"
            "Mother Mary comes to me\n"
        )
        lines = parse_ug_content(content)
        types = [line.type for line in lines]
        assert "section" in types
        assert "lyric" in types
        assert "empty" in types

        lyric_lines = [line for line in lines if line.type == "lyric"]
        assert len(lyric_lines) >= 1
        assert lyric_lines[0].chords[0].chord in ("Am", "G")
