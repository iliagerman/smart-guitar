"""Generic base DAO with standard CRUD operations.

All public methods return Pydantic record DTOs — never SQLAlchemy model instances.
"""

import uuid
from typing import Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.models.base import Base

T = TypeVar("T", bound=Base)
R = TypeVar("R", bound=BaseModel)


class BaseDAO(Generic[T, R]):
    """Generic data access object providing CRUD for any SQLAlchemy model."""

    def __init__(self, session: AsyncSession, model: type[T], record_type: type[R]) -> None:
        self._session = session
        self._model = model
        self._record_type = record_type

    def _to_record(self, obj: T) -> R:
        return self._record_type.model_validate(obj)

    async def get_by_id(self, id: uuid.UUID) -> R | None:
        obj = await self._session.get(self._model, id)
        return self._to_record(obj) if obj else None

    async def list_all(self, offset: int = 0, limit: int = 50) -> list[R]:
        stmt = select(self._model).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    async def create(self, **kwargs) -> R:
        obj = self._model(**kwargs)
        self._session.add(obj)
        await self._session.flush()
        await self._session.refresh(obj)
        return self._to_record(obj)

    async def update_by_id(self, id: uuid.UUID, **kwargs) -> R | None:
        obj = await self._session.get(self._model, id)
        if not obj:
            return None
        for key, value in kwargs.items():
            setattr(obj, key, value)
        await self._session.flush()
        await self._session.refresh(obj)
        return self._to_record(obj)

    async def delete_by_id(self, id: uuid.UUID) -> bool:
        obj = await self._session.get(self._model, id)
        if not obj:
            return False
        await self._session.delete(obj)
        await self._session.flush()
        return True

    async def count(self) -> int:
        stmt = select(func.count()).select_from(self._model)
        result = await self._session.execute(stmt)
        return result.scalar_one()

    async def commit(self) -> None:
        await self._session.commit()

    async def rollback(self) -> None:
        await self._session.rollback()

    async def flush(self) -> None:
        await self._session.flush()

    async def ping(self) -> None:
        """Execute a trivial query to verify DB connectivity."""
        await self._session.execute(text("SELECT 1"))
