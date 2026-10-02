"""Song practice tags: difficulty, easy chord vocabulary, capo and tempo from chord files."""

from unittest.mock import MagicMock

import pytest

from guitar_player.auth.admin import require_admin_token
from guitar_player.database import close_db, init_db
from guitar_player.enums import SongDifficulty
from guitar_player.services.song_service import SongService
from guitar_player.services.song_tags import (
    chord_vocabulary,
    compute_song_tags,
    difficulty_for,
    readable_chord,
)
from tests.api_harness import create_member


def _detected(*chords: tuple[str, float]) -> list[dict]:
    """chords.json entries back to back, each (label, seconds)."""
    entries, t = [], 0.0
    for label, seconds in chords:
        entries.append({"start_time": t, "end_time": t + seconds, "chord": label, "bass": None})
        t += seconds
    return entries


def _variant(capo: int, *chords: tuple[str, float]) -> dict:
    return {
        "name": f"beginner_capo_{capo}" if capo else "beginner",
        "capo": capo,
        "chords": [{k: v for k, v in c.items() if k != "bass"} for c in _detected(*chords)],
    }


# ── Pure rules ────────────────────────────────────────────────────


def test_detected_labels_read_as_chord_names():
    assert readable_chord("A:maj") == "A"
    assert readable_chord("Gb:min") == "Gbm"
    assert readable_chord("E:7") == "E7"
    assert readable_chord("B:min7") == "Bm7"
    assert readable_chord("D:sus4") == "D"
    assert readable_chord("Em") == "Em"


def test_vocabulary_drops_no_chord_and_detector_blips_in_first_appearance_order():
    chords = [("N", 50.0), ("G", 30.0), ("C", 30.0), ("F#m", 1.0), ("D", 30.0), ("G", 10.0)]
    # F#m fills 1 of 101 chord seconds (< 3%).
    assert chord_vocabulary(chords) == ["G", "C", "D"]


@pytest.mark.parametrize(
    ("chords", "expected"),
    [
        (["G", "C", "D", "Em"], SongDifficulty.EASY),
        (["G", "C", "D", "Em", "Am"], SongDifficulty.EASY),
        (["G", "C", "D", "F"], SongDifficulty.MEDIUM),  # F is a barre shape
        (["A", "E", "Gbm"], SongDifficulty.MEDIUM),  # Gbm == F#m
        (["Bm", "G", "D"], SongDifficulty.MEDIUM),  # Bm is a barre shape
        (["Bm7", "G", "D", "Fmaj7", "B7"], SongDifficulty.EASY),  # open shapes at the same pitch
        (["G", "C", "D", "Em", "Am", "E"], SongDifficulty.MEDIUM),
        (["C", "G", "Am", "F", "Dm", "Em", "E"], SongDifficulty.MEDIUM),
        (["C", "G", "Am", "F", "Dm", "Em", "E", "A"], SongDifficulty.HARD),
    ],
)
def test_difficulty_counts_chords_and_barre_shapes(chords, expected):
    assert difficulty_for(chords) == expected


# ── From stored chord files ───────────────────────────────────────


async def test_easiest_beginner_variant_wins_with_ties_going_to_the_lower_capo(song_factory, storage):
    song = await song_factory.create(
        files={
            "chords.json": _detected(("F:maj", 10), ("Bb:maj", 10), ("C:maj", 10)),
            "chords_beginner.json": _variant(0, ("G", 10), ("C", 10), ("D", 10), ("Em", 10), ("Am", 10)),
            "chords_beginner_capo_4.json": _variant(4, ("A", 10), ("D", 10), ("E", 10), ("Bm", 10)),
            "chords_beginner_capo_2.json": _variant(2, ("Em", 10), ("G", 10), ("D", 10), ("C", 10)),
            "chord_meta.json": {"bpm": 96.5, "capo": 2},
        },
    )
    tags = compute_song_tags(storage, song)

    assert tags.easy_capo == 2
    assert tags.easy_chords == ["Em", "G", "D", "C"]
    assert tags.difficulty == SongDifficulty.EASY
    assert tags.tempo_bpm == 96.5


async def test_songs_without_beginner_variants_use_detected_chords_at_capo_zero(song_factory, storage):
    song = await song_factory.create(
        files={"chords.json": _detected(
            ("N", 5), ("A:maj", 20), ("E:maj", 20), ("Gb:min", 20), ("C:maj", 1), ("D:maj", 20),
        )},
    )
    tags = compute_song_tags(storage, song)

    assert tags.easy_chords == ["A", "E", "Gbm", "D"]
    assert tags.easy_capo == 0
    assert tags.difficulty == SongDifficulty.MEDIUM
    assert tags.tempo_bpm is None


async def test_songs_without_chord_files_get_no_tags(song_factory, storage):
    song = await song_factory.create()
    assert compute_song_tags(storage, song) is None


async def test_song_detail_tags_an_untagged_song_once_chords_exist(
    song_factory, settings, storage,
):
    song = await song_factory.create(files={
        "chords.json": _detected(("G:maj", 10), ("C:maj", 10), ("D:maj", 10)),
        "chord_meta.json": {"bpm": 120.0},
    })
    assert song.tags_computed_at is None

    factory = init_db(settings)
    try:
        async with factory() as session:
            service = SongService(session, storage, MagicMock(), MagicMock(), MagicMock())
            detail = await service.get_song_detail(song.id)
            await session.commit()
    finally:
        await close_db()

    assert detail.song.difficulty == "easy"
    assert detail.song.easy_chords == ["G", "C", "D"]
    assert detail.song.chord_count == 3
    assert detail.song.easy_capo == 0
    assert detail.song.tempo_bpm == 120.0
    stored = await song_factory.get(song.id)
    assert stored.tags_computed_at is not None
    assert stored.easy_chords == "G,C,D"


# ── Admin retag backfill ──────────────────────────────────────────


async def test_admin_retag_tags_songs_in_windows_and_skips_tagged_ones(
    api, song_factory, session_factory,
):
    api.app.dependency_overrides[require_admin_token] = lambda: None
    tagged_song = await song_factory.create(
        files={"chords_beginner.json": _variant(0, ("G", 10), ("C", 10), ("D", 10), ("F", 10))},
    )
    chordless = await song_factory.create()

    resp = await api.client.post("/api/v1/admin/songs/retag", params={"offset": 0, "limit": 500})
    assert resp.status_code == 200
    first = resp.json()
    assert set(first) == {"processed", "tagged", "skipped", "failed", "next_offset", "total"}
    assert first["processed"] == min(first["total"], 500)
    assert first["tagged"] >= 1
    assert first["next_offset"] is None

    song = await song_factory.get(tagged_song.id)
    assert song.difficulty == "medium"
    assert song.easy_chords == "G,C,D,F"
    assert song.chord_count == 4
    assert song.easy_capo == 0
    tagged_at = song.tags_computed_at
    assert (await song_factory.get(chordless.id)).tags_computed_at is None

    # Already-tagged songs are skipped unless forced.
    resp = await api.client.post("/api/v1/admin/songs/retag", params={"offset": 0, "limit": 500})
    assert resp.json()["skipped"] >= 2
    assert (await song_factory.get(tagged_song.id)).tags_computed_at == tagged_at

    resp = await api.client.post(
        "/api/v1/admin/songs/retag", params={"offset": 0, "limit": 500, "force": "true"},
    )
    assert resp.json()["tagged"] >= 1
    assert (await song_factory.get(tagged_song.id)).tags_computed_at > tagged_at

    # One song per window: the next window starts where this one ended.
    resp = await api.client.post("/api/v1/admin/songs/retag", params={"offset": 0, "limit": 1})
    window = resp.json()
    assert window["processed"] == 1
    assert window["next_offset"] == 1


async def test_admin_retag_requires_the_admin_token(api, session_factory):
    api.sign_in(await create_member(session_factory, pro=True))
    resp = await api.client.post("/api/v1/admin/songs/retag")
    assert resp.status_code in (401, 403, 503)
