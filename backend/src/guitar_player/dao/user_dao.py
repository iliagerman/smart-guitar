"""User data access object."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.user import User

TRIAL_DURATION_DAYS = 14


class UserDAO(BaseDAO[User]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, User)

    async def get_by_cognito_sub(self, sub: str) -> User | None:
        stmt = select(User).where(User.cognito_sub == sub)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_or_create(self, sub: str, email: str) -> User:
        user = await self.get_by_cognito_sub(sub)
        if user:
            return user
        trial_ends = datetime.now(timezone.utc) + timedelta(days=TRIAL_DURATION_DAYS)
        return await self.create(cognito_sub=sub, email=email, trial_ends_at=trial_ends)
