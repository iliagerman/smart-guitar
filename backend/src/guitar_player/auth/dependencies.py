"""FastAPI auth dependencies."""

import logging
import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from guitar_player.auth.cognito import verify_token
from guitar_player.auth.schemas import CurrentUser
from guitar_player.config import Settings, get_settings
from guitar_player.request_context import user_email_var, user_id_var

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)


def _local_default_email(settings: Settings) -> str:
    for candidate in settings.subscription_bypass_emails:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip().lower()
    for candidate in settings.analytics.allowed_emails:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip().lower()
    return "dev@local.test"


def _claim_str(claims: dict, key: str) -> str:
    value = claims.get(key)
    return value.strip() if isinstance(value, str) else ""


def _extract_email(claims: dict, *, fallback: str = "") -> str:
    email = _claim_str(claims, "email")
    if email:
        return email

    username = _claim_str(claims, "username")
    cognito_username = _claim_str(claims, "cognito:username")

    for candidate in (username, cognito_username):
        if "@" in candidate:
            return candidate

    return fallback


def _extract_username(claims: dict, *, fallback: str = "") -> str:
    return (
        _claim_str(claims, "username")
        or _claim_str(claims, "cognito:username")
        or fallback
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    """Extract and verify the Bearer token, returning the current user.

    In local mode with SKIP_AUTH=1, decodes the token without signature
    verification to extract the real user info. Falls back to a dummy user
    if no token is present.
    """
    if settings.environment == "local" and os.environ.get("SKIP_AUTH") == "1":
        fallback_email = _local_default_email(settings)
        user = CurrentUser(
            sub="local-dev-user", email=fallback_email, username="local-dev-user"
        )
        if credentials:
            try:
                claims = jwt.get_unverified_claims(credentials.credentials)
                user = CurrentUser(
                    sub=claims.get("sub", "local-dev-user"),
                    email=_extract_email(claims, fallback=fallback_email),
                    username=_extract_username(claims, fallback="local-dev-user"),
                )
            except JWTError:
                pass  # fall back to dummy user
        user_id_var.set(user.sub)
        user_email_var.set(user.email)
        return user

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization token",
        )

    try:
        claims = verify_token(credentials.credentials, settings)
    except JWTError as e:
        logger.warning("JWT verification failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired token",
        )

    user = CurrentUser(
        sub=claims.get("sub", ""),
        email=_extract_email(claims),
        username=_extract_username(claims),
    )
    user_id_var.set(user.sub)
    user_email_var.set(user.email)
    return user
