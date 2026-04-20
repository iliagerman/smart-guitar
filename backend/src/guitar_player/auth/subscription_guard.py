"""Subscription access control dependency."""

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.config import Settings, get_settings
from guitar_player.dao.subscription_dao import SubscriptionDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.database import safe_session
from guitar_player.services.telegram_service import TelegramService

logger = logging.getLogger(__name__)


def _is_bypass_user(email: str | None, settings: Settings) -> bool:
    normalized_email = (email or "").strip().lower()
    bypass_emails = {
        item.strip().lower()
        for item in settings.subscription_bypass_emails
        if isinstance(item, str) and item.strip()
    }
    return bool(normalized_email) and normalized_email in bypass_emails


def _legacy_subscription_session() -> None:
    """Keep direct unit-test calls compatible without opening a request DB session."""
    return None


@asynccontextmanager
async def _resolve_subscription_session(
    session: AsyncSession | None,
) -> AsyncIterator[AsyncSession]:
    if session is not None:
        yield session
        return

    async with safe_session() as managed_session:
        yield managed_session


async def require_active_subscription(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    session: AsyncSession | None = Depends(_legacy_subscription_session),
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

    async with _resolve_subscription_session(session) as active_session:
        user_dao = UserDAO(active_session)
        is_new = (await user_dao.get_by_cognito_sub(user.sub)) is None
        db_user = await user_dao.get_or_create(user.sub, user.email)

        if is_new:
            is_google = (user.username or "").startswith("Google_") or user.sub.startswith("Google_") or user.sub.startswith("google")
            method = "Google OAuth" if is_google else "email/password"
            telegram = TelegramService(settings.telegram)
            await telegram.send_event(
                f"<b>New user registered</b>\nEmail: {user.email}\nMethod: {method}"
            )

        subscription_dao = SubscriptionDAO(active_session)

        # If the user ever had a real subscription, trial no longer grants access.
        ever_subscribed = await subscription_dao.has_any_subscription(db_user.id)

        if not ever_subscribed:
            now = datetime.now(timezone.utc)
            if db_user.trial_ends_at and db_user.trial_ends_at > now:
                await active_session.commit()
                return user

        sub = await subscription_dao.get_active_by_user(db_user.id)
        if sub:
            await active_session.commit()
            return user

        canceled_sub = await subscription_dao.get_canceled_with_access(db_user.id)
        if canceled_sub:
            await active_session.commit()
            return user

        await active_session.commit()

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error_code": "SUBSCRIPTION_REQUIRED",
            "message": "An active subscription is required to access this feature.",
        },
    )
