"""Integration tests for Cognito auth: register → confirm → login → refresh.

Tests call CognitoAuthService directly against the real Cognito User Pool.
Each test generates a unique email and cleans up via admin_delete_user.

NOTE: Skipped by default — Cognito sandbox has a daily email limit (50/day).
Remove the pytestmark to run these tests manually.
"""

import uuid

import pytest
from jose import jwt

from guitar_player.auth.cognito import verify_token
from guitar_player.config import load_settings
from guitar_player.services.cognito_auth_service import CognitoAuthError, CognitoAuthService

pytestmark = pytest.mark.skip(reason="Cognito sandbox daily email limit — run manually")


def _unique_email() -> str:
    short = uuid.uuid4().hex[:8]
    return f"test-auth-{short}@test.example.com"


# Strong password that satisfies Cognito policy (upper, lower, digit, symbol, 8+)
STRONG_PASSWORD = "T3st!Pwd9xQ"


@pytest.fixture(scope="module")
def settings():
    return load_settings(app_env="test")


@pytest.fixture(scope="module")
def auth_service(settings) -> CognitoAuthService:
    return CognitoAuthService(settings)


# ── 1. Full flow: register → admin-confirm → login → verify tokens ──


def test_auth_full_flow(auth_service: CognitoAuthService, settings):
    email = _unique_email()
    try:
        # Register
        reg = auth_service.register(email, STRONG_PASSWORD)
        assert reg["user_sub"]
        assert reg["user_confirmed"] is False
        print(f"\n  Registered: {email} (sub={reg['user_sub']})")

        # Admin-confirm (skip email verification)
        auth_service.admin_confirm_user(email)
        print(f"  Admin-confirmed: {email}")

        # Login
        tokens = auth_service.login(email, STRONG_PASSWORD)
        assert tokens["access_token"]
        assert tokens["id_token"]
        assert tokens["refresh_token"]
        assert tokens["expires_in"] > 0
        print(f"  Login successful, expires_in={tokens['expires_in']}s")

        # Verify access token via JWKS
        access_claims = verify_token(tokens["access_token"], settings)
        assert access_claims["sub"] == reg["user_sub"]
        assert access_claims["token_use"] == "access"
        print(f"  Access token verified (sub={access_claims['sub']})")

        # Verify id token has correct email
        id_claims = verify_token(tokens["id_token"], settings)
        assert id_claims["email"] == email
        assert id_claims["token_use"] == "id"
        print(f"  ID token verified (email={id_claims['email']})")

    finally:
        _safe_delete(auth_service, email)


# ── 2. Duplicate email ──────────────────────────────────────────────


def test_register_duplicate_email(auth_service: CognitoAuthService):
    email = _unique_email()
    try:
        auth_service.register(email, STRONG_PASSWORD)
        print(f"\n  First registration OK: {email}")

        with pytest.raises(CognitoAuthError) as exc_info:
            auth_service.register(email, STRONG_PASSWORD)
        assert exc_info.value.code == "UsernameExistsException"
        print(f"  Duplicate correctly rejected: {exc_info.value.code}")

    finally:
        _safe_delete(auth_service, email)


# ── 3. Login without confirmation ───────────────────────────────────


def test_login_unconfirmed_user(auth_service: CognitoAuthService):
    email = _unique_email()
    try:
        auth_service.register(email, STRONG_PASSWORD)
        print(f"\n  Registered (unconfirmed): {email}")

        with pytest.raises(CognitoAuthError) as exc_info:
            auth_service.login(email, STRONG_PASSWORD)
        assert exc_info.value.code == "UserNotConfirmedException"
        print(f"  Login correctly rejected: {exc_info.value.code}")

    finally:
        _safe_delete(auth_service, email)


# ── 4. Wrong password ──────────────────────────────────────────────


def test_login_wrong_password(auth_service: CognitoAuthService):
    email = _unique_email()
    try:
        auth_service.register(email, STRONG_PASSWORD)
        auth_service.admin_confirm_user(email)
        print(f"\n  Registered + confirmed: {email}")

        with pytest.raises(CognitoAuthError) as exc_info:
            auth_service.login(email, "WrongPassword1!")
        assert exc_info.value.code == "NotAuthorizedException"
        print(f"  Wrong password correctly rejected: {exc_info.value.code}")

    finally:
        _safe_delete(auth_service, email)


# ── 5. Weak password policy ────────────────────────────────────────


def test_invalid_password_policy(auth_service: CognitoAuthService):
    email = _unique_email()
    try:
        with pytest.raises(CognitoAuthError) as exc_info:
            auth_service.register(email, "weak")
        assert exc_info.value.code == "InvalidPasswordException"
        print(f"\n  Weak password correctly rejected: {exc_info.value.code}")

    finally:
        _safe_delete(auth_service, email)


# ── 6. Refresh token flow ──────────────────────────────────────────


def test_refresh_token_flow(auth_service: CognitoAuthService, settings):
    email = _unique_email()
    try:
        auth_service.register(email, STRONG_PASSWORD)
        auth_service.admin_confirm_user(email)
        tokens = auth_service.login(email, STRONG_PASSWORD)
        print(f"\n  Logged in: {email}")

        # Refresh
        refreshed = auth_service.refresh_tokens(tokens["refresh_token"])
        assert refreshed["access_token"]
        assert refreshed["id_token"]
        assert refreshed["expires_in"] > 0
        # New tokens should be different from original
        assert refreshed["access_token"] != tokens["access_token"]
        print(f"  Tokens refreshed (new expires_in={refreshed['expires_in']}s)")

        # Verify the refreshed access token
        claims = verify_token(refreshed["access_token"], settings)
        assert claims["token_use"] == "access"
        print(f"  Refreshed access token verified (sub={claims['sub']})")

    finally:
        _safe_delete(auth_service, email)


# ── Helper ──────────────────────────────────────────────────────────


def _safe_delete(auth_service: CognitoAuthService, email: str) -> None:
    """Best-effort cleanup of test user."""
    try:
        auth_service.admin_delete_user(email)
        print(f"  Cleaned up: {email}")
    except Exception:
        pass
