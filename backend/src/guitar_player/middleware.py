"""ASGI middleware for request tracing context."""

import uuid

from starlette.types import ASGIApp, Receive, Scope, Send

from guitar_player.request_context import request_id_var


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
