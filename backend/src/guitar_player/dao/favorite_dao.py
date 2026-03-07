"""Favorite data access object."""

import uuid
from typing import Sequence

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.favorite import Favorite


class FavoriteDAO(BaseDAO[Favorite]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Favorite)

    async def get_by_user_and_song(
        self, user_id: uuid.UUID, song_id: uuid.UUID
    ) -> Favorite | None:
        stmt = select(Favorite).where(
            and_(Favorite.user_id == user_id, Favorite.song_id == song_id)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_by_user(
        self, user_id: uuid.UUID, offset: int = 0, limit: int = 50
    ) -> Sequence[Favorite]:
        stmt = (
            select(Favorite)
            .where(Favorite.user_id == user_id)
            .order_by(Favorite.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return result.scalars().all()
