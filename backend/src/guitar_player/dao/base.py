"""Generic base DAO with standard CRUD operations."""

import uuid
from typing import Generic, Sequence, TypeVar

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.models.base import Base

T = TypeVar("T", bound=Base)


class BaseDAO(Generic[T]):
    """Generic data access object providing CRUD for any SQLAlchemy model."""

    def __init__(self, session: AsyncSession, model: type[T]) -> None:
        self._session = session
        self._model = model

    async def get_by_id(self, id: uuid.UUID) -> T | None:
        return await self._session.get(self._model, id)

    async def list_all(self, offset: int = 0, limit: int = 50) -> Sequence[T]:
        stmt = select(self._model).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def create(self, **kwargs) -> T:
        obj = self._model(**kwargs)
        self._session.add(obj)
        await self._session.flush()
        await self._session.refresh(obj)
        return obj

    async def update(self, obj: T, **kwargs) -> T:
        for key, value in kwargs.items():
            setattr(obj, key, value)
        await self._session.flush()
        await self._session.refresh(obj)
        return obj

    async def delete(self, obj: T) -> None:
        await self._session.delete(obj)
        await self._session.flush()

    async def count(self) -> int:
        stmt = select(func.count()).select_from(self._model)
        result = await self._session.execute(stmt)
        return result.scalar_one()
