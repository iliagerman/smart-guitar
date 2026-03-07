"""Unit tests for TelegramService."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from guitar_player.config import TelegramConfig
from guitar_player.services.telegram_service import TelegramService


# ── Fixtures ──────────────────────────────────────────────────────


@pytest.fixture
def enabled_config() -> TelegramConfig:
    return TelegramConfig(
        bot_token="test-bot-token",
        events_chat_id="111111",
        errors_chat_id="222222",
        enabled=True,
    )


@pytest.fixture
def disabled_config() -> TelegramConfig:
    return TelegramConfig(
        bot_token="test-bot-token",
        events_chat_id="111111",
        errors_chat_id="222222",
        enabled=False,
    )


@pytest.fixture
def no_token_config() -> TelegramConfig:
    return TelegramConfig(
        bot_token=None,
        events_chat_id="111111",
        errors_chat_id="222222",
        enabled=True,
    )


def _mock_response(status_code: int = 200, text: str = '{"ok":true}') -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        text=text,
        request=httpx.Request("POST", "https://example.com"),
    )


def _make_mock_client(response: httpx.Response | None = None, side_effect=None):
    """Build a mock httpx.AsyncClient suitable for use as an async context manager."""
    mock_client = AsyncMock()
    if side_effect:
        mock_client.post.side_effect = side_effect
    else:
        mock_client.post.return_value = response or _mock_response()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


# ── Test: send_event sends to events chat_id ─────────────────────


async def test_send_event_sends_to_events_chat_id(enabled_config: TelegramConfig):
    service = TelegramService(enabled_config)
    mock_client = _make_mock_client()

    with patch(
        "guitar_player.services.telegram_service.httpx.AsyncClient",
        return_value=mock_client,
    ):
        await service.send_event("Test event message")

    mock_client.post.assert_called_once()
    call_args = mock_client.post.call_args
    assert call_args[1]["json"]["chat_id"] == "111111"
    assert call_args[1]["json"]["text"] == "Test event message"
    assert "test-bot-token" in call_args[0][0]


# ── Test: send_error sends to errors chat_id ─────────────────────


async def test_send_error_sends_to_errors_chat_id(enabled_config: TelegramConfig):
    service = TelegramService(enabled_config)
    mock_client = _make_mock_client()

    with patch(
        "guitar_player.services.telegram_service.httpx.AsyncClient",
        return_value=mock_client,
    ):
        await service.send_error("Test error message")

    mock_client.post.assert_called_once()
    call_args = mock_client.post.call_args
    assert call_args[1]["json"]["chat_id"] == "222222"
    assert call_args[1]["json"]["text"] == "Test error message"


# ── Test: disabled mode makes no HTTP calls ──────────────────────


async def test_disabled_config_no_http_calls(disabled_config: TelegramConfig):
    service = TelegramService(disabled_config)

    with patch("guitar_player.services.telegram_service.httpx.AsyncClient") as mock_cls:
        await service.send_event("Should not send")
        await service.send_error("Should not send")

    mock_cls.assert_not_called()


# ── Test: no token config makes no HTTP calls ────────────────────


async def test_no_token_config_no_http_calls(no_token_config: TelegramConfig):
    service = TelegramService(no_token_config)

    with patch("guitar_player.services.telegram_service.httpx.AsyncClient") as mock_cls:
        await service.send_event("Should not send")
        await service.send_error("Should not send")

    mock_cls.assert_not_called()


# ── Test: HTTP failure does not propagate ────────────────────────


async def test_http_error_does_not_propagate(enabled_config: TelegramConfig):
    service = TelegramService(enabled_config)
    mock_client = _make_mock_client(side_effect=httpx.ConnectError("Connection refused"))

    with patch(
        "guitar_player.services.telegram_service.httpx.AsyncClient",
        return_value=mock_client,
    ):
        # Should NOT raise
        await service.send_event("Test message")
        await service.send_error("Test error")


# ── Test: non-200 response does not propagate ────────────────────


async def test_non_200_response_does_not_propagate(enabled_config: TelegramConfig):
    service = TelegramService(enabled_config)
    mock_client = _make_mock_client(response=_mock_response(status_code=403, text='{"ok":false}'))

    with patch(
        "guitar_player.services.telegram_service.httpx.AsyncClient",
        return_value=mock_client,
    ):
        # Should NOT raise
        await service.send_event("Test message")


# ── Test: message truncation ─────────────────────────────────────


async def test_message_truncated_to_4096_chars(enabled_config: TelegramConfig):
    service = TelegramService(enabled_config)
    mock_client = _make_mock_client()
    long_message = "x" * 5000

    with patch(
        "guitar_player.services.telegram_service.httpx.AsyncClient",
        return_value=mock_client,
    ):
        await service.send_event(long_message)

    call_args = mock_client.post.call_args
    sent_text = call_args[1]["json"]["text"]
    assert len(sent_text) == 4096


# ── Test: missing chat_id is a no-op ─────────────────────────────


async def test_missing_events_chat_id_is_noop():
    config = TelegramConfig(
        bot_token="token", events_chat_id=None, errors_chat_id="222", enabled=True
    )
    service = TelegramService(config)

    with patch("guitar_player.services.telegram_service.httpx.AsyncClient") as mock_cls:
        await service.send_event("Should not send")

    mock_cls.assert_not_called()


async def test_missing_errors_chat_id_is_noop():
    config = TelegramConfig(
        bot_token="token", events_chat_id="111", errors_chat_id=None, enabled=True
    )
    service = TelegramService(config)

    with patch("guitar_player.services.telegram_service.httpx.AsyncClient") as mock_cls:
        await service.send_error("Should not send")

    mock_cls.assert_not_called()


# ── Test: HTML parse_mode is set ─────────────────────────────────


async def test_parse_mode_is_html(enabled_config: TelegramConfig):
    service = TelegramService(enabled_config)
    mock_client = _make_mock_client()

    with patch(
        "guitar_player.services.telegram_service.httpx.AsyncClient",
        return_value=mock_client,
    ):
        await service.send_event("<b>Bold</b> message")

    call_args = mock_client.post.call_args
    assert call_args[1]["json"]["parse_mode"] == "HTML"
