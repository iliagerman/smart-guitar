"""Schemas for analytics tracking and dashboard responses."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class TrackEventRequest(BaseModel):
    event_type: str = Field(min_length=1, max_length=50)
    event_category: str = Field(min_length=1, max_length=30)
    song_id: uuid.UUID | None = None
    song_title: str | None = Field(default=None, max_length=500)
    session_id: str | None = Field(default=None, max_length=64)
    properties: dict[str, Any] | None = None


class TrackEventsRequest(BaseModel):
    events: list[TrackEventRequest] = Field(default_factory=list, max_length=50)


class TrackEventsResponse(BaseModel):
    accepted: int


class AnalyticsAccessResponse(BaseModel):
    allowed: bool
    email: str | None = None


class AnalyticsOverview(BaseModel):
    total_events: int
    unique_users: int
    total_sessions: int
    login_count: int
    song_play_count: int


class TimeBucket(BaseModel):
    bucket_start: datetime
    count: int


class EventTrend(BaseModel):
    event_type: str
    buckets: list[TimeBucket]


class SongRanking(BaseModel):
    song_id: uuid.UUID | None = None
    song_title: str | None = None
    play_count: int
    unique_users: int


class UserActivity(BaseModel):
    user_email: str
    event_count: int
    last_seen_at: datetime


class EventTypeBreakdown(BaseModel):
    event_type: str
    count: int


class RecentEvent(BaseModel):
    id: uuid.UUID
    created_at: datetime
    event_type: str
    event_category: str
    event_source: str
    user_email: str | None = None
    tenant_id: str | None = None
    aws_account_id: str | None = None
    song_id: uuid.UUID | None = None
    song_title: str | None = None
    session_id: str | None = None
    properties: dict[str, Any] | None = None


class UserEmailListResponse(BaseModel):
    items: list[str]


class AnalyticsDashboard(BaseModel):
    window_start: datetime
    window_end: datetime
    granularity: Literal["day", "week", "month"]
    overview: AnalyticsOverview
    trends: list[EventTrend]
    event_breakdown: list[EventTypeBreakdown]
    top_songs: list[SongRanking]
    user_activity: list[UserActivity]
    recent_events: list[RecentEvent]
