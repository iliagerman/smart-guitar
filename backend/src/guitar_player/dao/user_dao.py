"""User data access object."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.user import User
from guitar_player.schemas.records import UserRecord

TRIAL_DURATION_DAYS = 14


class UserDAO(BaseDAO[User, UserRecord]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, User, UserRecord)

    async def get_by_cognito_sub(self, sub: str) -> UserRecord | None:
        stmt = select(User).where(User.cognito_sub == sub)
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def get_or_create(self, sub: str, email: str) -> UserRecord:
        user = await self.get_by_cognito_sub(sub)
        if user:
            return user

        trial_ends = datetime.now(timezone.utc) + timedelta(days=TRIAL_DURATION_DAYS)
        try:
            async with self._session.begin_nested():
                obj = User(cognito_sub=sub, email=email, trial_ends_at=trial_ends)
                self._session.add(obj)
                await self._session.flush()
                await self._session.refresh(obj)
                return self._to_record(obj)
        except IntegrityError:
            user = await self.get_by_cognito_sub(sub)
            if user:
                return user
            raise

    async def get_by_email(self, email: str) -> UserRecord | None:
        stmt = select(User).where(User.email == email)
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None
