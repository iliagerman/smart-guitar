"""Authorization dependency for analytics dashboard access."""

from fastapi import Depends, HTTPException, status

from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.config import Settings, get_settings


def is_analytics_user_allowed(user_email: str | None, settings: Settings) -> bool:
    normalized_email = (user_email or "").strip().lower()
    allowed_emails = {
        email.strip().lower()
        for email in settings.analytics.allowed_emails
        if email and email.strip()
    }
    return bool(normalized_email) and normalized_email in allowed_emails


async def require_analytics_admin(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if not is_analytics_user_allowed(user.email, settings):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Analytics access denied",
        )
    return user
