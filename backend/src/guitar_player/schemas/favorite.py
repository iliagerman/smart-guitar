"""Favorite request/response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from guitar_player.schemas.song import SongResponse


class AddFavoriteRequest(BaseModel):
    song_id: uuid.UUID


class FavoriteResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    song_id: uuid.UUID
    created_at: datetime | None = None
    song: SongResponse | None = None
    # How often this user played the song; the song's play_count is everyone's.
    my_play_count: int = 0

    model_config = {"from_attributes": True}


class FavoriteListResponse(BaseModel):
    favorites: list[FavoriteResponse]
