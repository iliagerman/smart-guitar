"""Favorite endpoints."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status

from guitar_player.auth.schemas import CurrentUser
from guitar_player.auth.subscription_guard import require_active_subscription
from guitar_player.dependencies import get_favorite_service
from guitar_player.schemas.favorite import (
    AddFavoriteRequest,
    FavoriteListResponse,
    FavoriteResponse,
)
from guitar_player.services.analytics_helpers import (
    analytics_identity_from_user,
    track_event,
)
from guitar_player.services.favorite_service import FavoriteService

router = APIRouter(prefix="/favorites", tags=["favorites"])


@router.post(
    "",
    response_model=FavoriteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_favorite(
    body: AddFavoriteRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_active_subscription),
    favorite_service: FavoriteService = Depends(get_favorite_service),
) -> FavoriteResponse:
    favorite = await favorite_service.add_favorite(
        user_sub=user.sub,
        user_email=user.email,
        song_id=body.song_id,
    )
    track_event(
        background_tasks,
        event_type="favorite_added",
        event_category="songs",
        **analytics_identity_from_user(user),
        song_id=body.song_id,
    )
    return favorite


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_favorite(
    song_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_active_subscription),
    favorite_service: FavoriteService = Depends(get_favorite_service),
) -> None:
    await favorite_service.remove_favorite(
        user_sub=user.sub,
        user_email=user.email,
        song_id=song_id,
    )
    track_event(
        background_tasks,
        event_type="favorite_removed",
        event_category="songs",
        **analytics_identity_from_user(user),
        song_id=song_id,
    )


@router.get("", response_model=FavoriteListResponse)
async def list_favorites(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user: CurrentUser = Depends(require_active_subscription),
    favorite_service: FavoriteService = Depends(get_favorite_service),
) -> FavoriteListResponse:
    favorites = await favorite_service.list_favorites(
        user_sub=user.sub, offset=offset, limit=limit
    )
    return FavoriteListResponse(favorites=favorites)
