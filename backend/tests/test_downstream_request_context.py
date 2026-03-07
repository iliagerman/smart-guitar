"""Unit tests for downstream service request_context modules.

All four downstream services (chords_generator, tabs_generator,
inference_demucs, lyrics_generator) share the same request_context pattern.
These tests import each service's module to verify they all:

- Have _PROCESS_REQUEST_ID fallback for startup/shutdown logs.
- Set record.rid alias alongside record.request_id.
- Inject record.user_id from user_id_var.
- Read X-User-ID header in the middleware.
"""

from __future__ import annotations

import importlib
import logging
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

# Add each downstream service's src directory to sys.path so we can import
# their request_context modules directly (they're separate packages not
# installed in the backend's venv).
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
for _svc in ("chords_generator", "tabs_generator", "inference_demucs", "lyrics_generator"):
    _src = str(_PROJECT_ROOT / _svc / "src")
    if _src not in sys.path:
        sys.path.insert(0, _src)


# Parametrize over all four downstream services.
SERVICE_MODULES = [
    "chords_generator.request_context",
    "tabs_generator.request_context",
    "inference_demucs.request_context",
    "lyrics_generator.request_context",
]


def _import_module(module_name: str):
    """Dynamically import a downstream service's request_context module."""
    return importlib.import_module(module_name)


@pytest.mark.parametrize("module_name", SERVICE_MODULES)
class TestDownstreamRequestContextFilter:
    """RequestContextFilter in each downstream service sets rid, request_id, user_id."""

    def test_filter_sets_rid_and_user_id(self, module_name: str):
        mod = _import_module(module_name)

        f = mod.RequestContextFilter()
        record = logging.LogRecord("test", logging.INFO, "", 0, "msg", (), None)

        token_rid = mod.request_id_var.set("downstream-rid")
        token_uid = mod.user_id_var.set("downstream-user")
        try:
            f.filter(record)
        finally:
            mod.request_id_var.reset(token_rid)
            mod.user_id_var.reset(token_uid)

        assert record.request_id == "downstream-rid"  # type: ignore[attr-defined]
        assert record.rid == "downstream-rid"  # type: ignore[attr-defined]
        assert record.user_id == "downstream-user"  # type: ignore[attr-defined]

    def test_filter_uses_process_fallback(self, module_name: str):
        mod = _import_module(module_name)

        f = mod.RequestContextFilter()
        record = logging.LogRecord("test", logging.INFO, "", 0, "msg", (), None)

        token = mod.request_id_var.set("")
        try:
            f.filter(record)
        finally:
            mod.request_id_var.reset(token)

        assert record.request_id == mod._PROCESS_REQUEST_ID  # type: ignore[attr-defined]
        assert record.rid == mod._PROCESS_REQUEST_ID  # type: ignore[attr-defined]


@pytest.mark.parametrize("module_name", SERVICE_MODULES)
class TestDownstreamRequestContextMiddleware:
    """RequestContextMiddleware reads X-Request-ID and X-User-ID headers."""

    @pytest.mark.asyncio
    async def test_middleware_sets_rid_and_uid_from_headers(self, module_name: str):
        mod = _import_module(module_name)

        captured_rid: str | None = None
        captured_uid: str | None = None

        async def inner_app(scope, receive, send):
            nonlocal captured_rid, captured_uid
            captured_rid = mod.request_id_var.get()
            captured_uid = mod.user_id_var.get()
            await send(
                {"type": "http.response.start", "status": 200, "headers": []}
            )
            await send({"type": "http.response.body", "body": b""})

        mw = mod.RequestContextMiddleware(inner_app)
        scope = {
            "type": "http",
            "headers": [
                (b"x-request-id", b"prop-rid"),
                (b"x-user-id", b"prop-user"),
            ],
        }
        await mw(scope, AsyncMock(), AsyncMock())

        assert captured_rid == "prop-rid"
        assert captured_uid == "prop-user"

    @pytest.mark.asyncio
    async def test_middleware_resets_context_after_request(self, module_name: str):
        mod = _import_module(module_name)

        token_rid = mod.request_id_var.set("before-rid")
        token_uid = mod.user_id_var.set("before-uid")

        async def inner_app(scope, receive, send):
            await send(
                {"type": "http.response.start", "status": 200, "headers": []}
            )
            await send({"type": "http.response.body", "body": b""})

        mw = mod.RequestContextMiddleware(inner_app)
        scope = {
            "type": "http",
            "headers": [
                (b"x-request-id", b"during-rid"),
                (b"x-user-id", b"during-uid"),
            ],
        }
        await mw(scope, AsyncMock(), AsyncMock())

        # Context vars should be restored to pre-middleware values.
        assert mod.request_id_var.get() == "before-rid"
        assert mod.user_id_var.get() == "before-uid"

        mod.request_id_var.reset(token_rid)
        mod.user_id_var.reset(token_uid)

    @pytest.mark.asyncio
    async def test_middleware_handles_missing_user_id_header(self, module_name: str):
        mod = _import_module(module_name)

        captured_uid: str | None = None

        async def inner_app(scope, receive, send):
            nonlocal captured_uid
            captured_uid = mod.user_id_var.get()
            await send(
                {"type": "http.response.start", "status": 200, "headers": []}
            )
            await send({"type": "http.response.body", "body": b""})

        mw = mod.RequestContextMiddleware(inner_app)
        scope = {
            "type": "http",
            "headers": [(b"x-request-id", b"only-rid")],
        }
        await mw(scope, AsyncMock(), AsyncMock())

        # user_id should be empty string (from empty header), not crash.
        assert captured_uid == ""
