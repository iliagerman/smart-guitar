"""Telegram notification service — fire-and-forget notifications to Telegram channels."""

import logging

import httpx

from guitar_player.config import TelegramConfig

logger = logging.getLogger(__name__)

_MAX_MESSAGE_LENGTH = 4096
_TELEGRAM_API_BASE = "https://api.telegram.org"


class TelegramService:
    """Send notifications to Telegram channels.

    Fire-and-forget: all failures are logged but never raised.
    If disabled or unconfigured, all methods are silent no-ops.
    """

    def __init__(self, config: TelegramConfig) -> None:
        self._config = config

    @property
    def _is_active(self) -> bool:
        return bool(self._config.enabled and self._config.bot_token)

    async def send_event(self, message: str) -> None:
        """Send a notification to the events channel."""
        if not self._is_active or not self._config.events_chat_id:
            return
        await self._send(self._config.events_chat_id, message)

    async def send_error(self, message: str) -> None:
        """Send a notification to the errors channel."""
        if not self._is_active or not self._config.errors_chat_id:
            return
        await self._send(self._config.errors_chat_id, message)

    async def send_feedback(self, message: str) -> None:
        """Send a notification to the feedback channel."""
        if not self._is_active or not self._config.feedback_chat_id:
            return
        await self._send(self._config.feedback_chat_id, message)

    async def _send(self, chat_id: str, message: str) -> None:
        """Send a message via the Telegram Bot API. Never raises."""
        text = message[:_MAX_MESSAGE_LENGTH]
        url = f"{_TELEGRAM_API_BASE}/bot{self._config.bot_token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    url,
                    json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
                )
                if response.status_code != 200:
                    logger.warning(
                        "Telegram API returned %d: %s",
                        response.status_code,
                        response.text[:200],
                    )
        except Exception:
            logger.exception("Failed to send Telegram notification")
