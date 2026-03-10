"""Business logic for analytics ingestion and dashboard queries."""

from datetime import datetime
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.analytics_dao import AnalyticsDAO
from guitar_player.schemas.analytics import (
    AnalyticsDashboard,
    AnalyticsOverview,
    EventTrend,
    EventTypeBreakdown,
    RecentEvent,
    SongRanking,
    TimeBucket,
    UserActivity,
)

Granularity = Literal["day", "week", "month"]


class AnalyticsService:
    def __init__(self, session: AsyncSession) -> None:
        self._dao = AnalyticsDAO(session)

    async def track(self, **kwargs: Any) -> None:
        await self._dao.record_event(**kwargs)

    async def track_batch(self, events: list[dict[str, Any]]) -> None:
        if not events:
            return
        await self._dao.record_events(events)

    async def get_overview(
        self,
        *,
        since: datetime,
        until: datetime,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> AnalyticsOverview:
        total_events = await self._dao.count_events(
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        unique_users = await self._dao.count_unique_users(
            since=since,
            until=until,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        total_sessions = await self._dao.count_sessions(
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        login_count = await self._dao.count_events(
            event_type="login",
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        song_play_count = await self._dao.count_events(
            event_type="song_played",
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        return AnalyticsOverview(
            total_events=total_events,
            unique_users=unique_users,
            total_sessions=total_sessions,
            login_count=login_count,
            song_play_count=song_play_count,
        )

    async def get_trends(
        self,
        *,
        since: datetime,
        until: datetime,
        granularity: Granularity,
        event_type: str | None = None,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> list[EventTrend]:
        rows = await self._dao.events_over_time(
            event_type=event_type,
            granularity=granularity,
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        grouped: dict[str, list[TimeBucket]] = {}
        for bucket_start, row_event_type, count in rows:
            bucket_dt = (
                bucket_start
                if isinstance(bucket_start, datetime)
                else datetime.fromisoformat(bucket_start)
            )
            grouped.setdefault(row_event_type, []).append(
                TimeBucket(bucket_start=bucket_dt, count=count)
            )
        return [
            EventTrend(event_type=key, buckets=value) for key, value in grouped.items()
        ]

    async def get_top_songs(
        self,
        *,
        limit: int,
        since: datetime,
        until: datetime,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> list[SongRanking]:
        rows = await self._dao.top_songs(
            limit=limit,
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        return [
            SongRanking(
                song_id=song_id,
                song_title=song_title,
                play_count=play_count,
                unique_users=unique_users,
            )
            for song_id, song_title, play_count, unique_users in rows
        ]

    async def get_user_activity(
        self,
        *,
        limit: int,
        since: datetime,
        until: datetime,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> list[UserActivity]:
        rows = await self._dao.per_user_activity(
            limit=limit,
            since=since,
            until=until,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        return [
            UserActivity(
                user_email=user_email,
                event_count=event_count,
                last_seen_at=last_seen_at,
            )
            for user_email, event_count, last_seen_at in rows
        ]

    async def get_event_breakdown(
        self,
        *,
        since: datetime,
        until: datetime,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> list[EventTypeBreakdown]:
        rows = await self._dao.event_type_breakdown(
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        return [
            EventTypeBreakdown(event_type=event_type, count=count)
            for event_type, count in rows
        ]

    async def get_recent_events(
        self,
        *,
        limit: int,
        since: datetime,
        until: datetime,
        event_type: str | None = None,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> list[RecentEvent]:
        rows = await self._dao.recent_events(
            limit=limit,
            since=since,
            until=until,
            event_type=event_type,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        return [RecentEvent.model_validate(row.model_dump()) for row in rows]

    async def get_distinct_user_emails(
        self,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[str]:
        return await self._dao.distinct_user_emails(since=since, until=until)

    async def get_dashboard(
        self,
        *,
        since: datetime,
        until: datetime,
        granularity: Granularity,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> AnalyticsDashboard:
        overview = await self.get_overview(
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        trends = await self.get_trends(
            since=since,
            until=until,
            granularity=granularity,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        event_breakdown = await self.get_event_breakdown(
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        top_songs = await self.get_top_songs(
            limit=10,
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        user_activity = await self.get_user_activity(
            limit=20,
            since=since,
            until=until,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        recent_events = await self.get_recent_events(
            limit=25,
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        return AnalyticsDashboard(
            window_start=since,
            window_end=until,
            granularity=granularity,
            overview=overview,
            trends=trends,
            event_breakdown=event_breakdown,
            top_songs=top_songs,
            user_activity=user_activity,
            recent_events=recent_events,
        )
