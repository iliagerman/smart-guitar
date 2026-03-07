"""Helpers for invoking AWS Lambda from async code (ECS/Lambda).

We keep boto3 usage isolated and call it via asyncio.to_thread so we don't block
FastAPI's event loop.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import boto3

from guitar_player.request_context import request_id_var, user_id_var

logger = logging.getLogger(__name__)

_lambda_clients: dict[str, Any] = {}


def _client(region: str):
    # Cache per region.
    c = _lambda_clients.get(region)
    if c is None:
        c = boto3.client("lambda", region_name=region)
        _lambda_clients[region] = c
    return c


def _inject_request_id(payload: dict[str, Any]) -> dict[str, Any]:
    """Inject request_id and user_id into the payload for cross-service tracing."""
    extra: dict[str, Any] = {}
    rid = request_id_var.get()
    if rid:
        extra["request_id"] = rid
    uid = user_id_var.get()
    if uid:
        extra["user_id"] = uid
    return {**payload, **extra} if extra else payload


async def invoke_event(
    *,
    region: str,
    function_name: str,
    payload: dict[str, Any],
) -> None:
    """Invoke Lambda asynchronously (InvocationType=Event)."""

    data = json.dumps(_inject_request_id(payload)).encode("utf-8")

    def _invoke() -> None:
        _client(region).invoke(
            FunctionName=function_name,
            InvocationType="Event",
            Payload=data,
        )

    await asyncio.to_thread(_invoke)


async def invoke_request_response(
    *,
    region: str,
    function_name: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    """Invoke Lambda synchronously and return parsed JSON (best-effort)."""

    data = json.dumps(_inject_request_id(payload)).encode("utf-8")

    def _invoke() -> dict[str, Any] | None:
        resp = _client(region).invoke(
            FunctionName=function_name,
            InvocationType="RequestResponse",
            Payload=data,
        )
        body = resp.get("Payload")
        if not body:
            return None
        raw = body.read()
        try:
            return json.loads(raw)
        except Exception:
            logger.debug("Non-JSON lambda response: %r", raw[:200])
            return None

    return await asyncio.to_thread(_invoke)
