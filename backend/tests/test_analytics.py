"""Analytics: what the tracker stores, and what the dashboard gets back for a user."""

import uuid
from datetime import datetime, timedelta, timezone

from guitar_player.dao.analytics_dao import AnalyticsDAO
from guitar_player.services.analytics_service import AnalyticsService
from tests.api_harness import create_member

IPHONE = {
    "device": "iPhone",
    "os": "iOS 18.5",
    "browser": "Safari 18.5",
    "standalone": False,
    "viewport": "390x844",
    "app_version": "v1300 · 0af270d · 2026-10-13 09:00",
}


async def _events_for(session_factory, email: str):
    async with session_factory() as session:
        return await AnalyticsDAO(session).recent_events(user_email=email)


# ── Tracking ──────────────────────────────────────────────────────


async def test_batch_stores_the_client_device_on_every_event(api, session_factory):
    member = await create_member(session_factory, pro=False)
    api.sign_in(member)

    resp = await api.client.post("/api/v1/analytics/track/batch", json={
        "client": IPHONE,
        "events": [
            {"event_type": "page_view", "event_category": "navigation", "properties": {"path": "/songs"}},
            {"event_type": "playback_started", "event_category": "player"},
        ],
    })

    assert resp.status_code == 202
    events = {e.event_type: e for e in await _events_for(session_factory, member.email)}
    assert events["page_view"].properties == {"path": "/songs", "client": IPHONE}
    assert events["playback_started"].properties == {"client": IPHONE}


async def test_batch_without_a_client_keeps_properties_as_sent(api, session_factory):
    """Browsers still running an older build send no client block."""
    member = await create_member(session_factory, pro=False)
    api.sign_in(member)

    resp = await api.client.post("/api/v1/analytics/track/batch", json={
        "events": [
            {"event_type": "page_view", "event_category": "navigation", "properties": {"path": "/songs"}},
            {"event_type": "session_end", "event_category": "session"},
        ],
    })

    assert resp.status_code == 202
    events = {e.event_type: e for e in await _events_for(session_factory, member.email)}
    assert events["page_view"].properties == {"path": "/songs"}
    assert events["session_end"].properties is None


# ── Dashboard ─────────────────────────────────────────────────────


async def test_recent_events_name_the_song_when_the_event_only_has_its_id(session_factory, song_factory):
    """Player events sent from the global tracker carry the song id but no title."""
    song = await song_factory.create(title="Bad Moon Rising")
    email = f"{uuid.uuid4().hex[:10]}@member.test"
    async with session_factory() as session:
        await AnalyticsDAO(session).record_events([
            {"event_type": "stem_switched", "event_category": "player", "user_email": email, "song_id": song.id},
            {
                "event_type": "song_played", "event_category": "player", "user_email": email,
                "song_id": song.id, "song_title": "Title At Play Time",
            },
            {"event_type": "page_view", "event_category": "navigation", "user_email": email},
        ])
        await session.commit()

        dashboard = await _dashboard(session, email)

    titles = {e.event_type: e.song_title for e in dashboard.recent_events}
    assert titles == {
        "stem_switched": "Bad Moon Rising",
        "song_played": "Title At Play Time",
        "page_view": None,
    }


async def test_filtering_by_user_returns_their_full_timeline(session_factory):
    """The unfiltered dashboard shows a short sample; one user's view shows what they did."""
    email = f"{uuid.uuid4().hex[:10]}@member.test"
    async with session_factory() as session:
        await AnalyticsDAO(session).record_events([
            {"event_type": "page_view", "event_category": "navigation", "user_email": email}
            for _ in range(40)
        ])
        await session.commit()

        filtered = await _dashboard(session, email)
        unfiltered = await _dashboard(session, None)

    assert len(filtered.recent_events) == 40
    assert len(unfiltered.recent_events) == 25


async def _dashboard(session, email: str | None):
    now = datetime.now(timezone.utc)
    return await AnalyticsService(session).get_dashboard(
        since=now - timedelta(days=1),
        until=now + timedelta(minutes=1),
        granularity="day",
        user_email=email,
    )
