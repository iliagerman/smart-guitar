"""Admin authentication helpers.

Two auth mechanisms:

1. ``require_admin_token`` — shared-secret auth for service-to-service
   endpoints (``/admin/*``). Does NOT use Cognito JWTs.

2. ``require_admin_user`` — Cognito-authenticated user whose email is
   listed in ``admin_users`` config. Used for user-facing admin actions.
"""

import hmac
import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.config import Settings, get_settings

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


async def require_admin_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    """Authorize requests to the admin service endpoints."""

    expected = settings.admin.api_key
    if not expected:
        # Misconfiguration: endpoints exist but secret not set.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin API not configured",
        )

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization token",
        )

    token = credentials.credentials
    if not hmac.compare_digest(token, expected):
        logger.warning(
            "Admin auth failed: token length=%d expected length=%d "
            "token_prefix=%s expected_prefix=%s",
            len(token),
            len(expected),
            token[:4] + "…",
            expected[:4] + "…",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin token",
        )


async def require_admin_user(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    """Authorize Cognito-authenticated users listed in ``admin_users`` config."""
    if user.email not in settings.admin_users:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
