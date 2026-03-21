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

logger = logging.getLogger(__name__)


def _is_bypass_user(email: str | None, settings: Settings) -> bool:
    normalized_email = (email or "").strip().lower()
    bypass_emails = {
        item.strip().lower()
        for item in settings.subscription_bypass_emails
        if isinstance(item, str) and item.strip()
    }
    return bool(normalized_email) and normalized_email in bypass_emails


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

    if _is_bypass_user(user.email, settings):
        return user

    user_dao = UserDAO(session)
    db_user = await user_dao.get_or_create(user.sub, user.email)

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
