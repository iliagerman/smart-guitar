"""Favorite data access object."""

import uuid

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from guitar_player.dao.base import BaseDAO
from guitar_player.models.favorite import Favorite
from guitar_player.schemas.records import FavoriteRecord


class FavoriteDAO(BaseDAO[Favorite, FavoriteRecord]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Favorite, FavoriteRecord)

    async def get_by_user_and_song(
        self, user_id: uuid.UUID, song_id: uuid.UUID
    ) -> FavoriteRecord | None:
        stmt = (
            select(Favorite)
            .where(and_(Favorite.user_id == user_id, Favorite.song_id == song_id))
            .options(selectinload(Favorite.song))
        )
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def list_by_user(
        self, user_id: uuid.UUID, offset: int = 0, limit: int = 50
    ) -> list[FavoriteRecord]:
        stmt = (
            select(Favorite)
            .where(Favorite.user_id == user_id)
            .order_by(Favorite.created_at.desc())
            .offset(offset)
            .limit(limit)
            .options(selectinload(Favorite.song))
        )
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    async def exists(self, user_id: uuid.UUID, song_id: uuid.UUID) -> bool:
        """Check if a favorite exists for the given user and song."""
        stmt = (
            select(func.count())
            .select_from(Favorite)
            .where(
                Favorite.user_id == user_id,
                Favorite.song_id == song_id,
            )
        )
        count = (await self._session.execute(stmt)).scalar_one()
        return count > 0
