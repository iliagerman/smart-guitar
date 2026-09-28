"""Free tier vs Pro: what a signed-in member without Pro can hear, and what stays Pro-only."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.subscription_guard import local_dev_access
from guitar_player.config import Settings, get_settings
from guitar_player.dependencies import get_db, get_payment_provider, get_telegram_service
from guitar_player.services.allpay_provider import AllPayProvider
from guitar_player.services.telegram_service import TelegramService
from tests.api_harness import add_subscription, create_member

MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00fake-mp3"
STEM_FILES = ("vocals.mp3", "guitar.mp3", "drums.mp3", "bass.mp3")
SUBSCRIPTION_REQUIRED = "SUBSCRIPTION_REQUIRED"


@pytest.fixture
async def song(song_factory):
    """A playable song with the full mix and four stems on disk."""
    return await song_factory.create(
        files={
            "audio.mp3": MP3,
            **{name: MP3 for name in STEM_FILES},
            "chords.json": [{"start_time": 0.0, "end_time": 4.0, "chord": "G:maj"}],
        },
        artist=None,  # keeps song detail from looking up community chord sheets
    )


@pytest.fixture
async def free_member(session_factory):
    return await create_member(session_factory, pro=False)


@pytest.fixture
async def pro_member(session_factory):
    return await create_member(session_factory, pro=True)


def _assert_subscription_required(resp) -> None:
    assert resp.status_code == 403
    assert resp.json()["detail"]["error_code"] == SUBSCRIPTION_REQUIRED


# ── Song detail stems ─────────────────────────────────────────────


async def test_free_members_get_only_the_guitar_stem_in_song_detail(api, song, free_member):
    api.sign_in(free_member)
    resp = await api.client.get(f"/api/v1/songs/{song.id}")
    assert resp.status_code == 200
    detail = resp.json()

    assert detail["stems_locked"] is True
    assert detail["stems"]["guitar"] is not None
    assert all(value is None for name, value in detail["stems"].items() if name != "guitar")
    assert {"vocals", "guitar", "drums", "bass"} <= {s["name"] for s in detail["stem_types"]}
    assert detail["audio_url"] is not None
    assert detail["chords"]


async def test_pro_members_get_every_stem(api, song, pro_member):
    api.sign_in(pro_member)
    detail = (await api.client.get(f"/api/v1/songs/{song.id}")).json()

    assert detail["stems_locked"] is False
    for name in ("vocals", "guitar", "drums", "bass"):
        assert detail["stems"][name] is not None


async def test_an_expired_yearly_plan_falls_back_to_the_free_tier(
    api, song, free_member, session_factory,
):
    await add_subscription(
        session_factory, free_member, plan_type="yearly",
        period_end=datetime.now(timezone.utc) - timedelta(days=1),
    )
    api.sign_in(free_member)
    detail = (await api.client.get(f"/api/v1/songs/{song.id}")).json()
    assert detail["stems_locked"] is True
    _assert_subscription_required(await api.client.post("/api/v1/jobs", json={"song_id": str(song.id)}))


async def test_a_paid_yearly_plan_is_pro(api, song, free_member, session_factory):
    await add_subscription(
        session_factory, free_member, plan_type="yearly",
        period_end=datetime.now(timezone.utc) + timedelta(days=200),
    )
    api.sign_in(free_member)
    detail = (await api.client.get(f"/api/v1/songs/{song.id}")).json()
    assert detail["stems_locked"] is False


# ── Streaming and playback sources ────────────────────────────────


@pytest.mark.parametrize("stem", ["audio", "guitar"])
async def test_free_members_stream_the_full_mix_and_guitar(api, song, free_member, stem):
    api.sign_in(free_member)
    resp = await api.client.get(f"/api/v1/songs/{song.id}/stream", params={"stem": stem})
    assert resp.status_code == 200
    assert resp.content == MP3


@pytest.mark.parametrize("stem", ["vocals", "drums", "bass", "guitar_removed", "vocals_guitar"])
async def test_free_members_cannot_stream_other_stems(api, song, free_member, stem):
    api.sign_in(free_member)
    resp = await api.client.get(f"/api/v1/songs/{song.id}/stream", params={"stem": stem})
    _assert_subscription_required(resp)


async def test_pro_members_stream_any_stem(api, song, pro_member):
    api.sign_in(pro_member)
    resp = await api.client.get(f"/api/v1/songs/{song.id}/stream", params={"stem": "vocals"})
    assert resp.status_code == 200


async def test_playback_sources_for_free_members(api, song, free_member):
    api.sign_in(free_member)
    url = f"/api/v1/songs/{song.id}/playback-source"

    assert (await api.client.get(url)).status_code == 200
    assert (await api.client.get(url, params={"stems": "full_mix"})).status_code == 200
    guitar = await api.client.get(url, params={"stems": "guitar"})
    assert guitar.status_code == 200
    assert guitar.json()["url"].endswith("guitar.mp3")

    _assert_subscription_required(await api.client.get(url, params={"stems": "vocals"}))
    _assert_subscription_required(await api.client.get(url, params={"stems": "guitar,drums"}))


async def test_pro_members_get_any_playback_source(api, song, pro_member):
    api.sign_in(pro_member)
    resp = await api.client.get(f"/api/v1/songs/{song.id}/playback-source", params={"stems": "vocals"})
    assert resp.status_code == 200
    assert resp.json()["url"].endswith("vocals.mp3")


# ── Pro-only vs free endpoints ────────────────────────────────────


async def test_pro_only_endpoints_refuse_free_members(api, song, free_member):
    api.sign_in(free_member)
    chords = {"chords": [{"start_time": 0.0, "end_time": 1.0, "chord": "G"}]}
    requests = [
        ("POST", "/api/v1/songs/search", {"query": "wonderwall"}),
        ("POST", "/api/v1/songs/select", {"song_name": song.song_name}),
        ("POST", "/api/v1/songs/download", {"youtube_id": "abcdefghijk"}),
        ("POST", "/api/v1/jobs", {"song_id": str(song.id)}),
        ("POST", f"/api/v1/songs/{song.id}/strum-patterns/ai", None),
        ("PUT", f"/api/v1/songs/{song.id}/chords", chords),
        ("DELETE", f"/api/v1/songs/{song.id}/chords", None),
    ]
    for method, url, body in requests:
        resp = await api.client.request(method, url, json=body)
        assert resp.status_code == 403, (method, url, resp.text)
        assert resp.json()["detail"]["error_code"] == SUBSCRIPTION_REQUIRED


async def test_library_endpoints_are_free(api, song, free_member, monkeypatch):
    # The analytics insert runs while the request's write is uncommitted, which
    # blocks on SQLite's database lock (the test DB) for its full timeout.
    for router in ("songs", "favorites"):
        monkeypatch.setattr(f"guitar_player.routers.{router}.track_event", lambda *a, **k: None)
    api.sign_in(free_member)
    for url, params in [
        ("/api/v1/songs", {}),
        ("/api/v1/songs", {"query": "Test Song", "genre": "rock"}),
        ("/api/v1/songs/top", {"sort": "plays"}),
        ("/api/v1/songs/recent", {}),
        ("/api/v1/songs/genres", {}),
        (f"/api/v1/songs/{song.id}/recommendations", {}),
        ("/api/v1/favorites", {}),
        ("/api/v1/songs/setlists", {}),
        ("/api/v1/practice/summary", {}),
    ]:
        resp = await api.client.get(url, params=params)
        assert resp.status_code == 200, (url, resp.text)

    assert (await api.client.post(f"/api/v1/songs/{song.id}/play")).status_code == 204
    feedback = await api.client.post(f"/api/v1/songs/{song.id}/feedback", json={"rating": "thumbs_up"})
    assert feedback.status_code == 204
    vote = await api.client.post(
        f"/api/v1/songs/{song.id}/chord-votes", json={"version_key": "v1", "vote": 1},
    )
    assert vote.status_code == 200

    added = await api.client.post("/api/v1/favorites", json={"song_id": str(song.id)})
    assert added.status_code == 201
    assert (await api.client.delete(f"/api/v1/favorites/{song.id}")).status_code == 204


async def test_unknown_stream_file_is_still_a_bad_request(api, song, free_member):
    api.sign_in(free_member)
    resp = await api.client.get(f"/api/v1/songs/{song.id}/stream", params={"stem": "nope"})
    assert resp.status_code == 400


# ── Subscription status tier ──────────────────────────────────────


def _allpay_provider(
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    telegram: TelegramService = Depends(get_telegram_service),
) -> AllPayProvider:
    return AllPayProvider(session, settings, telegram)


async def _status(api, member) -> dict:
    api.app.dependency_overrides[get_payment_provider] = _allpay_provider
    api.sign_in(member)
    resp = await api.client.get("/api/v1/subscription/status")
    assert resp.status_code == 200
    return resp.json()


async def test_status_tier_for_a_member_on_trial(api, pro_member):
    status = await _status(api, pro_member)
    assert status["has_access"] is True
    assert status["tier"] == "trial"


async def test_status_tier_after_the_trial_ends(api, free_member):
    status = await _status(api, free_member)
    assert status["has_access"] is False
    assert status["tier"] == "free"


async def test_status_tier_with_a_paid_yearly_plan(api, free_member, session_factory):
    await add_subscription(
        session_factory, free_member, plan_type="yearly",
        period_end=datetime.now(timezone.utc) + timedelta(days=300),
    )
    status = await _status(api, free_member)
    assert status["has_access"] is True
    assert status["tier"] == "pro"
    assert status["subscription"]["plan_type"] == "yearly"


async def test_status_tier_once_a_yearly_plan_runs_out(api, free_member, session_factory):
    await add_subscription(
        session_factory, free_member, plan_type="yearly",
        period_end=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    status = await _status(api, free_member)
    assert status["has_access"] is False
    assert status["tier"] == "free"
    assert status["subscription"] is None


# ── Local dev ─────────────────────────────────────────────────────


def test_local_skip_auth_is_pro_unless_forced_free(monkeypatch):
    local = Settings(environment="local")
    monkeypatch.setenv("SKIP_AUTH", "1")
    monkeypatch.delenv("LOCAL_FORCE_FREE", raising=False)
    assert local_dev_access(local) is True

    monkeypatch.setenv("LOCAL_FORCE_FREE", "1")
    assert local_dev_access(local) is False

    assert local_dev_access(Settings(environment="prod")) is None
    monkeypatch.delenv("SKIP_AUTH")
    assert local_dev_access(local) is None


async def test_unknown_song_detail_is_not_found_for_free_members(api, free_member):
    api.sign_in(free_member)
    assert (await api.client.get(f"/api/v1/songs/{uuid.uuid4()}")).status_code == 404
