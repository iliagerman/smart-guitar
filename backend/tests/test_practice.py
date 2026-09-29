"""Practice path: per-song step progress, the daily streak and the skill level."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from guitar_player.dao.user_dao import UserDAO
from tests.api_harness import create_member

SUMMARY_URL = "/api/v1/practice/summary"


def _progress_url(song_id: uuid.UUID) -> str:
    return f"/api/v1/practice/songs/{song_id}"


def _step_body(**overrides: object) -> dict[str, object]:
    return {
        "current_step": 2,
        "completed_steps": [1],
        "learned_chords": ["G", "C"],
        "stage_progress": 0.0,
        **overrides,
    }


@pytest.fixture
async def member(api, session_factory):
    """A signed-in free-tier member (practice is part of the free tier)."""
    user = await create_member(session_factory, pro=False)
    api.sign_in(user)
    return user


async def _set_streak(session_factory, member, *, streak: int, days_ago: int) -> None:
    today = datetime.now(timezone.utc).date()
    async with session_factory() as session:
        user_dao = UserDAO(session)
        db_user = await user_dao.get_by_cognito_sub(member.sub)
        await user_dao.update_by_id(
            db_user.id, streak_days=streak, last_practice_date=today - timedelta(days=days_ago),
        )
        await session.commit()


async def _summary(api) -> dict:
    resp = await api.client.get(SUMMARY_URL)
    assert resp.status_code == 200
    return resp.json()


async def test_new_member_summary_is_empty(api, member):
    assert await _summary(api) == {
        "skill_level": None,
        "streak_days": 0,
        "practiced_today": False,
        "continue_songs": [],
    }


async def test_skill_level_is_saved_and_validated(api, member):
    resp = await api.client.put("/api/v1/practice/level", json={"skill_level": "intermediate"})
    assert resp.status_code == 200
    assert resp.json() == {"skill_level": "intermediate"}
    assert (await _summary(api))["skill_level"] == "intermediate"

    resp = await api.client.put("/api/v1/practice/level", json={"skill_level": "expert"})
    assert resp.status_code == 422


async def test_unpracticed_song_starts_at_step_one(api, member, song_factory):
    song = await song_factory.create()
    resp = await api.client.get(_progress_url(song.id))
    assert resp.status_code == 200
    assert resp.json() == {
        "song_id": str(song.id),
        "current_step": 1,
        "completed_steps": [],
        "learned_chords": [],
        "stage_progress": 0.0,
        "last_practiced_at": None,
    }


async def test_progress_for_an_unknown_song_is_not_found(api, member):
    assert (await api.client.get(_progress_url(uuid.uuid4()))).status_code == 404
    assert (await api.client.put(_progress_url(uuid.uuid4()), json=_step_body())).status_code == 404


async def test_saving_progress_upserts_and_keeps_the_best_stage_progress(api, member, song_factory):
    song = await song_factory.create()

    resp = await api.client.put(_progress_url(song.id), json=_step_body(stage_progress=0.6))
    assert resp.status_code == 200
    saved = resp.json()
    assert saved["current_step"] == 2
    assert saved["completed_steps"] == [1]
    assert saved["learned_chords"] == ["G", "C"]
    assert saved["stage_progress"] == 0.6
    assert saved["last_practiced_at"] is not None

    resp = await api.client.put(_progress_url(song.id), json=_step_body(
        current_step=3, completed_steps=[3, 1, 2], learned_chords=["G", "C", "D"], stage_progress=0.3,
    ))
    updated = resp.json()
    assert updated["current_step"] == 3
    assert updated["completed_steps"] == [1, 2, 3]
    assert updated["learned_chords"] == ["G", "C", "D"]
    assert updated["stage_progress"] == 0.6  # best reached so far

    assert (await api.client.get(_progress_url(song.id))).json() == updated


@pytest.mark.parametrize(
    "body",
    [
        _step_body(current_step=0),
        _step_body(current_step=5),
        _step_body(completed_steps=[5]),
        _step_body(stage_progress=1.5),
        _step_body(stage_progress=-0.1),
    ],
)
async def test_invalid_progress_is_rejected(api, member, song_factory, body):
    song = await song_factory.create()
    assert (await api.client.put(_progress_url(song.id), json=body)).status_code == 422


async def test_first_practice_starts_a_streak_and_same_day_practice_keeps_it(api, member, song_factory):
    song = await song_factory.create()
    await api.client.put(_progress_url(song.id), json=_step_body())
    summary = await _summary(api)
    assert summary["streak_days"] == 1
    assert summary["practiced_today"] is True

    await api.client.put(_progress_url(song.id), json=_step_body(current_step=3))
    assert (await _summary(api))["streak_days"] == 1


async def test_practicing_the_day_after_extends_the_streak(api, member, song_factory, session_factory):
    await _set_streak(session_factory, member, streak=3, days_ago=1)
    summary = await _summary(api)
    assert summary["streak_days"] == 3  # still alive until today ends
    assert summary["practiced_today"] is False

    song = await song_factory.create()
    await api.client.put(_progress_url(song.id), json=_step_body())
    summary = await _summary(api)
    assert summary["streak_days"] == 4
    assert summary["practiced_today"] is True


async def test_a_missed_day_breaks_the_streak(api, member, song_factory, session_factory):
    await _set_streak(session_factory, member, streak=5, days_ago=2)
    assert (await _summary(api))["streak_days"] == 0

    song = await song_factory.create()
    await api.client.put(_progress_url(song.id), json=_step_body())
    assert (await _summary(api))["streak_days"] == 1


async def test_continue_songs_are_the_three_latest_unfinished_songs(api, member, song_factory):
    songs = [await song_factory.create(title=f"Practice {i}") for i in range(5)]
    for song in songs:
        await api.client.put(_progress_url(song.id), json=_step_body())
    # Finishing every step drops a song from "continue".
    await api.client.put(_progress_url(songs[3].id), json=_step_body(
        current_step=3, completed_steps=[1, 2, 3],
    ))

    continue_songs = (await _summary(api))["continue_songs"]

    assert [entry["song"]["id"] for entry in continue_songs] == [
        str(songs[4].id), str(songs[2].id), str(songs[1].id),
    ]
    first = continue_songs[0]
    assert first["song"]["title"] == "Practice 4"
    assert first["progress"]["song_id"] == str(songs[4].id)
    assert first["progress"]["completed_steps"] == [1]


async def test_practice_is_per_member(api, member, song_factory, session_factory):
    song = await song_factory.create()
    await api.client.put(_progress_url(song.id), json=_step_body(stage_progress=0.9))

    api.sign_in(await create_member(session_factory, pro=True))
    assert (await api.client.get(_progress_url(song.id))).json()["stage_progress"] == 0.0
    assert (await _summary(api))["continue_songs"] == []


async def test_the_path_is_three_steps_and_old_four_step_saves_still_finish(api, member, song_factory):
    """A path saved as four steps (the old "full speed") reads back as the three-step path."""
    legacy, fresh = await song_factory.create(), await song_factory.create()
    await api.client.put(_progress_url(fresh.id), json=_step_body())
    await api.client.put(_progress_url(legacy.id), json=_step_body(
        current_step=4, completed_steps=[1, 2, 3, 4],
    ))

    progress = (await api.client.get(_progress_url(legacy.id))).json()
    assert progress["current_step"] == 3
    assert progress["completed_steps"] == [1, 2, 3]
    assert [entry["song"]["id"] for entry in (await _summary(api))["continue_songs"]] == [str(fresh.id)]
