"""Practice path request/response schemas."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from guitar_player.enums import SkillLevel
from guitar_player.schemas.song import SongResponse

PracticeStep = Annotated[int, Field(ge=1, le=4)]


class PracticeProgressResponse(BaseModel):
    song_id: uuid.UUID
    current_step: int = 1
    completed_steps: list[int] = []
    learned_chords: list[str] = []
    stage_progress: float = 0.0
    last_practiced_at: datetime | None = None


class SavePracticeProgressRequest(BaseModel):
    current_step: PracticeStep
    completed_steps: list[PracticeStep] = []
    # Fits the practice_progress.learned_chords column once comma-joined.
    learned_chords: list[Annotated[str, Field(min_length=1, max_length=12)]] = Field(
        default=[], max_length=20,
    )
    stage_progress: float = Field(0.0, ge=0.0, le=1.0)


class PracticeSongProgress(BaseModel):
    song: SongResponse
    progress: PracticeProgressResponse


class PracticeSummaryResponse(BaseModel):
    skill_level: SkillLevel | None = None
    streak_days: int = 0
    practiced_today: bool = False
    continue_songs: list[PracticeSongProgress] = []


class SkillLevelRequest(BaseModel):
    skill_level: SkillLevel


class SkillLevelResponse(BaseModel):
    skill_level: SkillLevel
