"""Subscription access control dependency."""

import logging
import os
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.config import Settings, get_settings
from guitar_player.dao.subscription_dao import SubscriptionDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.dependencies import get_db
from guitar_player.services.telegram_service import TelegramService

logger = logging.getLogger(__name__)


async def require_active_subscription(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    """Verify the user has an active trial or subscription.

    Returns the CurrentUser if access is granted.
    Raises 403 with error_code SUBSCRIPTION_REQUIRED if not.

    In local dev with SKIP_AUTH=1, always grants access.
    """
    if settings.environment == "local" and os.environ.get("SKIP_AUTH") == "1":
        return user

    user_dao = UserDAO(session)
    is_new = (await user_dao.get_by_cognito_sub(user.sub)) is None
    db_user = await user_dao.get_or_create(user.sub, user.email)

    if is_new:
        logger.info("New user registered (Google OAuth): %s", user.email, extra={"email": user.email, "event_type": "user_registered"})
        telegram = TelegramService(settings.telegram)
        await telegram.send_event(
            f"<b>New user registered</b>\nEmail: {user.email}\nMethod: Google OAuth"
        )

    subscription_dao = SubscriptionDAO(session)

    # If the user ever had a real subscription, trial no longer grants access.
    ever_subscribed = await subscription_dao.has_any_subscription(db_user.id)

    if not ever_subscribed:
        # Check trial only for users who never subscribed
        now = datetime.now(timezone.utc)
        if db_user.trial_ends_at and db_user.trial_ends_at > now:
            return user

    # Check active subscription
    sub = await subscription_dao.get_active_by_user(db_user.id)
    if sub:
        return user

    # Check canceled subscription still within paid period
    canceled_sub = await subscription_dao.get_canceled_with_access(db_user.id)
    if canceled_sub:
        return user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error_code": "SUBSCRIPTION_REQUIRED",
            "message": "An active subscription is required to access this feature.",
        },
    )
