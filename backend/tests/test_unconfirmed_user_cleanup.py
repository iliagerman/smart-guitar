"""Unit tests for the unconfirmed-user cleanup Lambda.

Verifies that:
- Users created >24h ago with UNCONFIRMED status are deleted from Cognito and DB.
- Users created <24h ago are skipped.
- Cognito deletion failures are logged and skipped (not fatal).
- Telegram summary is sent only when users are actually deleted.
- Empty unconfirmed list is handled gracefully.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _make_cognito_user(
    username: str,
    email: str,
    created: datetime,
) -> dict:
    """Build a Cognito user dict matching the ListUsers API response shape."""
    return {
        "Username": username,
        "UserCreateDate": created,
        "UserStatus": "UNCONFIRMED",
        "Attributes": [
            {"Name": "email", "Value": email},
            {"Name": "sub", "Value": username},
        ],
    }


@pytest.mark.asyncio
async def test_deletes_stale_unconfirmed_users():
    """Users older than 24h are deleted from Cognito and DB."""
    stale_time = datetime.now(timezone.utc) - timedelta(hours=25)
    stale_user = _make_cognito_user("user-stale", "stale@test.com", stale_time)

    mock_cognito = MagicMock()
    mock_cognito.list_unconfirmed_users.return_value = [stale_user]
    mock_cognito.admin_delete_user.return_value = None

    mock_telegram = AsyncMock()

    mock_user_dao = AsyncMock()
    mock_user_dao.get_by_cognito_sub.return_value = None  # No local DB record

    mock_session = AsyncMock()
    mock_session.commit = AsyncMock()

    with (
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.get_settings"
        ) as mock_get_settings,
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.CognitoAuthService",
            return_value=mock_cognito,
        ),
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.TelegramService",
            return_value=mock_telegram,
        ),
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.safe_session"
        ) as mock_safe_session,
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.UserDAO",
            return_value=mock_user_dao,
        ),
    ):
        mock_get_settings.return_value = MagicMock()

        # Make safe_session work as an async context manager
        mock_safe_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_safe_session.return_value.__aexit__ = AsyncMock(return_value=False)

        from guitar_player.lambdas.unconfirmed_user_cleanup import _run

        result = await _run()

    assert result["ok"] is True
    assert result["deleted"] == 1
    assert result["checked"] == 1
    mock_cognito.admin_delete_user.assert_called_once_with("user-stale")
    mock_telegram.send_event.assert_called_once()
    msg = mock_telegram.send_event.call_args[0][0]
    assert "stale@test.com" in msg


@pytest.mark.asyncio
async def test_skips_recent_unconfirmed_users():
    """Users created <24h ago are NOT deleted."""
    recent_time = datetime.now(timezone.utc) - timedelta(hours=12)
    recent_user = _make_cognito_user("user-recent", "recent@test.com", recent_time)

    mock_cognito = MagicMock()
    mock_cognito.list_unconfirmed_users.return_value = [recent_user]

    mock_telegram = AsyncMock()

    with (
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.get_settings"
        ) as mock_get_settings,
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.CognitoAuthService",
            return_value=mock_cognito,
        ),
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.TelegramService",
            return_value=mock_telegram,
        ),
    ):
        mock_get_settings.return_value = MagicMock()

        from guitar_player.lambdas.unconfirmed_user_cleanup import _run

        result = await _run()

    assert result["ok"] is True
    assert result["deleted"] == 0
    assert result["checked"] == 1
    mock_cognito.admin_delete_user.assert_not_called()
    mock_telegram.send_event.assert_not_called()


@pytest.mark.asyncio
async def test_empty_unconfirmed_list():
    """No unconfirmed users — returns early, no Telegram message."""
    mock_cognito = MagicMock()
    mock_cognito.list_unconfirmed_users.return_value = []

    mock_telegram = AsyncMock()

    with (
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.get_settings"
        ) as mock_get_settings,
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.CognitoAuthService",
            return_value=mock_cognito,
        ),
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.TelegramService",
            return_value=mock_telegram,
        ),
    ):
        mock_get_settings.return_value = MagicMock()

        from guitar_player.lambdas.unconfirmed_user_cleanup import _run

        result = await _run()

    assert result["ok"] is True
    assert result["deleted"] == 0
    assert result["checked"] == 0
    mock_telegram.send_event.assert_not_called()


@pytest.mark.asyncio
async def test_cognito_delete_failure_continues():
    """If Cognito deletion fails for one user, others are still processed."""
    stale_time = datetime.now(timezone.utc) - timedelta(hours=30)
    user_fail = _make_cognito_user("user-fail", "fail@test.com", stale_time)
    user_ok = _make_cognito_user("user-ok", "ok@test.com", stale_time)

    mock_cognito = MagicMock()
    mock_cognito.list_unconfirmed_users.return_value = [user_fail, user_ok]
    mock_cognito.admin_delete_user.side_effect = [
        Exception("Cognito error"),  # First user fails
        None,  # Second user succeeds
    ]

    mock_telegram = AsyncMock()
    mock_user_dao = AsyncMock()
    mock_user_dao.get_by_cognito_sub.return_value = None
    mock_session = AsyncMock()
    mock_session.commit = AsyncMock()

    with (
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.get_settings"
        ) as mock_get_settings,
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.CognitoAuthService",
            return_value=mock_cognito,
        ),
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.TelegramService",
            return_value=mock_telegram,
        ),
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.safe_session"
        ) as mock_safe_session,
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.UserDAO",
            return_value=mock_user_dao,
        ),
    ):
        mock_get_settings.return_value = MagicMock()
        mock_safe_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_safe_session.return_value.__aexit__ = AsyncMock(return_value=False)

        from guitar_player.lambdas.unconfirmed_user_cleanup import _run

        result = await _run()

    assert result["ok"] is True
    assert result["deleted"] == 1  # Only the second user was deleted
    assert result["checked"] == 2
    assert mock_cognito.admin_delete_user.call_count == 2


@pytest.mark.asyncio
async def test_deletes_local_db_user_if_exists():
    """If the unconfirmed user has a local DB record, it's deleted too."""
    stale_time = datetime.now(timezone.utc) - timedelta(hours=25)
    stale_user = _make_cognito_user("user-with-db", "dbuser@test.com", stale_time)

    mock_cognito = MagicMock()
    mock_cognito.list_unconfirmed_users.return_value = [stale_user]
    mock_cognito.admin_delete_user.return_value = None

    mock_telegram = AsyncMock()

    mock_db_user = MagicMock()
    mock_user_dao = AsyncMock()
    mock_user_dao.get_by_cognito_sub.return_value = mock_db_user
    mock_user_dao.delete.return_value = None

    mock_session = AsyncMock()
    mock_session.commit = AsyncMock()

    with (
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.get_settings"
        ) as mock_get_settings,
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.CognitoAuthService",
            return_value=mock_cognito,
        ),
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.TelegramService",
            return_value=mock_telegram,
        ),
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.safe_session"
        ) as mock_safe_session,
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.UserDAO",
            return_value=mock_user_dao,
        ),
    ):
        mock_get_settings.return_value = MagicMock()
        mock_safe_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_safe_session.return_value.__aexit__ = AsyncMock(return_value=False)

        from guitar_player.lambdas.unconfirmed_user_cleanup import _run

        result = await _run()

    assert result["deleted"] == 1
    mock_user_dao.delete.assert_called_once_with(mock_db_user)


@pytest.mark.asyncio
async def test_mixed_stale_and_recent_users():
    """Only stale users are deleted; recent ones are skipped."""
    stale_time = datetime.now(timezone.utc) - timedelta(hours=48)
    recent_time = datetime.now(timezone.utc) - timedelta(hours=6)

    users = [
        _make_cognito_user("stale-1", "stale1@test.com", stale_time),
        _make_cognito_user("recent-1", "recent1@test.com", recent_time),
        _make_cognito_user("stale-2", "stale2@test.com", stale_time),
    ]

    mock_cognito = MagicMock()
    mock_cognito.list_unconfirmed_users.return_value = users
    mock_cognito.admin_delete_user.return_value = None

    mock_telegram = AsyncMock()
    mock_user_dao = AsyncMock()
    mock_user_dao.get_by_cognito_sub.return_value = None
    mock_session = AsyncMock()
    mock_session.commit = AsyncMock()

    with (
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.get_settings"
        ) as mock_get_settings,
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.CognitoAuthService",
            return_value=mock_cognito,
        ),
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.TelegramService",
            return_value=mock_telegram,
        ),
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.safe_session"
        ) as mock_safe_session,
        patch(
            "guitar_player.lambdas.unconfirmed_user_cleanup.UserDAO",
            return_value=mock_user_dao,
        ),
    ):
        mock_get_settings.return_value = MagicMock()
        mock_safe_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_safe_session.return_value.__aexit__ = AsyncMock(return_value=False)

        from guitar_player.lambdas.unconfirmed_user_cleanup import _run

        result = await _run()

    assert result["deleted"] == 2
    assert result["checked"] == 3
    # Only stale users should be deleted from Cognito
    delete_calls = [c[0][0] for c in mock_cognito.admin_delete_user.call_args_list]
    assert "stale-1" in delete_calls
    assert "stale-2" in delete_calls
    assert "recent-1" not in delete_calls
