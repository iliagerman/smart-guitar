"""Schemas for the admin service endpoints."""

import uuid
from enum import Enum

from pydantic import BaseModel, Field


class AdminRequiredSong(BaseModel):
    song_id: uuid.UUID
    song_name: str
    reasons: list[str] = Field(default_factory=list)


class AdminRequiredSongsResponse(BaseModel):
    items: list[AdminRequiredSong]

    # How many songs were inspected in this request.
    scanned: int

    # Offset to pass to the next request to continue scanning.
    # When None, there are no more songs to scan.
    next_offset: int | None = None


class AdminSongResponse(BaseModel):
    song_id: uuid.UUID

    audio_thumbnail_fixed: bool = False
    reprocess_triggered: bool = False
    lyrics_enqueued: bool = False


    # Job ID created by trigger_reprocess (None when no reprocess was needed).
    job_id: uuid.UUID | None = None

    # True when the song was deleted because audio is unrecoverable.
    deleted: bool = False

    warnings: list[str] = Field(default_factory=list)


class AdminSeedPopulateResponse(BaseModel):
    """Response for operational endpoint that populates the predefined seed songs."""

    songs_created: int = 0
    metadata_updated: int = 0
    storage_keys_updated: int = 0


class AdminDropSongsResponse(BaseModel):
    songs_deleted: int = 0
    storage_errors: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Sanity-check endpoint
# ---------------------------------------------------------------------------


class SanityCheckStatus(str, Enum):
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class SanityCheckResult(BaseModel):
    name: str
    status: SanityCheckStatus
    duration_ms: float = 0.0
    error: str | None = None


class SanityRequest(BaseModel):
    song_id: uuid.UUID | None = None


class SanityResponse(BaseModel):
    overall: SanityCheckStatus
    song_id: uuid.UUID | None = None
    song_name: str | None = None
    checks: list[SanityCheckResult] = Field(default_factory=list)
    total_duration_ms: float = 0.0
