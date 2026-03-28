"""Pydantic DTO records returned by the DAO layer.

These mirror the SQLAlchemy model columns (no business logic) and serve as the
boundary between the data-access layer and the rest of the application.
Services and routers work exclusively with these records — never with
SQLAlchemy model instances.
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class SongRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    youtube_id: Optional[str] = None
    title: str
    artist: Optional[str] = None
    duration_seconds: Optional[int] = None
    song_name: str
    thumbnail_key: Optional[str] = None
    audio_key: Optional[str] = None
    genre: Optional[str] = None
    play_count: int = 0
    like_count: int = 0

    # Stem and chord file paths (storage keys)
    vocals_key: Optional[str] = None
    drums_key: Optional[str] = None
    bass_key: Optional[str] = None
    guitar_key: Optional[str] = None
    piano_key: Optional[str] = None
    other_key: Optional[str] = None
    guitar_removed_key: Optional[str] = None
    vocals_guitar_key: Optional[str] = None
    chords_key: Optional[str] = None
    lyrics_key: Optional[str] = None
    lyrics_quick_key: Optional[str] = None
    lyrics_corrected_key: Optional[str] = None
    tabs_key: Optional[str] = None
    external_strums_key: Optional[str] = None

    # Processing lock & deduplication
    processing_job_id: Optional[uuid.UUID] = None
    lyrics_corrected: bool = False
    lyrics_heal_version: int = 0
    lyrics_failed: bool = False
    tabs_failed: bool = False
    external_strums_failed: bool = False
    web_chords_failed: bool = False
    web_chords_key: Optional[str] = None

    # Cooldown timestamps
    lyrics_attempted_at: Optional[datetime] = None
    tabs_attempted_at: Optional[datetime] = None
    merge_attempted_at: Optional[datetime] = None
    external_strums_attempted_at: Optional[datetime] = None
    web_chords_attempted_at: Optional[datetime] = None
    download_requested_at: Optional[datetime] = None

    downloaded_by: Optional[uuid.UUID] = None


class JobRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    user_id: uuid.UUID
    song_id: uuid.UUID
    status: str
    progress: int = 0
    stage: Optional[str] = None
    descriptions: Optional[list] = None
    mode: Optional[str] = None
    error_message: Optional[str] = None
    results: Optional[list] = None
    completed_at: Optional[datetime] = None


class UserRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    cognito_sub: str
    email: str
    trial_ends_at: Optional[datetime] = None
    has_seen_onboarding: bool = False


class FavoriteRecord(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    user_id: uuid.UUID
    song_id: uuid.UUID

    # Populated via selectin relationship when available.
    song: Optional[SongRecord] = None


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
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    canceled_at: Optional[datetime] = None


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
    user_sub: Optional[str] = None
    user_email: Optional[str] = None
    tenant_id: Optional[str] = None
    aws_account_id: Optional[str] = None
    song_id: Optional[uuid.UUID] = None
    song_title: Optional[str] = None
    session_id: Optional[str] = None
    properties: Optional[dict[str, Any]] = None
