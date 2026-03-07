"""Cognito JWT verification via JWKS."""

import logging
from functools import lru_cache

import httpx
from jose import JWTError, jwt

from guitar_player.config import Settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _fetch_jwks(region: str, user_pool_id: str) -> dict:
    """Fetch and cache JWKS from Cognito."""
    url = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"
    resp = httpx.get(url, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _get_signing_key(token: str, jwks: dict) -> dict:
    """Match the token's kid to a key in the JWKS."""
    unverified_header = jwt.get_unverified_header(token)
    kid = unverified_header.get("kid")
    for key in jwks.get("keys", []):
        if key["kid"] == kid:
            return key
    raise JWTError(f"No matching key found for kid: {kid}")


def verify_token(token: str, settings: Settings) -> dict:
    """Verify a Cognito JWT and return the decoded claims.

    Handles both access tokens (which use ``client_id`` instead of ``aud``)
    and id tokens (which carry a standard ``aud`` claim).

    Raises JWTError on any validation failure.
    """
    cognito = settings.cognito
    if not cognito.user_pool_id or not cognito.client_id:
        raise JWTError("Cognito not configured")

    jwks = _fetch_jwks(cognito.region, cognito.user_pool_id)
    signing_key = _get_signing_key(token, jwks)

    issuer = f"https://cognito-idp.{cognito.region}.amazonaws.com/{cognito.user_pool_id}"

    # Peek at unverified claims to determine token type
    unverified = jwt.get_unverified_claims(token)
    token_use = unverified.get("token_use")

    if token_use == "access":
        # Access tokens have no ``aud`` claim; verify ``client_id`` manually
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False},
        )
        if claims.get("client_id") != cognito.client_id:
            raise JWTError("Token client_id does not match")
    else:
        # ID tokens carry a standard ``aud`` claim
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=cognito.client_id,
            issuer=issuer,
        )

    return claims
