"""Pydantic DTO records returned by the DAO layer.

These mirror the SQLAlchemy model columns (no business logic) and serve as the
boundary between the data-access layer and the rest of the application.
Services and routers work exclusively with these records — never with
SQLAlchemy model instances.
"""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class SongRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    youtube_id: str | None = None
    title: str
    artist: str | None = None
    duration_seconds: int | None = None
    song_name: str
    thumbnail_key: str | None = None
    audio_key: str | None = None
    genre: str | None = None
    play_count: int = 0
    like_count: int = 0

    # Stem and chord file paths (storage keys)
    vocals_key: str | None = None
    drums_key: str | None = None
    bass_key: str | None = None
    guitar_key: str | None = None
    piano_key: str | None = None
    other_key: str | None = None
    guitar_removed_key: str | None = None
    vocals_guitar_key: str | None = None
    chords_key: str | None = None
    lyrics_key: str | None = None
    lyrics_quick_key: str | None = None
    lyrics_corrected_key: str | None = None
    tabs_key: str | None = None
    external_strums_key: str | None = None

    # Processing lock & deduplication
    processing_job_id: uuid.UUID | None = None
    lyrics_corrected: bool = False
    lyrics_heal_version: int = 0
    lyrics_failed: bool = False
    tabs_failed: bool = False
    external_strums_failed: bool = False
    web_chords_failed: bool = False
    web_chords_key: str | None = None
    static_chords_failed: bool = False
    static_chords_key: str | None = None

    # Cooldown timestamps
    lyrics_attempted_at: datetime | None = None
    tabs_attempted_at: datetime | None = None
    merge_attempted_at: datetime | None = None
    external_strums_attempted_at: datetime | None = None
    web_chords_attempted_at: datetime | None = None
    static_chords_attempted_at: datetime | None = None
    download_requested_at: datetime | None = None

    downloaded_by: uuid.UUID | None = None


class JobRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    user_id: uuid.UUID
    song_id: uuid.UUID
    status: str
    progress: int = 0
    stage: str | None = None
    descriptions: list | None = None
    mode: str | None = None
    error_message: str | None = None
    results: list | None = None
    completed_at: datetime | None = None


class UserRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    cognito_sub: str
    email: str
    trial_ends_at: datetime | None = None
    has_seen_onboarding: bool = False


class FavoriteRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    user_id: uuid.UUID
    song_id: uuid.UUID

    # Populated via selectin relationship when available.
    song: SongRecord | None = None


class SubscriptionRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    user_id: uuid.UUID
    provider: str
    external_subscription_id: str
    external_customer_id: str
    status: str
    plan_type: str
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    canceled_at: datetime | None = None


class ChordVoteRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime

    song_id: uuid.UUID
    version_key: str
    user_id: uuid.UUID
    vote: int


class AnalyticsEventRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime

    event_type: str
    event_category: str
    event_source: str
    user_sub: str | None = None
    user_email: str | None = None
    tenant_id: str | None = None
    aws_account_id: str | None = None
    song_id: uuid.UUID | None = None
    song_title: str | None = None
    session_id: str | None = None
    properties: dict[str, Any] | None = None
