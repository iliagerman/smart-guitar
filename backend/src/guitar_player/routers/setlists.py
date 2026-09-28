"""Curated setlist endpoints (free tier)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.schemas import MemberAccess
from guitar_player.auth.subscription_guard import get_member_access
from guitar_player.dependencies import get_db, get_storage
from guitar_player.enums import SkillLevel
from guitar_player.schemas.setlist import SetlistListResponse
from guitar_player.schemas.song import PaginatedSongsResponse
from guitar_player.services.setlist_service import SetlistService
from guitar_player.storage import StorageBackend

# Mounted before the songs router so /songs/{song_id} doesn't swallow it.
router = APIRouter(prefix="/songs/setlists", tags=["setlists"])


def get_setlist_service(
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> SetlistService:
    return SetlistService(session, storage)


@router.get("", response_model=SetlistListResponse)
async def list_setlists(
    level: SkillLevel = Query(SkillLevel.BEGINNER),
    _access: MemberAccess = Depends(get_member_access),
    service: SetlistService = Depends(get_setlist_service),
) -> SetlistListResponse:
    return await service.list_setlists(level)


@router.get("/{setlist_id}", response_model=PaginatedSongsResponse)
async def list_setlist_songs(
    setlist_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    _access: MemberAccess = Depends(get_member_access),
    service: SetlistService = Depends(get_setlist_service),
) -> PaginatedSongsResponse:
    return await service.list_songs(setlist_id, skip, limit)
