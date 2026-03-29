"""Subscription data access object."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.subscription import Subscription
from guitar_player.schemas.records import SubscriptionRecord


class SubscriptionDAO(BaseDAO[Subscription, SubscriptionRecord]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Subscription, SubscriptionRecord)

    async def get_active_by_user(self, user_id: uuid.UUID) -> SubscriptionRecord | None:
        stmt = select(Subscription).where(
            and_(
                Subscription.user_id == user_id,
                Subscription.status.in_(["active", "trialing", "past_due"]),
            )
        )
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def get_by_external_id(
        self, provider: str, external_sub_id: str
    ) -> SubscriptionRecord | None:
        stmt = select(Subscription).where(
            and_(
                Subscription.provider == provider,
                Subscription.external_subscription_id == external_sub_id,
            )
        )
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def get_pending_by_user(self, user_id: uuid.UUID) -> SubscriptionRecord | None:
        stmt = (
            select(Subscription)
            .where(
                and_(
                    Subscription.user_id == user_id,
                    Subscription.status == "pending",
                )
            )
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def get_by_user(self, user_id: uuid.UUID) -> SubscriptionRecord | None:
        stmt = (
            select(Subscription)
            .where(Subscription.user_id == user_id)
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def has_any_subscription(self, user_id: uuid.UUID) -> bool:
        stmt = select(Subscription.id).where(
            and_(
                Subscription.user_id == user_id,
                Subscription.status != "pending",
            )
        ).limit(1)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def get_canceled_with_access(self, user_id: uuid.UUID) -> SubscriptionRecord | None:
        now = datetime.now(timezone.utc)
        stmt = select(Subscription).where(
            and_(
                Subscription.user_id == user_id,
                Subscription.status == "canceled",
                Subscription.current_period_end > now,
            )
        ).order_by(Subscription.current_period_end.desc()).limit(1)
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None
