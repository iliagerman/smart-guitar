"""Scheduled unconfirmed-user cleanup Lambda.

Triggered by EventBridge every 6 hours.

Deletes UNCONFIRMED Cognito users older than 24 hours,
removes corresponding local DB records, and sends a Telegram summary.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from guitar_player.config import get_settings
from guitar_player.dao.user_dao import UserDAO
from guitar_player.database import safe_session
from guitar_player.lambdas.runtime import init_runtime
from guitar_player.request_context import request_id_var
from guitar_player.services.cognito_auth_service import CognitoAuthService
from guitar_player.services.telegram_service import TelegramService

logger = logging.getLogger(__name__)

_CUTOFF_HOURS = 24


async def _run() -> dict[str, Any]:
    settings = get_settings()
    cognito = CognitoAuthService(settings)
    telegram = TelegramService(settings.telegram)

    cutoff = datetime.now(timezone.utc) - timedelta(hours=_CUTOFF_HOURS)
    unconfirmed = cognito.list_unconfirmed_users()

    if not unconfirmed:
        logger.info("No unconfirmed users found")
        return {"ok": True, "deleted": 0, "checked": 0}

    deleted = 0
    emails: list[str] = []

    for cognito_user in unconfirmed:
        created = cognito_user["UserCreateDate"]
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created >= cutoff:
            continue  # Not old enough yet

        username = cognito_user["Username"]
        email = next(
            (a["Value"] for a in cognito_user.get("Attributes", []) if a["Name"] == "email"),
            username,
        )

        # Delete from Cognito
        try:
            cognito.admin_delete_user(username)
        except Exception:
            logger.exception("Failed to delete Cognito user %s", username)
            continue

        # Delete from local DB if exists
        try:
            async with safe_session() as session:
                user_dao = UserDAO(session)
                db_user = await user_dao.get_by_cognito_sub(username)
                if db_user:
                    await user_dao.delete(db_user)
                await session.commit()
        except Exception:
            logger.exception("Failed to delete local DB user for %s", username)

        deleted += 1
        emails.append(email)
        logger.info("Deleted unconfirmed user", extra={"email": email, "username": username})

    if deleted > 0:
        email_list = "\n".join(f"  - {e}" for e in emails)
        await telegram.send_event(
            f"<b>Unconfirmed user cleanup</b>\n"
            f"Deleted: {deleted} user(s)\n"
            f"{email_list}"
        )

    logger.info(
        "Unconfirmed user cleanup complete",
        extra={"deleted": deleted, "checked": len(unconfirmed)},
    )
    return {"ok": True, "deleted": deleted, "checked": len(unconfirmed)}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    init_runtime(service_name="unconfirmed-user-cleanup")

    request_id_var.set(str(uuid.uuid4()))

    try:
        return asyncio.run(_run())
    except Exception:
        logger.exception(
            "Unconfirmed user cleanup failed",
            extra={"event_type": "cleanup_error"},
        )
        return {"ok": False, "error": "cleanup_exception"}
