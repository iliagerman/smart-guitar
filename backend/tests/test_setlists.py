"""Curated setlists: registry filters over playable songs, level-fit ordering, pagination."""

import uuid

import pytest

from guitar_player.services.popular_songs import ISRAELI_HITS, WORLD_HITS
from guitar_player.services.setlist_service import SETLISTS
from tests.api_harness import create_member

SETLISTS_URL = "/api/v1/songs/setlists"


def _playable(**fields: object) -> dict[str, object]:
    """Columns of a fully playable song (chords + guitar stem present)."""
    return {"chords_key": "x/chords.json", "guitar_key": "x/guitar.mp3", **fields}


@pytest.fixture
async def library(api, song_factory, session_factory):
    """A small tagged library, signed in as a free-tier member."""
    api.sign_in(await create_member(session_factory, pro=False))
    songs = {
        "campfire_hit": await song_factory.create(**_playable(
            title="Campfire Hit", difficulty="easy", chord_count=3, genre="folk",
            tempo_bpm=80.0, play_count=100_000, thumbnail_key="covers/campfire_hit.jpg",
        )),
        "campfire_b": await song_factory.create(**_playable(
            title="Campfire B", difficulty="easy", chord_count=4, genre="pop",
            tempo_bpm=90.0, play_count=90_000,
        )),
        "easy_rock": await song_factory.create(**_playable(
            title="Easy Rock", difficulty="easy", chord_count=5, genre="rock", tempo_bpm=120.0,
        )),
        "not_ready": await song_factory.create(
            title="Not Ready", difficulty="easy", chord_count=3, genre="folk",
            tempo_bpm=80.0, play_count=200_000, chords_key="x/chords.json",
        ),
        "hard_metal": await song_factory.create(**_playable(
            title="Hard Metal", difficulty="hard", chord_count=9, genre="metal", tempo_bpm=140.0,
        )),
        "hebrew": await song_factory.create(**_playable(
            title="שיר לשלום", artist=None, difficulty="medium", chord_count=6,
            genre="pop", tempo_bpm=100.0,
        )),
        "hebrew_artist": await song_factory.create(**_playable(
            title="Yesterday Once More", artist="אריק איינשטיין", difficulty="medium",
            chord_count=6, genre="folk", tempo_bpm=70.0,
        )),
    }
    return songs


async def _setlist_ids(api, setlist_id: str) -> list[str]:
    resp = await api.client.get(f"{SETLISTS_URL}/{setlist_id}", params={"limit": 100})
    assert resp.status_code == 200
    return [item["id"] for item in resp.json()["items"]]


def _positions(ids: list[str], *songs) -> list[int]:
    return [ids.index(str(song.id)) for song in songs]


async def test_setlist_index_lists_non_empty_setlists_best_fit_first(api, library):
    resp = await api.client.get(SETLISTS_URL, params={"level": "beginner"})
    assert resp.status_code == 200
    items = resp.json()["items"]

    assert {"campfire", "first-songs", "slow-pretty", "israeli", "challenge"} <= {i["id"] for i in items}
    assert all(item["song_count"] > 0 for item in items)
    levels = [item["level"] for item in items]
    assert levels == sorted(levels, key=["easy", "medium", "hard"].index)

    campfire = next(item for item in items if item["id"] == "campfire")
    assert campfire == {
        "id": "campfire",
        "title": "4-Chord Campfire",
        "description": SETLISTS["campfire"].description,
        "level": "easy",
        "suggested_mode": "play_along",
        "kind": "setlist",
        "song_count": campfire["song_count"],
        "cover_urls": campfire["cover_urls"],
    }
    assert len(campfire["cover_urls"]) <= 3
    assert any(url.endswith("covers/campfire_hit.jpg") for url in campfire["cover_urls"])

    band_room = next(item for item in items if item["id"] == "band-room")
    assert band_room["title"] == "Band Room Rock"
    jam = next(item for item in items if item["id"] == "jam-drummer")
    assert jam["suggested_mode"] == "drums_bass"


async def test_advanced_players_see_the_hardest_setlists_first(api, library):
    resp = await api.client.get(SETLISTS_URL, params={"level": "advanced"})
    levels = [item["level"] for item in resp.json()["items"]]
    assert levels[0] == "hard"
    assert levels == sorted(levels, key=["hard", "medium", "easy"].index)

    resp = await api.client.get(SETLISTS_URL, params={"level": "intermediate"})
    assert resp.json()["items"][0]["level"] == "medium"


async def test_unknown_skill_level_is_rejected(api, library):
    resp = await api.client.get(SETLISTS_URL, params={"level": "expert"})
    assert resp.status_code == 422


async def test_campfire_is_easy_four_chord_songs_by_popularity(api, library):
    ids = await _setlist_ids(api, "campfire")
    first, second = _positions(ids, library["campfire_hit"], library["campfire_b"])
    assert first < second
    assert str(library["easy_rock"].id) not in ids  # five chords
    assert str(library["not_ready"].id) not in ids  # no guitar stem yet


async def test_first_songs_orders_by_fewest_chords_then_slowest_and_caps_at_ten(api, library):
    resp = await api.client.get(f"{SETLISTS_URL}/first-songs")
    body = resp.json()
    assert body["total"] <= 10
    ids = [item["id"] for item in body["items"]]
    positions = _positions(ids, library["campfire_hit"], library["campfire_b"], library["easy_rock"])
    assert positions == sorted(positions)
    assert str(library["hard_metal"].id) not in ids


async def test_genre_and_tempo_setlists(api, library):
    slow_pretty = await _setlist_ids(api, "slow-pretty")
    assert str(library["campfire_hit"].id) in slow_pretty
    assert str(library["hebrew_artist"].id) in slow_pretty
    assert str(library["hebrew"].id) not in slow_pretty  # 100 bpm is not slow
    assert str(library["easy_rock"].id) not in slow_pretty  # rock

    band_room = await _setlist_ids(api, "band-room")
    assert str(library["easy_rock"].id) in band_room
    assert str(library["hard_metal"].id) not in band_room  # too hard

    jam = await _setlist_ids(api, "jam-drummer")
    assert str(library["easy_rock"].id) in jam
    assert str(library["hard_metal"].id) in jam
    assert str(library["campfire_b"].id) not in jam  # pop at 90 bpm

    challenge = await _setlist_ids(api, "challenge")
    assert str(library["hard_metal"].id) in challenge
    assert str(library["easy_rock"].id) not in challenge


async def test_israeli_favorites_match_hebrew_titles_or_artists(api, library):
    ids = await _setlist_ids(api, "israeli")
    assert str(library["hebrew"].id) in ids
    assert str(library["hebrew_artist"].id) in ids
    assert str(library["campfire_hit"].id) not in ids


async def test_setlist_songs_paginate_like_the_song_list(api, library):
    resp = await api.client.get(f"{SETLISTS_URL}/campfire", params={"skip": 1, "limit": 1})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"items", "total", "offset", "limit"}
    assert body["offset"] == 1
    assert body["limit"] == 1
    assert len(body["items"]) == 1
    song = body["items"][0]
    assert {"difficulty", "chord_count", "easy_chords", "easy_capo", "tempo_bpm"} <= set(song)


async def test_unknown_setlist_is_not_found(api, library):
    resp = await api.client.get(f"{SETLISTS_URL}/{uuid.uuid4().hex}")
    assert resp.status_code == 404


async def test_songs_with_too_few_detected_shapes_stay_out_of_learning_setlists(api, library, song_factory):
    """A song tagged from one sustained chord is detection noise, not a first song."""
    one_chord = await song_factory.create(**_playable(
        title="One Chord Noise", difficulty="easy", chord_count=1, genre="folk",
        tempo_bpm=60.0, play_count=1_000_000,
    ))

    for setlist_id in ("campfire", "first-songs", "slow-pretty"):
        assert str(one_chord.id) not in await _setlist_ids(api, setlist_id)


async def test_hits_chart_lists_known_songs_in_chart_order(api, library, song_factory):
    """The hits chart follows the curated ranking, not play counts."""
    third = await song_factory.create(**_playable(
        song_name=WORLD_HITS[2], title="Hotel California", difficulty="medium", chord_count=6,
        play_count=900_000,
    ))
    first = await song_factory.create(**_playable(
        song_name=WORLD_HITS[0], title="Wonderwall", difficulty="easy", chord_count=5, play_count=10,
    ))
    noise = await song_factory.create(**_playable(
        song_name=WORLD_HITS[1], title="Knockin' On Heaven's Door", difficulty="easy", chord_count=1,
    ))

    ids = await _setlist_ids(api, "hits")
    assert ids == [str(first.id), str(third.id)]  # off-chart and one-chord songs stay out
    assert str(noise.id) not in ids

    index = (await api.client.get(SETLISTS_URL)).json()["items"]
    kinds = {item["id"]: item["kind"] for item in index}
    assert kinds["hits"] == "chart"
    assert kinds["campfire"] == "setlist"


async def test_israeli_classics_chart_ranks_hebrew_hits(api, library, song_factory):
    second = await song_factory.create(**_playable(
        song_name=ISRAELI_HITS[1], title="הכוכבים דולקים על אש קטנה", difficulty="medium", chord_count=7,
    ))
    first = await song_factory.create(**_playable(
        song_name=ISRAELI_HITS[0], title="אני ואתה", difficulty="medium", chord_count=6,
    ))

    assert await _setlist_ids(api, "israeli-hits") == [str(first.id), str(second.id)]


async def test_known_songs_lead_every_setlist(api, library, song_factory):
    """A well-known song outranks a more-played unknown one, even in first songs."""
    hit = await song_factory.create(**_playable(
        song_name=WORLD_HITS[6], title="Riptide", difficulty="easy", chord_count=4, genre="folk",
        tempo_bpm=100.0, play_count=1,
    ))

    campfire = await _setlist_ids(api, "campfire")
    assert campfire.index(str(hit.id)) < campfire.index(str(library["campfire_hit"].id))
    first_songs = await _setlist_ids(api, "first-songs")
    assert first_songs[0] == str(hit.id)


async def test_level_up_takes_seven_shape_songs(api, library, song_factory):
    seven = await song_factory.create(**_playable(
        title="Seven Shapes", difficulty="medium", chord_count=7, genre="pop",
    ))
    assert str(seven.id) in await _setlist_ids(api, "challenge")
