"""ASGI middleware for request tracing context."""

import logging
import time
import uuid

from starlette.types import ASGIApp, Receive, Scope, Send

from guitar_player.request_context import request_id_var

logger = logging.getLogger(__name__)

_SLOW_REQUEST_THRESHOLD_S = 3.0


class RequestContextMiddleware:
    """Set a unique request_id for every HTTP request.

    * Reads ``X-Request-ID`` from incoming headers (upstream trace propagation).
    * Falls back to a new UUID4.
    * Echoes ``X-Request-ID`` on the response.
    * Resets the contextvar in ``finally`` so Lambda process reuse is safe.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        # Extract or generate request_id
        headers = dict(scope.get("headers", []))
        incoming_id = headers.get(b"x-request-id", b"").decode("latin-1").strip()
        rid = incoming_id or str(uuid.uuid4())

        token = request_id_var.set(rid)

        async def send_with_request_id(message: dict) -> None:
            if message["type"] == "http.response.start":
                resp_headers = list(message.get("headers", []))
                resp_headers.append((b"x-request-id", rid.encode("latin-1")))
                message["headers"] = resp_headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_var.reset(token)


class SlowRequestMiddleware:
    """Log a warning for any HTTP request that takes longer than the threshold."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status_code = 0

        async def capture_status(message: dict) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 0)
            await send(message)

        try:
            await self.app(scope, receive, capture_status)
        finally:
            elapsed = time.perf_counter() - start
            if elapsed >= _SLOW_REQUEST_THRESHOLD_S:
                method = scope.get("method", "?")
                path = scope.get("path", "?")
                qs = scope.get("query_string", b"").decode("latin-1")
                full_path = f"{path}?{qs}" if qs else path
                logger.warning(
                    "Slow request: %s %s took %.2fs status=%d",
                    method, full_path, elapsed, status_code,
                )
