"""Dedicated auth for admin service endpoints.

These endpoints are *not* user-facing and do not use Cognito JWTs.
They are protected by a shared secret loaded from secrets.yml:

admin:
  api-key: "..."

Requests must include:
  Authorization: Bearer <api-key>
"""

import hmac
import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

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
