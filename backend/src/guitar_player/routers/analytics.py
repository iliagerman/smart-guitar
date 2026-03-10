"""Analytics ingestion and dashboard endpoints."""

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from guitar_player.auth.analytics_guard import (
    is_analytics_user_allowed,
    require_analytics_admin,
)
from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.config import Settings, get_settings
from guitar_player.dependencies import get_analytics_service
from guitar_player.schemas.analytics import (
    AnalyticsAccessResponse,
    AnalyticsDashboard,
    AnalyticsOverview,
    EventTrend,
    RecentEvent,
    SongRanking,
    TrackEventsRequest,
    TrackEventsResponse,
    UserActivity,
    UserEmailListResponse,
    EventTypeBreakdown,
)
from guitar_player.services.analytics_helpers import (
    analytics_identity_from_user,
    track_events_batch,
)
from guitar_player.services.analytics_service import AnalyticsService

router = APIRouter(prefix="/analytics", tags=["analytics"])

Granularity = Literal["day", "week", "month"]


def _resolve_window(
    *,
    days: int,
    since: datetime | None,
    until: datetime | None,
) -> tuple[datetime, datetime]:
    resolved_until = until or datetime.now(timezone.utc)
    resolved_since = since or (resolved_until - timedelta(days=days))
    if resolved_since > resolved_until:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="since must be earlier than until",
        )
    return resolved_since, resolved_until


@router.get("/access", response_model=AnalyticsAccessResponse)
async def get_analytics_access(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> AnalyticsAccessResponse:
    return AnalyticsAccessResponse(
        allowed=is_analytics_user_allowed(user.email, settings),
        email=user.email or None,
    )


@router.get("/dashboard", response_model=AnalyticsDashboard)
async def get_dashboard(
    _: CurrentUser = Depends(require_analytics_admin),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    days: int = Query(30, ge=1, le=365),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    granularity: Granularity = Query("day"),
    user_email: str | None = Query(None),
    tenant_id: str | None = Query(None),
    aws_account_id: str | None = Query(None),
) -> AnalyticsDashboard:
    resolved_since, resolved_until = _resolve_window(
        days=days, since=since, until=until
    )
    return await analytics_service.get_dashboard(
        since=resolved_since,
        until=resolved_until,
        granularity=granularity,
        user_email=user_email,
        tenant_id=tenant_id,
        aws_account_id=aws_account_id,
    )


@router.get("/overview", response_model=AnalyticsOverview)
async def get_overview(
    _: CurrentUser = Depends(require_analytics_admin),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    days: int = Query(30, ge=1, le=365),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    user_email: str | None = Query(None),
    tenant_id: str | None = Query(None),
    aws_account_id: str | None = Query(None),
) -> AnalyticsOverview:
    resolved_since, resolved_until = _resolve_window(
        days=days, since=since, until=until
    )
    return await analytics_service.get_overview(
        since=resolved_since,
        until=resolved_until,
        user_email=user_email,
        tenant_id=tenant_id,
        aws_account_id=aws_account_id,
    )


@router.get("/trends", response_model=list[EventTrend])
async def get_trends(
    _: CurrentUser = Depends(require_analytics_admin),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    days: int = Query(30, ge=1, le=365),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    granularity: Granularity = Query("day"),
    event_type: str | None = Query(None),
    user_email: str | None = Query(None),
    tenant_id: str | None = Query(None),
    aws_account_id: str | None = Query(None),
) -> list[EventTrend]:
    resolved_since, resolved_until = _resolve_window(
        days=days, since=since, until=until
    )
    return await analytics_service.get_trends(
        since=resolved_since,
        until=resolved_until,
        granularity=granularity,
        event_type=event_type,
        user_email=user_email,
        tenant_id=tenant_id,
        aws_account_id=aws_account_id,
    )


@router.get("/top-songs", response_model=list[SongRanking])
async def get_top_songs(
    _: CurrentUser = Depends(require_analytics_admin),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    days: int = Query(30, ge=1, le=365),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    limit: int = Query(10, ge=1, le=100),
    user_email: str | None = Query(None),
    tenant_id: str | None = Query(None),
    aws_account_id: str | None = Query(None),
) -> list[SongRanking]:
    resolved_since, resolved_until = _resolve_window(
        days=days, since=since, until=until
    )
    return await analytics_service.get_top_songs(
        limit=limit,
        since=resolved_since,
        until=resolved_until,
        user_email=user_email,
        tenant_id=tenant_id,
        aws_account_id=aws_account_id,
    )


@router.get("/users", response_model=list[UserActivity])
async def get_users(
    _: CurrentUser = Depends(require_analytics_admin),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    days: int = Query(30, ge=1, le=365),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    tenant_id: str | None = Query(None),
    aws_account_id: str | None = Query(None),
) -> list[UserActivity]:
    resolved_since, resolved_until = _resolve_window(
        days=days, since=since, until=until
    )
    return await analytics_service.get_user_activity(
        limit=limit,
        since=resolved_since,
        until=resolved_until,
        tenant_id=tenant_id,
        aws_account_id=aws_account_id,
    )


@router.get("/events", response_model=list[RecentEvent])
async def get_events(
    _: CurrentUser = Depends(require_analytics_admin),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    days: int = Query(30, ge=1, le=365),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    limit: int = Query(25, ge=1, le=100),
    event_type: str | None = Query(None),
    user_email: str | None = Query(None),
    tenant_id: str | None = Query(None),
    aws_account_id: str | None = Query(None),
) -> list[RecentEvent]:
    resolved_since, resolved_until = _resolve_window(
        days=days, since=since, until=until
    )
    return await analytics_service.get_recent_events(
        limit=limit,
        since=resolved_since,
        until=resolved_until,
        event_type=event_type,
        user_email=user_email,
        tenant_id=tenant_id,
        aws_account_id=aws_account_id,
    )


@router.get("/breakdown", response_model=list[EventTypeBreakdown])
async def get_breakdown(
    _: CurrentUser = Depends(require_analytics_admin),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    days: int = Query(30, ge=1, le=365),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    user_email: str | None = Query(None),
    tenant_id: str | None = Query(None),
    aws_account_id: str | None = Query(None),
) -> list[EventTypeBreakdown]:
    resolved_since, resolved_until = _resolve_window(
        days=days, since=since, until=until
    )
    return await analytics_service.get_event_breakdown(
        since=resolved_since,
        until=resolved_until,
        user_email=user_email,
        tenant_id=tenant_id,
        aws_account_id=aws_account_id,
    )


@router.get("/user-emails", response_model=UserEmailListResponse)
async def get_user_emails(
    _: CurrentUser = Depends(require_analytics_admin),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    days: int = Query(365, ge=1, le=3650),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
) -> UserEmailListResponse:
    resolved_since, resolved_until = _resolve_window(
        days=days, since=since, until=until
    )
    items = await analytics_service.get_distinct_user_emails(
        since=resolved_since,
        until=resolved_until,
    )
    return UserEmailListResponse(items=items)


@router.post(
    "/track/batch",
    response_model=TrackEventsResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def track_batch(
    body: TrackEventsRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
) -> TrackEventsResponse:
    identity = analytics_identity_from_user(user)
    events = [
        {
            **identity,
            "event_type": item.event_type,
            "event_category": item.event_category,
            "event_source": "client",
            "song_id": item.song_id,
            "song_title": item.song_title,
            "session_id": item.session_id,
            "properties": item.properties,
        }
        for item in body.events
    ]
    track_events_batch(background_tasks, events=events)
    return TrackEventsResponse(accepted=len(events))
