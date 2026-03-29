"""Helpers for non-blocking analytics event recording."""

import logging
import re
import uuid
from typing import Any

from fastapi import BackgroundTasks

from guitar_player.auth.schemas import CurrentUser
from guitar_player.dao.analytics_dao import AnalyticsDAO
from guitar_player.database import safe_session

logger = logging.getLogger(__name__)

_AWS_ACCOUNT_ID_RE = re.compile(r"^\d{12}$")


def analytics_identity_from_user(user: CurrentUser | None) -> dict[str, str | None]:
    username = user.username if user else None
    return {
        "user_sub": user.sub if user else None,
        "user_email": user.email if user else None,
        "tenant_id": None,
        "aws_account_id": username
        if username and _AWS_ACCOUNT_ID_RE.fullmatch(username)
        else None,
    }


async def _record_event_async(**kwargs: Any) -> None:
    async with safe_session() as session:
        dao = AnalyticsDAO(session)
        try:
            await dao.record_event(**kwargs)
            await dao.commit()
        except Exception:
            await dao.rollback()
            logger.exception(
                "Failed to record analytics event",
                extra={"event_type": kwargs.get("event_type")},
            )


async def _record_events_batch_async(events: list[dict[str, Any]]) -> None:
    if not events:
        return
    async with safe_session() as session:
        dao = AnalyticsDAO(session)
        try:
            await dao.record_events(events)
            await dao.commit()
        except Exception:
            await dao.rollback()
            logger.exception(
                "Failed to record analytics event batch",
                extra={"batch_size": len(events)},
            )


def sanitize_properties(properties: dict[str, Any] | None) -> dict[str, Any] | None:
    if not properties:
        return None
    cleaned: dict[str, Any] = {}
    for key, value in properties.items():
        if value is None:
            continue
        if key in {"user_sub", "user_email", "tenant_id", "aws_account_id"}:
            continue
        cleaned[key] = value
    return cleaned or None


def track_event(
    background_tasks: BackgroundTasks,
    *,
    event_type: str,
    event_category: str,
    event_source: str = "server",
    user_sub: str | None = None,
    user_email: str | None = None,
    tenant_id: str | None = None,
    aws_account_id: str | None = None,
    song_id: uuid.UUID | None = None,
    song_title: str | None = None,
    session_id: str | None = None,
    properties: dict[str, Any] | None = None,
) -> None:
    background_tasks.add_task(
        _record_event_async,
        event_type=event_type,
        event_category=event_category,
        event_source=event_source,
        user_sub=user_sub,
        user_email=user_email,
        tenant_id=tenant_id,
        aws_account_id=aws_account_id,
        song_id=song_id,
        song_title=song_title,
        session_id=session_id,
        properties=sanitize_properties(properties),
    )


def track_events_batch(
    background_tasks: BackgroundTasks,
    *,
    events: list[dict[str, Any]],
) -> None:
    sanitized_events = []
    for event in events:
        sanitized = dict(event)
        sanitized["properties"] = sanitize_properties(event.get("properties"))
        sanitized_events.append(sanitized)
    background_tasks.add_task(_record_events_batch_async, sanitized_events)
