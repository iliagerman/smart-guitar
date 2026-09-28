"""Practice path endpoints: per-song progress, streak and skill level (free tier)."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.schemas import MemberAccess
from guitar_player.auth.subscription_guard import get_member_access
from guitar_player.dependencies import get_db, get_storage
from guitar_player.schemas.practice import (
    PracticeProgressResponse,
    PracticeSummaryResponse,
    SavePracticeProgressRequest,
    SkillLevelRequest,
    SkillLevelResponse,
)
from guitar_player.services.practice_service import PracticeService
from guitar_player.storage import StorageBackend

router = APIRouter(prefix="/practice", tags=["practice"])


def get_practice_service(
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> PracticeService:
    return PracticeService(session, storage)


@router.get("/summary", response_model=PracticeSummaryResponse)
async def get_practice_summary(
    access: MemberAccess = Depends(get_member_access),
    service: PracticeService = Depends(get_practice_service),
) -> PracticeSummaryResponse:
    return await service.get_summary(access.user.sub, access.user.email)


@router.put("/level", response_model=SkillLevelResponse)
async def set_skill_level(
    body: SkillLevelRequest,
    access: MemberAccess = Depends(get_member_access),
    service: PracticeService = Depends(get_practice_service),
) -> SkillLevelResponse:
    return await service.set_skill_level(access.user.sub, access.user.email, body.skill_level)


@router.get("/songs/{song_id}", response_model=PracticeProgressResponse)
async def get_song_progress(
    song_id: uuid.UUID,
    access: MemberAccess = Depends(get_member_access),
    service: PracticeService = Depends(get_practice_service),
) -> PracticeProgressResponse:
    return await service.get_song_progress(access.user.sub, access.user.email, song_id)


@router.put("/songs/{song_id}", response_model=PracticeProgressResponse)
async def save_song_progress(
    song_id: uuid.UUID,
    body: SavePracticeProgressRequest,
    access: MemberAccess = Depends(get_member_access),
    service: PracticeService = Depends(get_practice_service),
) -> PracticeProgressResponse:
    return await service.save_song_progress(access.user.sub, access.user.email, song_id, body)
