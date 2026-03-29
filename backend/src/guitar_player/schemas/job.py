"""Job request/response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class CreateJobRequest(BaseModel):
    song_id: uuid.UUID
    descriptions: list[str]
    mode: str = "isolate"


class JobResultEntry(BaseModel):
    description: str
    target_key: str | None = None
    residual_key: str | None = None


class ActiveJobInfo(BaseModel):
    """Lightweight summary of an active job, embedded in SongDetailResponse."""

    id: uuid.UUID
    status: str
    progress: int = 0
    stage: str | None = None


class JobResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    song_id: uuid.UUID
    status: str
    progress: int | None = None
    stage: str | None = None
    descriptions: list[str] | None = None
    mode: str | None = None
    error_message: str | None = None
    results: list[JobResultEntry] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}
