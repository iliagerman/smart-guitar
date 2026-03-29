"""DAO for analytics event storage and reporting queries."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Select, and_, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.analytics_event import AnalyticsEvent
from guitar_player.schemas.records import AnalyticsEventRecord


class AnalyticsDAO(BaseDAO[AnalyticsEvent, AnalyticsEventRecord]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, AnalyticsEvent, AnalyticsEventRecord)

    def _apply_filters(
        self,
        stmt: Select,
        *,
        event_type: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> Select:
        conditions = []
        if event_type:
            conditions.append(AnalyticsEvent.event_type == event_type)
        if since:
            conditions.append(AnalyticsEvent.created_at >= since)
        if until:
            conditions.append(AnalyticsEvent.created_at <= until)
        if user_email:
            conditions.append(AnalyticsEvent.user_email == user_email)
        if tenant_id:
            conditions.append(AnalyticsEvent.tenant_id == tenant_id)
        if aws_account_id:
            conditions.append(AnalyticsEvent.aws_account_id == aws_account_id)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        return stmt

    def _bucket_expression(self, granularity: str) -> Any:
        bind = self._session.bind
        dialect = bind.dialect.name if bind is not None else "postgresql"
        if dialect == "sqlite":
            fmt = {
                "day": "%Y-%m-%d 00:00:00",
                "week": "%Y-%W-1 00:00:00",
                "month": "%Y-%m-01 00:00:00",
            }[granularity]
            return func.strftime(fmt, AnalyticsEvent.created_at)
        return func.date_trunc(granularity, AnalyticsEvent.created_at)

    async def record_event(self, **kwargs: Any) -> AnalyticsEventRecord:
        return await self.create(**kwargs)

    async def record_events(
        self, events: list[dict[str, Any]]
    ) -> list[AnalyticsEventRecord]:
        objects = [AnalyticsEvent(**event) for event in events]
        self._session.add_all(objects)
        await self._session.flush()
        for obj in objects:
            await self._session.refresh(obj)
        return [self._to_record(obj) for obj in objects]

    async def count_events(
        self,
        *,
        event_type: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> int:
        stmt = select(func.count()).select_from(AnalyticsEvent)
        stmt = self._apply_filters(
            stmt,
            event_type=event_type,
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        result = await self._session.execute(stmt)
        return int(result.scalar_one() or 0)

    async def count_unique_users(
        self,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> int:
        stmt = select(func.count(distinct(AnalyticsEvent.user_email))).select_from(
            AnalyticsEvent
        )
        stmt = stmt.where(
            AnalyticsEvent.user_email.is_not(None), AnalyticsEvent.user_email != ""
        )
        stmt = self._apply_filters(
            stmt,
            since=since,
            until=until,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        result = await self._session.execute(stmt)
        return int(result.scalar_one() or 0)

    async def count_sessions(
        self,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> int:
        stmt = select(func.count(distinct(AnalyticsEvent.session_id))).select_from(
            AnalyticsEvent
        )
        stmt = stmt.where(
            AnalyticsEvent.session_id.is_not(None), AnalyticsEvent.session_id != ""
        )
        stmt = self._apply_filters(
            stmt,
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        result = await self._session.execute(stmt)
        return int(result.scalar_one() or 0)

    async def events_over_time(
        self,
        *,
        event_type: str | None = None,
        granularity: str = "day",
        since: datetime | None = None,
        until: datetime | None = None,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> list[tuple[datetime | str, str, int]]:
        bucket_expr = self._bucket_expression(granularity).label("bucket_start")
        stmt = select(
            bucket_expr,
            AnalyticsEvent.event_type.label("event_type"),
            func.count().label("count"),
        ).select_from(AnalyticsEvent)
        stmt = self._apply_filters(
            stmt,
            event_type=event_type,
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        stmt = stmt.group_by(bucket_expr, AnalyticsEvent.event_type).order_by(
            bucket_expr.asc(), AnalyticsEvent.event_type.asc()
        )
        result = await self._session.execute(stmt)
        return [(row.bucket_start, row.event_type, int(row.count)) for row in result]

    async def top_songs(
        self,
        *,
        limit: int = 10,
        since: datetime | None = None,
        until: datetime | None = None,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> list[tuple[uuid.UUID | None, str | None, int, int]]:
        stmt = select(
            AnalyticsEvent.song_id,
            AnalyticsEvent.song_title,
            func.count().label("play_count"),
            func.count(distinct(AnalyticsEvent.user_email)).label("unique_users"),
        ).select_from(AnalyticsEvent)
        stmt = stmt.where(AnalyticsEvent.song_id.is_not(None))
        stmt = self._apply_filters(
            stmt,
            event_type="song_played",
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        stmt = (
            stmt.group_by(AnalyticsEvent.song_id, AnalyticsEvent.song_title)
            .order_by(func.count().desc(), AnalyticsEvent.song_title.asc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return [
            (
                row.song_id,
                row.song_title,
                int(row.play_count),
                int(row.unique_users or 0),
            )
            for row in result
        ]

    async def per_user_activity(
        self,
        *,
        limit: int = 25,
        since: datetime | None = None,
        until: datetime | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> list[tuple[str, int, datetime]]:
        stmt = select(
            AnalyticsEvent.user_email,
            func.count().label("event_count"),
            func.max(AnalyticsEvent.created_at).label("last_seen_at"),
        ).select_from(AnalyticsEvent)
        stmt = stmt.where(
            AnalyticsEvent.user_email.is_not(None), AnalyticsEvent.user_email != ""
        )
        stmt = self._apply_filters(
            stmt,
            since=since,
            until=until,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        stmt = (
            stmt.group_by(AnalyticsEvent.user_email)
            .order_by(func.count().desc(), func.max(AnalyticsEvent.created_at).desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return [
            (row.user_email, int(row.event_count), row.last_seen_at) for row in result
        ]

    async def event_type_breakdown(
        self,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> list[tuple[str, int]]:
        stmt = select(
            AnalyticsEvent.event_type,
            func.count().label("count"),
        ).select_from(AnalyticsEvent)
        stmt = self._apply_filters(
            stmt,
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        stmt = stmt.group_by(AnalyticsEvent.event_type).order_by(
            func.count().desc(), AnalyticsEvent.event_type.asc()
        )
        result = await self._session.execute(stmt)
        return [(row.event_type, int(row.count)) for row in result]

    async def recent_events(
        self,
        *,
        limit: int = 50,
        since: datetime | None = None,
        until: datetime | None = None,
        event_type: str | None = None,
        user_email: str | None = None,
        tenant_id: str | None = None,
        aws_account_id: str | None = None,
    ) -> list[AnalyticsEventRecord]:
        stmt = select(AnalyticsEvent)
        stmt = self._apply_filters(
            stmt,
            event_type=event_type,
            since=since,
            until=until,
            user_email=user_email,
            tenant_id=tenant_id,
            aws_account_id=aws_account_id,
        )
        stmt = stmt.order_by(AnalyticsEvent.created_at.desc()).limit(limit)
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    async def distinct_user_emails(
        self,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[str]:
        stmt = select(distinct(AnalyticsEvent.user_email)).select_from(AnalyticsEvent)
        stmt = stmt.where(
            AnalyticsEvent.user_email.is_not(None), AnalyticsEvent.user_email != ""
        )
        stmt = self._apply_filters(stmt, since=since, until=until)
        stmt = stmt.order_by(AnalyticsEvent.user_email.asc())
        result = await self._session.execute(stmt)
        return [row[0] for row in result if row[0]]
