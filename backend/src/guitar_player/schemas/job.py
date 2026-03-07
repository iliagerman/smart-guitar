"""Job request/response schemas."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CreateJobRequest(BaseModel):
    song_id: uuid.UUID
    descriptions: list[str]
    mode: str = "isolate"


class JobResultEntry(BaseModel):
    description: str
    target_key: Optional[str] = None
    residual_key: Optional[str] = None


class ActiveJobInfo(BaseModel):
    """Lightweight summary of an active job, embedded in SongDetailResponse."""

    id: uuid.UUID
    status: str
    progress: int = 0
    stage: Optional[str] = None


class JobResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    song_id: uuid.UUID
    status: str
    progress: int | None = None
    stage: Optional[str] = None
    descriptions: Optional[list[str]] = None
    mode: Optional[str] = None
    error_message: Optional[str] = None
    results: Optional[list[JobResultEntry]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
