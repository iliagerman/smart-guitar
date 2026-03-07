"""Per-request context for correlation ID tracing.

Mirrors the backend's request_context module so logs emitted by the
tabs_generator include the same ``request_id`` field, enabling
cross-service trace correlation.
"""

import logging
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp, Receive, Scope, Send

# Correlation ID propagated via X-Request-ID header.
request_id_var: ContextVar[str] = ContextVar("request_id", default="")

# Fallback ID for logs emitted outside a request context (startup/shutdown).
_PROCESS_REQUEST_ID = str(uuid.uuid4())

# User ID propagated via X-User-ID header from the backend.
user_id_var: ContextVar[str] = ContextVar("user_id", default="")


class RequestContextFilter(logging.Filter):
    """Inject request_id into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        rid = request_id_var.get()
        record.request_id = rid or _PROCESS_REQUEST_ID  # type: ignore[attr-defined]
        # Ops compatibility: many dashboards use 'rid' as the field name.
        record.rid = record.request_id  # type: ignore[attr-defined]
        record.user_id = user_id_var.get()  # type: ignore[attr-defined]
        return True


class RequestContextMiddleware:
    """ASGI middleware that reads/generates a correlation ID per request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        incoming_id = headers.get(b"x-request-id", b"").decode("latin-1").strip()
        rid = incoming_id or str(uuid.uuid4())

        incoming_uid = headers.get(b"x-user-id", b"").decode("latin-1").strip()

        token = request_id_var.set(rid)
        uid_token = user_id_var.set(incoming_uid)

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
            user_id_var.reset(uid_token)
