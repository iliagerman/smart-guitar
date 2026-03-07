"""Favorite request/response schemas."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from guitar_player.schemas.song import SongResponse


class AddFavoriteRequest(BaseModel):
    song_id: uuid.UUID


class FavoriteResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    song_id: uuid.UUID
    created_at: Optional[datetime] = None
    song: Optional[SongResponse] = None

    model_config = {"from_attributes": True}


class FavoriteListResponse(BaseModel):
    favorites: list[FavoriteResponse]
