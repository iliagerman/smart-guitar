"""Integration tests: song recommendation engine.

Tests the RecommendationService scoring algorithm with real DB songs
and storage-backed chord metadata.

Requires:
- Database (configured via APP_ENV=test)

Does NOT require:
- Network access
- AWS credentials
"""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

import pytest

from guitar_player.app_state import set_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.services.recommendation_service import RecommendationService


def _write_json_to_storage(settings, key: str, data: dict | list) -> Path:
    """Write a JSON file directly to the local storage path."""
    base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    path = base / key
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)
    return path


async def _create_song(
    song_dao: SongDAO,
    *,
    title: str,
    artist: str | None = None,
    genre: str | None = None,
    like_count: int = 0,
    duration_seconds: int | None = None,
    thumbnail_key: str | None = None,
) -> uuid.UUID:
    """Create a test song with an audio_key (playable) and return its id."""
    slug = uuid.uuid4().hex[:8]
    song_name = f"test_rec_{slug}/test_song"
    song = await song_dao.create(
        title=title,
        artist=artist,
        genre=genre,
        song_name=song_name,
        audio_key=f"{song_name}/audio.mp3",
        like_count=like_count,
        duration_seconds=duration_seconds,
        thumbnail_key=thumbnail_key,
    )
    return song.id


# ── Same genre + same artist ranked highest ─────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_same_genre_and_artist_ranked_first(settings, storage):
    """A song matching both genre and artist should rank above one matching only genre."""
    factory = init_db(settings)
    set_storage(storage)

    song_ids: list[uuid.UUID] = []
    try:
        async with factory() as session:
            dao = SongDAO(session)

            seed_id = await _create_song(dao, title="Seed Song", artist="Oasis", genre="rock")
            same_both = await _create_song(dao, title="Same Both", artist="Oasis", genre="rock")
            same_genre = await _create_song(dao, title="Same Genre", artist="Nirvana", genre="rock")
            diff_all = await _create_song(dao, title="Diff All", artist="Adele", genre="pop")
            song_ids = [seed_id, same_both, same_genre, diff_all]
            await dao.commit()

        async with factory() as session:
            svc = RecommendationService(SongDAO(session), storage)
            result = await svc.get_recommendations(seed_id, limit=10)

        assert len(result.items) >= 2
        assert result.seed_song_id == seed_id

        ids = [s.id for s in result.items]
        assert seed_id not in ids, "Seed song must not appear in recommendations"
        assert same_both in ids
        assert same_genre in ids

        # same_both (genre+artist match) should rank above same_genre (genre only)
        assert ids.index(same_both) < ids.index(same_genre)

    finally:
        async with factory() as session:
            dao = SongDAO(session)
            for sid in song_ids:
                await dao.delete_by_id(sid)
            await session.commit()
        await close_db()


# ── Seed song excluded ──────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_seed_song_excluded_from_results(settings, storage):
    """The seed song itself must never appear in the recommendations."""
    factory = init_db(settings)
    set_storage(storage)

    song_ids: list[uuid.UUID] = []
    try:
        async with factory() as session:
            dao = SongDAO(session)
            seed_id = await _create_song(dao, title="Seed", artist="Artist", genre="rock")
            other_id = await _create_song(dao, title="Other", artist="Artist", genre="rock")
            song_ids = [seed_id, other_id]
            await dao.commit()

        async with factory() as session:
            svc = RecommendationService(SongDAO(session), storage)
            result = await svc.get_recommendations(seed_id, limit=10)

        result_ids = [s.id for s in result.items]
        assert seed_id not in result_ids

    finally:
        async with factory() as session:
            dao = SongDAO(session)
            for sid in song_ids:
                await dao.delete_by_id(sid)
            await session.commit()
        await close_db()


# ── Limit parameter respected ───────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_limit_parameter_respected(settings, storage):
    """Requesting limit=2 should return at most 2 recommendations."""
    factory = init_db(settings)
    set_storage(storage)

    song_ids: list[uuid.UUID] = []
    try:
        async with factory() as session:
            dao = SongDAO(session)
            seed_id = await _create_song(dao, title="Seed", artist="X", genre="rock")
            for i in range(5):
                sid = await _create_song(dao, title=f"Song {i}", artist="X", genre="rock")
                song_ids.append(sid)
            song_ids.insert(0, seed_id)
            await dao.commit()

        async with factory() as session:
            svc = RecommendationService(SongDAO(session), storage)
            result = await svc.get_recommendations(seed_id, limit=2)

        assert len(result.items) <= 2

    finally:
        async with factory() as session:
            dao = SongDAO(session)
            for sid in song_ids:
                await dao.delete_by_id(sid)
            await session.commit()
        await close_db()


# ── Empty library returns empty list ────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_no_candidates_returns_empty(settings, storage):
    """When no other songs exist, recommendations should be an empty list."""
    factory = init_db(settings)
    set_storage(storage)

    song_ids: list[uuid.UUID] = []
    try:
        async with factory() as session:
            dao = SongDAO(session)
            seed_id = await _create_song(
                dao, title="Lonely Song", artist="Nobody", genre="other",
            )
            song_ids = [seed_id]
            await dao.commit()

        async with factory() as session:
            svc = RecommendationService(SongDAO(session), storage)
            result = await svc.get_recommendations(seed_id, limit=10)

        assert result.items == []
        assert result.seed_song_id == seed_id

    finally:
        async with factory() as session:
            dao = SongDAO(session)
            for sid in song_ids:
                await dao.delete_by_id(sid)
            await session.commit()
        await close_db()


# ── Popularity boost ────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_popularity_used_as_tiebreaker(settings, storage):
    """Among equally-matching songs, higher like_count should rank higher."""
    factory = init_db(settings)
    set_storage(storage)

    song_ids: list[uuid.UUID] = []
    try:
        async with factory() as session:
            dao = SongDAO(session)
            seed_id = await _create_song(dao, title="Seed", artist="Band", genre="rock")
            popular = await _create_song(
                dao, title="Popular", artist="Other", genre="rock", like_count=100,
            )
            unpopular = await _create_song(
                dao, title="Unpopular", artist="Other", genre="rock", like_count=0,
            )
            song_ids = [seed_id, popular, unpopular]
            await dao.commit()

        async with factory() as session:
            svc = RecommendationService(SongDAO(session), storage)
            result = await svc.get_recommendations(seed_id, limit=10)

        ids = [s.id for s in result.items]
        assert popular in ids
        assert unpopular in ids
        assert ids.index(popular) < ids.index(unpopular)

    finally:
        async with factory() as session:
            dao = SongDAO(session)
            for sid in song_ids:
                await dao.delete_by_id(sid)
            await session.commit()
        await close_db()


# ── Chord overlap boosts ranking ────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_chord_overlap_boosts_ranking(settings, storage):
    """Songs sharing more chords with the seed should rank higher."""
    factory = init_db(settings)
    set_storage(storage)

    song_ids: list[uuid.UUID] = []
    created_dirs: list[Path] = []

    # Seed chords: G, C, D, Em
    seed_chords = [
        {"start_time": 0, "end_time": 2, "chord": "G"},
        {"start_time": 2, "end_time": 4, "chord": "C"},
        {"start_time": 4, "end_time": 6, "chord": "D"},
        {"start_time": 6, "end_time": 8, "chord": "Em"},
    ]
    # High overlap: G, C, D (3/4 match with seed)
    high_overlap = [
        {"start_time": 0, "end_time": 2, "chord": "G"},
        {"start_time": 2, "end_time": 4, "chord": "C"},
        {"start_time": 4, "end_time": 6, "chord": "D"},
    ]
    # Low overlap: Am, F (0/4 match with seed)
    low_overlap = [
        {"start_time": 0, "end_time": 2, "chord": "Am"},
        {"start_time": 2, "end_time": 4, "chord": "F"},
    ]

    try:
        async with factory() as session:
            dao = SongDAO(session)

            seed_id = await _create_song(dao, title="Seed Chord", artist="A", genre="rock")
            high_id = await _create_song(dao, title="High Overlap", artist="B", genre="rock")
            low_id = await _create_song(dao, title="Low Overlap", artist="C", genre="rock")
            song_ids = [seed_id, high_id, low_id]
            await dao.commit()

            # Look up song_names to write chord files
            seed_rec = await dao.get_by_id(seed_id)
            high_rec = await dao.get_by_id(high_id)
            low_rec = await dao.get_by_id(low_id)

        # Write chord files to storage
        for rec, chords in [
            (seed_rec, seed_chords),
            (high_rec, high_overlap),
            (low_rec, low_overlap),
        ]:
            path = _write_json_to_storage(
                settings, f"{rec.song_name}/chords_web.json", chords,
            )
            created_dirs.append(path.parent.parent)

        # Update songs to have web_chords_key
        async with factory() as session:
            dao = SongDAO(session)
            for rec in [seed_rec, high_rec, low_rec]:
                await dao.update_by_id(
                    rec.id, web_chords_key=f"{rec.song_name}/chords_web.json",
                )
            await dao.commit()

        async with factory() as session:
            svc = RecommendationService(SongDAO(session), storage)
            result = await svc.get_recommendations(seed_id, limit=10)

        ids = [s.id for s in result.items]
        assert high_id in ids
        assert low_id in ids
        assert ids.index(high_id) < ids.index(low_id)

    finally:
        async with factory() as session:
            dao = SongDAO(session)
            for sid in song_ids:
                await dao.delete_by_id(sid)
            await session.commit()
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)
        await close_db()


# ── Key compatibility scoring ───────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_key_compatibility_boosts_ranking(settings, storage):
    """Songs in the same or nearby key should rank higher than distant keys."""
    factory = init_db(settings)
    set_storage(storage)

    song_ids: list[uuid.UUID] = []
    created_dirs: list[Path] = []

    try:
        async with factory() as session:
            dao = SongDAO(session)
            seed_id = await _create_song(dao, title="Seed Key", artist="A", genre="rock")
            same_key = await _create_song(dao, title="Same Key", artist="B", genre="rock")
            far_key = await _create_song(dao, title="Far Key", artist="C", genre="rock")
            song_ids = [seed_id, same_key, far_key]
            await dao.commit()

            seed_rec = await dao.get_by_id(seed_id)
            same_rec = await dao.get_by_id(same_key)
            far_rec = await dao.get_by_id(far_key)

        # Seed: key=G, Same: key=G, Far: key=F# (opposite on circle of fifths)
        for rec, key in [(seed_rec, "G"), (same_rec, "G"), (far_rec, "F#")]:
            path = _write_json_to_storage(
                settings, f"{rec.song_name}/chord_meta.json", {"key": key},
            )
            created_dirs.append(path.parent.parent)

        async with factory() as session:
            svc = RecommendationService(SongDAO(session), storage)
            result = await svc.get_recommendations(seed_id, limit=10)

        ids = [s.id for s in result.items]
        assert same_key in ids
        assert far_key in ids
        assert ids.index(same_key) < ids.index(far_key)

    finally:
        async with factory() as session:
            dao = SongDAO(session)
            for sid in song_ids:
                await dao.delete_by_id(sid)
            await session.commit()
        for d in created_dirs:
            shutil.rmtree(d, ignore_errors=True)
        await close_db()


# ── Thumbnail URL enrichment ────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_recommendations_include_thumbnail_url(settings, storage):
    """Recommended songs with a thumbnail_key should have thumbnail_url resolved."""
    factory = init_db(settings)
    set_storage(storage)

    song_ids: list[uuid.UUID] = []
    try:
        async with factory() as session:
            dao = SongDAO(session)
            seed_id = await _create_song(
                dao, title="Seed", artist="Artist", genre="rock",
            )
            with_thumb = await _create_song(
                dao,
                title="With Thumb",
                artist="Artist",
                genre="rock",
                thumbnail_key="test_rec_thumb/thumb.jpg",
            )
            without_thumb = await _create_song(
                dao, title="Without Thumb", artist="Artist", genre="rock",
            )
            song_ids = [seed_id, with_thumb, without_thumb]
            await dao.commit()

        async with factory() as session:
            svc = RecommendationService(SongDAO(session), storage)
            result = await svc.get_recommendations(seed_id, limit=10)

        by_id = {s.id: s for s in result.items}
        assert with_thumb in by_id
        assert by_id[with_thumb].thumbnail_url is not None
        assert "thumb.jpg" in by_id[with_thumb].thumbnail_url

        assert without_thumb in by_id
        assert by_id[without_thumb].thumbnail_url is None

    finally:
        async with factory() as session:
            dao = SongDAO(session)
            for sid in song_ids:
                await dao.delete_by_id(sid)
            await session.commit()
        await close_db()


# ── Language matching ───────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_english_seed_excludes_non_english_songs(settings, storage):
    """An English seed song should not recommend songs with non-ASCII titles."""
    factory = init_db(settings)
    set_storage(storage)

    song_ids: list[uuid.UUID] = []
    try:
        async with factory() as session:
            dao = SongDAO(session)
            seed_id = await _create_song(
                dao, title="Wonderwall", artist="Oasis", genre="rock",
            )
            english_id = await _create_song(
                dao, title="Don't Look Back In Anger", artist="Oasis", genre="rock",
            )
            hebrew_id = await _create_song(
                dao, title="\u05e9\u05d9\u05e8 \u05e2\u05d1\u05e8\u05d9", artist="Other", genre="rock",
            )
            korean_id = await _create_song(
                dao, title="\ub2e4\uc2dc \ub9cc\ub09c \uc138\uacc4", artist="Other", genre="rock",
            )
            song_ids = [seed_id, english_id, hebrew_id, korean_id]
            await dao.commit()

        async with factory() as session:
            svc = RecommendationService(SongDAO(session), storage)
            result = await svc.get_recommendations(seed_id, limit=10)

        ids = [s.id for s in result.items]
        assert english_id in ids
        assert hebrew_id not in ids, "Non-English song should be excluded"
        assert korean_id not in ids, "Non-English song should be excluded"

    finally:
        async with factory() as session:
            dao = SongDAO(session)
            for sid in song_ids:
                await dao.delete_by_id(sid)
            await session.commit()
        await close_db()


@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_non_english_seed_does_not_exclude_non_english(settings, storage):
    """A non-English seed song should still recommend other non-English songs."""
    factory = init_db(settings)
    set_storage(storage)

    song_ids: list[uuid.UUID] = []
    try:
        async with factory() as session:
            dao = SongDAO(session)
            seed_id = await _create_song(
                dao, title="\u05e9\u05d9\u05e8 \u05e2\u05d1\u05e8\u05d9", artist="Israeli", genre="pop",
            )
            other_hebrew = await _create_song(
                dao, title="\u05e9\u05d9\u05e8 \u05d0\u05d7\u05e8", artist="Israeli", genre="pop",
            )
            english_id = await _create_song(
                dao, title="Hello", artist="Adele", genre="pop",
            )
            song_ids = [seed_id, other_hebrew, english_id]
            await dao.commit()

        async with factory() as session:
            svc = RecommendationService(SongDAO(session), storage)
            result = await svc.get_recommendations(seed_id, limit=10)

        ids = [s.id for s in result.items]
        assert other_hebrew in ids
        assert english_id in ids  # non-English seed doesn't exclude English songs

    finally:
        async with factory() as session:
            dao = SongDAO(session)
            for sid in song_ids:
                await dao.delete_by_id(sid)
            await session.commit()
        await close_db()
