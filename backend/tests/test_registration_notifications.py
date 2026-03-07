"""Unit tests for registration notification placement.

Verifies that:
- POST /auth/register does NOT send a Telegram notification.
- POST /auth/confirm DOES send a Telegram notification.
- Subscription guard sends a notification for new Google OAuth users.
- Subscription guard does NOT send a notification for existing users.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from guitar_player.routers.auth import router as auth_router
from guitar_player.services.cognito_auth_service import CognitoAuthService
from guitar_player.services.telegram_service import TelegramService


# ── Fixtures ──────────────────────────────────────────────────────


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(auth_router)
    return app


@pytest.fixture
def mock_cognito() -> MagicMock:
    svc = MagicMock(spec=CognitoAuthService)
    svc.register.return_value = {
        "user_sub": "sub-123",
        "user_confirmed": False,
        "code_delivery": None,
    }
    svc.confirm.return_value = None
    return svc


@pytest.fixture
def mock_telegram() -> AsyncMock:
    return AsyncMock(spec=TelegramService)


@pytest.fixture
def client(mock_cognito, mock_telegram) -> TestClient:
    app = _make_app()

    app.dependency_overrides[
        __import__(
            "guitar_player.dependencies", fromlist=["get_cognito_auth_service"]
        ).get_cognito_auth_service
    ] = lambda: mock_cognito
    app.dependency_overrides[
        __import__(
            "guitar_player.dependencies", fromlist=["get_telegram_service"]
        ).get_telegram_service
    ] = lambda: mock_telegram

    return TestClient(app)


# ── Tests: /auth/register ────────────────────────────────────────


def test_register_does_not_send_telegram(client, mock_telegram, mock_cognito):
    """POST /auth/register should NOT send a Telegram notification."""
    resp = client.post(
        "/auth/register",
        json={"email": "user@example.com", "password": "T3st!Pwd9xQ"},
    )
    assert resp.status_code == 201
    mock_cognito.register.assert_called_once_with("user@example.com", "T3st!Pwd9xQ")
    mock_telegram.send_event.assert_not_called()


# ── Tests: /auth/confirm ─────────────────────────────────────────


def test_confirm_sends_telegram(client, mock_telegram, mock_cognito):
    """POST /auth/confirm SHOULD send a Telegram notification."""
    resp = client.post(
        "/auth/confirm",
        json={"email": "user@example.com", "confirmation_code": "123456"},
    )
    assert resp.status_code == 200
    mock_cognito.confirm.assert_called_once_with("user@example.com", "123456")
    mock_telegram.send_event.assert_called_once()

    msg = mock_telegram.send_event.call_args[0][0]
    assert "user@example.com" in msg
    assert "email/password" in msg


# ── Tests: subscription guard (Google OAuth) ─────────────────────


@pytest.mark.asyncio
async def test_subscription_guard_notifies_new_google_oauth_user():
    """New user (not in DB) triggers a Telegram notification."""
    from guitar_player.auth.schemas import CurrentUser
    from guitar_player.config import TelegramConfig

    mock_user_dao = AsyncMock()
    mock_user_dao.get_by_cognito_sub.return_value = None  # User doesn't exist
    mock_db_user = MagicMock()
    mock_db_user.trial_ends_at = None
    mock_user_dao.get_or_create.return_value = mock_db_user

    mock_sub_dao = AsyncMock()
    mock_sub_dao.get_active_by_user.return_value = MagicMock()  # Has subscription

    mock_settings = MagicMock()
    mock_settings.environment = "prod"
    mock_settings.telegram = TelegramConfig(
        bot_token="test", events_chat_id="111", enabled=True
    )

    user = CurrentUser(sub="google-sub-123", email="google@gmail.com")

    with (
        patch("guitar_player.auth.subscription_guard.UserDAO", return_value=mock_user_dao),
        patch("guitar_player.auth.subscription_guard.SubscriptionDAO", return_value=mock_sub_dao),
        patch("guitar_player.auth.subscription_guard.TelegramService") as mock_tg_cls,
    ):
        mock_tg_instance = AsyncMock()
        mock_tg_cls.return_value = mock_tg_instance

        from guitar_player.auth.subscription_guard import require_active_subscription

        # Call the dependency directly (simulating DI)
        result = await require_active_subscription.__wrapped__(
            user=user,
            session=AsyncMock(),
            settings=mock_settings,
        ) if hasattr(require_active_subscription, "__wrapped__") else None

        # If __wrapped__ doesn't exist, call it differently
        if result is None:
            result = await require_active_subscription(
                user=user,
                session=AsyncMock(),
                settings=mock_settings,
            )

        mock_user_dao.get_by_cognito_sub.assert_called_once_with("google-sub-123")
        mock_user_dao.get_or_create.assert_called_once_with("google-sub-123", "google@gmail.com")
        mock_tg_instance.send_event.assert_called_once()

        msg = mock_tg_instance.send_event.call_args[0][0]
        assert "google@gmail.com" in msg
        assert "Google OAuth" in msg


@pytest.mark.asyncio
async def test_subscription_guard_does_not_notify_existing_user():
    """Existing user (already in DB) should NOT trigger a notification."""
    from guitar_player.auth.schemas import CurrentUser
    from guitar_player.config import TelegramConfig

    mock_db_user = MagicMock()
    mock_db_user.trial_ends_at = None

    mock_user_dao = AsyncMock()
    mock_user_dao.get_by_cognito_sub.return_value = mock_db_user  # User exists
    mock_user_dao.get_or_create.return_value = mock_db_user

    mock_sub_dao = AsyncMock()
    mock_sub_dao.get_active_by_user.return_value = MagicMock()  # Has subscription

    mock_settings = MagicMock()
    mock_settings.environment = "prod"
    mock_settings.telegram = TelegramConfig(
        bot_token="test", events_chat_id="111", enabled=True
    )

    user = CurrentUser(sub="existing-sub-456", email="existing@gmail.com")

    with (
        patch("guitar_player.auth.subscription_guard.UserDAO", return_value=mock_user_dao),
        patch("guitar_player.auth.subscription_guard.SubscriptionDAO", return_value=mock_sub_dao),
        patch("guitar_player.auth.subscription_guard.TelegramService") as mock_tg_cls,
    ):
        mock_tg_instance = AsyncMock()
        mock_tg_cls.return_value = mock_tg_instance

        from guitar_player.auth.subscription_guard import require_active_subscription

        result = await require_active_subscription.__wrapped__(
            user=user,
            session=AsyncMock(),
            settings=mock_settings,
        ) if hasattr(require_active_subscription, "__wrapped__") else None

        if result is None:
            result = await require_active_subscription(
                user=user,
                session=AsyncMock(),
                settings=mock_settings,
            )

        mock_tg_instance.send_event.assert_not_called()
