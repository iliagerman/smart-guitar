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
        user = CurrentUser(sub="local-dev-user", email="dev@local.test", username="local-dev-user")
        if credentials:
            try:
                claims = jwt.get_unverified_claims(credentials.credentials)
                user = CurrentUser(
                    sub=claims.get("sub", "local-dev-user"),
                    email=claims.get("email", "dev@local.test"),
                    username=claims.get("username", claims.get("cognito:username", "")),
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
        email=claims.get("email", ""),
        username=claims.get("username", claims.get("cognito:username", "")),
    )
    user_id_var.set(user.sub)
    user_email_var.set(user.email)
    return user
