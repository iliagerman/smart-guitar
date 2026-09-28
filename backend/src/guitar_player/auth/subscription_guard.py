"""Subscription access control dependencies.

Every signed-in member gets the free tier (library, setlists, practice, song
detail with chords/lyrics/tabs, the full mix and the guitar stem). Pro -- an
active trial, a paid subscription or a bypass email -- unlocks the rest.
"""

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser, MemberAccess
from guitar_player.config import Settings, get_settings
from guitar_player.dao.subscription_dao import SubscriptionDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.database import safe_session
from guitar_player.schemas.records import UserRecord
from guitar_player.services.telegram_service import TelegramService

logger = logging.getLogger(__name__)

SUBSCRIPTION_REQUIRED_DETAIL = {
    "error_code": "SUBSCRIPTION_REQUIRED",
    "message": "An active subscription is required to access this feature.",
}


def subscription_required() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail=SUBSCRIPTION_REQUIRED_DETAIL,
    )


def _is_bypass_user(email: str | None, settings: Settings) -> bool:
    normalized_email = (email or "").strip().lower()
    bypass_emails = {
        item.strip().lower()
        for item in settings.subscription_bypass_emails
        if isinstance(item, str) and item.strip()
    }
    return bool(normalized_email) and normalized_email in bypass_emails


def local_dev_access(settings: Settings) -> bool | None:
    """Pro access for local SKIP_AUTH=1 dev (free with LOCAL_FORCE_FREE=1); None elsewhere."""
    if settings.environment != "local" or os.environ.get("SKIP_AUTH") != "1":
        return None
    return os.environ.get("LOCAL_FORCE_FREE") != "1"


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


async def _provision_user(
    session: AsyncSession, user: CurrentUser, settings: Settings,
) -> UserRecord:
    """Create the local user row on first sight and announce the registration."""
    user_dao = UserDAO(session)
    is_new = (await user_dao.get_by_cognito_sub(user.sub)) is None
    db_user = await user_dao.get_or_create(user.sub, user.email)

    if is_new:
        is_google = (user.username or "").startswith("Google_") or user.sub.startswith("Google_") or user.sub.startswith("google")
        method = "Google OAuth" if is_google else "email/password"
        telegram = TelegramService(settings.telegram)
        await telegram.send_event(
            f"<b>New user registered</b>\nEmail: {user.email}\nMethod: {method}"
        )
    return db_user


async def has_pro_access(session: AsyncSession, db_user: UserRecord) -> bool:
    """Active trial (never subscribed), active subscription, or a canceled one still paid up."""
    subscription_dao = SubscriptionDAO(session)

    # If the user ever had a real subscription, trial no longer grants access.
    ever_subscribed = await subscription_dao.has_any_subscription(db_user.id)
    now = datetime.now(timezone.utc)
    if not ever_subscribed and db_user.trial_ends_at and db_user.trial_ends_at > now:
        return True

    if await subscription_dao.get_active_by_user(db_user.id):
        return True
    return await subscription_dao.get_canceled_with_access(db_user.id) is not None


async def resolve_pro_access(
    user: CurrentUser, settings: Settings, session: AsyncSession | None,
) -> bool:
    """Provision the member and report whether they have Pro access."""
    local_access = local_dev_access(settings)
    if local_access is not None:
        return local_access

    if _is_bypass_user(user.email, settings):
        return True

    async with _resolve_subscription_session(session) as active_session:
        db_user = await _provision_user(active_session, user, settings)
        is_pro = await has_pro_access(active_session, db_user)
        await active_session.commit()
    return is_pro


async def get_member_access(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    session: AsyncSession | None = Depends(_legacy_subscription_session),
) -> MemberAccess:
    """Any signed-in member; never raises for free-tier users."""
    is_pro = await resolve_pro_access(user, settings, session)
    return MemberAccess(user=user, is_pro=is_pro)


async def require_active_subscription(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    session: AsyncSession | None = Depends(_legacy_subscription_session),
) -> CurrentUser:
    """Pro-only endpoints: 403 SUBSCRIPTION_REQUIRED unless the member has Pro.

    In local dev with SKIP_AUTH=1, always grants access unless LOCAL_FORCE_FREE=1.
    """
    if not await resolve_pro_access(user, settings, session):
        raise subscription_required()
    return user
