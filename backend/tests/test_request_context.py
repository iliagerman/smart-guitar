"""Unit tests for request context propagation (rid + user_id).

Verifies that:
- RequestContextFilter injects rid, request_id, user_id into log records.
- RequestContextFilter falls back to _PROCESS_REQUEST_ID when no request context.
- Backend middleware sets request_id_var from X-Request-ID header.
- ProcessingService._request propagates X-Request-ID and X-User-ID headers.
- _inject_request_id in lambda_invoke injects both request_id and user_id.
- Lambda handlers (job_orchestrator, vocals_guitar_stitch) extract user_id from event.
"""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── RequestContextFilter tests ──────────────────────────────────────


class TestRequestContextFilter:
    """Backend RequestContextFilter injects context fields into log records."""

    def test_filter_injects_rid_and_user_id(self):
        from guitar_player.request_context import (
            RequestContextFilter,
            request_id_var,
            user_id_var,
        )

        f = RequestContextFilter()
        record = logging.LogRecord("test", logging.INFO, "", 0, "msg", (), None)

        token_rid = request_id_var.set("abc-123")
        token_uid = user_id_var.set("user-42")
        try:
            f.filter(record)
        finally:
            request_id_var.reset(token_rid)
            user_id_var.reset(token_uid)

        assert record.request_id == "abc-123"  # type: ignore[attr-defined]
        assert record.rid == "abc-123"  # type: ignore[attr-defined]
        assert record.user_id == "user-42"  # type: ignore[attr-defined]

    def test_filter_uses_process_fallback_when_no_request_context(self):
        from guitar_player.request_context import (
            RequestContextFilter,
            _PROCESS_REQUEST_ID,
            request_id_var,
        )

        f = RequestContextFilter()
        record = logging.LogRecord("test", logging.INFO, "", 0, "msg", (), None)

        # Ensure request_id_var is empty (default).
        token = request_id_var.set("")
        try:
            f.filter(record)
        finally:
            request_id_var.reset(token)

        assert record.request_id == _PROCESS_REQUEST_ID  # type: ignore[attr-defined]
        assert record.rid == _PROCESS_REQUEST_ID  # type: ignore[attr-defined]


# ── Backend middleware tests ────────────────────────────────────────


class TestRequestContextMiddleware:
    """Backend ASGI middleware reads X-Request-ID and sets request_id_var."""

    @pytest.mark.asyncio
    async def test_middleware_sets_request_id_from_header(self):
        from guitar_player.middleware import RequestContextMiddleware
        from guitar_player.request_context import request_id_var

        captured_rid: str | None = None

        async def inner_app(scope, receive, send):
            nonlocal captured_rid
            captured_rid = request_id_var.get()
            await send(
                {"type": "http.response.start", "status": 200, "headers": []}
            )
            await send({"type": "http.response.body", "body": b""})

        mw = RequestContextMiddleware(inner_app)
        scope = {
            "type": "http",
            "headers": [(b"x-request-id", b"test-rid-from-header")],
        }
        await mw(scope, AsyncMock(), AsyncMock())

        assert captured_rid == "test-rid-from-header"

    @pytest.mark.asyncio
    async def test_middleware_generates_uuid_when_no_header(self):
        from guitar_player.middleware import RequestContextMiddleware
        from guitar_player.request_context import request_id_var

        captured_rid: str | None = None

        async def inner_app(scope, receive, send):
            nonlocal captured_rid
            captured_rid = request_id_var.get()
            await send(
                {"type": "http.response.start", "status": 200, "headers": []}
            )
            await send({"type": "http.response.body", "body": b""})

        mw = RequestContextMiddleware(inner_app)
        scope = {"type": "http", "headers": []}
        await mw(scope, AsyncMock(), AsyncMock())

        assert captured_rid
        assert len(captured_rid) == 36  # UUID4 format

    @pytest.mark.asyncio
    async def test_middleware_echoes_rid_in_response_header(self):
        from guitar_player.middleware import RequestContextMiddleware

        sent_messages: list[dict] = []

        async def inner_app(scope, receive, send):
            await send(
                {"type": "http.response.start", "status": 200, "headers": []}
            )
            await send({"type": "http.response.body", "body": b""})

        async def mock_send(message):
            sent_messages.append(message)

        mw = RequestContextMiddleware(inner_app)
        scope = {
            "type": "http",
            "headers": [(b"x-request-id", b"echo-me")],
        }
        await mw(scope, AsyncMock(), mock_send)

        response_start = sent_messages[0]
        header_dict = dict(response_start["headers"])
        assert header_dict[b"x-request-id"] == b"echo-me"

    @pytest.mark.asyncio
    async def test_middleware_resets_context_after_request(self):
        from guitar_player.middleware import RequestContextMiddleware
        from guitar_player.request_context import request_id_var

        token = request_id_var.set("before")

        async def inner_app(scope, receive, send):
            await send(
                {"type": "http.response.start", "status": 200, "headers": []}
            )
            await send({"type": "http.response.body", "body": b""})

        mw = RequestContextMiddleware(inner_app)
        scope = {
            "type": "http",
            "headers": [(b"x-request-id", b"during-request")],
        }
        await mw(scope, AsyncMock(), AsyncMock())

        # After middleware completes, request_id_var should be restored.
        assert request_id_var.get() == "before"
        request_id_var.reset(token)


# ── lambda_invoke tests ─────────────────────────────────────────────


class TestLambdaInvokeInjectRequestId:
    """_inject_request_id includes both request_id and user_id in payload."""

    def test_injects_request_id_and_user_id(self):
        from guitar_player.request_context import request_id_var, user_id_var
        from guitar_player.services.lambda_invoke import _inject_request_id

        token_rid = request_id_var.set("lambda-rid")
        token_uid = user_id_var.set("lambda-user")
        try:
            result = _inject_request_id({"job_id": "j1"})
        finally:
            request_id_var.reset(token_rid)
            user_id_var.reset(token_uid)

        assert result["job_id"] == "j1"
        assert result["request_id"] == "lambda-rid"
        assert result["user_id"] == "lambda-user"

    def test_injects_only_request_id_when_no_user(self):
        from guitar_player.request_context import request_id_var, user_id_var
        from guitar_player.services.lambda_invoke import _inject_request_id

        token_rid = request_id_var.set("rid-only")
        token_uid = user_id_var.set("")
        try:
            result = _inject_request_id({"job_id": "j2"})
        finally:
            request_id_var.reset(token_rid)
            user_id_var.reset(token_uid)

        assert result["request_id"] == "rid-only"
        assert "user_id" not in result

    def test_returns_original_when_no_context(self):
        from guitar_player.request_context import request_id_var, user_id_var
        from guitar_player.services.lambda_invoke import _inject_request_id

        token_rid = request_id_var.set("")
        token_uid = user_id_var.set("")
        try:
            payload = {"job_id": "j3"}
            result = _inject_request_id(payload)
        finally:
            request_id_var.reset(token_rid)
            user_id_var.reset(token_uid)

        assert result is payload


# ── ProcessingService header propagation tests ──────────────────────


class TestProcessingServiceHeaders:
    """ProcessingService._request sends X-Request-ID and X-User-ID headers."""

    @pytest.mark.asyncio
    async def test_request_sends_both_headers(self):
        from guitar_player.request_context import request_id_var, user_id_var

        token_rid = request_id_var.set("svc-rid")
        token_uid = user_id_var.set("svc-user")
        try:
            captured_headers: dict = {}

            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"ok": True}
            mock_response.raise_for_status = MagicMock()

            async def fake_post(url, json, headers):
                captured_headers.update(headers)
                return mock_response

            mock_client = AsyncMock()
            mock_client.post = fake_post
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)

            with patch("guitar_player.services.processing_service.httpx.AsyncClient", return_value=mock_client):
                from guitar_player.services.processing_service import ProcessingService

                settings = MagicMock()
                settings.services.inference_demucs = "localhost:8000"
                settings.services.chords_generator = "localhost:8001"
                settings.services.lyrics_generator = "localhost:8003"
                settings.services.tabs_generator = "localhost:8004"

                svc = ProcessingService(settings)
                await svc._request("http://localhost:8000/test", {"data": 1})

            assert captured_headers["X-Request-ID"] == "svc-rid"
            assert captured_headers["X-User-ID"] == "svc-user"
        finally:
            request_id_var.reset(token_rid)
            user_id_var.reset(token_uid)

    @pytest.mark.asyncio
    async def test_request_omits_user_id_header_when_empty(self):
        from guitar_player.request_context import request_id_var, user_id_var

        token_rid = request_id_var.set("svc-rid-2")
        token_uid = user_id_var.set("")
        try:
            captured_headers: dict = {}

            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"ok": True}
            mock_response.raise_for_status = MagicMock()

            async def fake_post(url, json, headers):
                captured_headers.update(headers)
                return mock_response

            mock_client = AsyncMock()
            mock_client.post = fake_post
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)

            with patch("guitar_player.services.processing_service.httpx.AsyncClient", return_value=mock_client):
                from guitar_player.services.processing_service import ProcessingService

                settings = MagicMock()
                settings.services.inference_demucs = "localhost:8000"
                settings.services.chords_generator = "localhost:8001"
                settings.services.lyrics_generator = "localhost:8003"
                settings.services.tabs_generator = "localhost:8004"

                svc = ProcessingService(settings)
                await svc._request("http://localhost:8000/test", {"data": 1})

            assert captured_headers["X-Request-ID"] == "svc-rid-2"
            assert "X-User-ID" not in captured_headers
        finally:
            request_id_var.reset(token_rid)
            user_id_var.reset(token_uid)


# ── Lambda handler tests ────────────────────────────────────────────


class TestJobOrchestratorHandler:
    """job_orchestrator.handler extracts user_id from event payload."""

    def test_handler_sets_user_id_from_event(self):
        from guitar_player.request_context import request_id_var, user_id_var

        # The handler sets context vars synchronously before asyncio.run,
        # so we can check them after the (mocked) handler returns.
        with (
            patch("guitar_player.lambdas.job_orchestrator.init_runtime"),
            patch("asyncio.run"),
        ):
            from guitar_player.lambdas.job_orchestrator import handler

            handler(
                {
                    "job_id": "00000000-0000-0000-0000-000000000001",
                    "request_id": "orch-rid",
                    "user_id": "orch-user",
                },
                None,
            )

            assert request_id_var.get() == "orch-rid"
            assert user_id_var.get() == "orch-user"

    def test_handler_tolerates_missing_user_id(self):
        from guitar_player.request_context import user_id_var

        # Reset to known state.
        token = user_id_var.set("should-not-change")
        try:
            with (
                patch("guitar_player.lambdas.job_orchestrator.init_runtime"),
                patch("asyncio.run"),
            ):
                from guitar_player.lambdas.job_orchestrator import handler

                result = handler(
                    {
                        "job_id": "00000000-0000-0000-0000-000000000002",
                        "request_id": "orch-rid-2",
                    },
                    None,
                )
                assert result["ok"] is True
                # user_id_var should remain unchanged (no user_id in event).
                assert user_id_var.get() == "should-not-change"
        finally:
            user_id_var.reset(token)


class TestVocalsGuitarStitchHandler:
    """vocals_guitar_stitch.handler extracts user_id from event payload."""

    def test_handler_sets_user_id_from_event(self):
        from guitar_player.request_context import request_id_var, user_id_var

        with (
            patch("guitar_player.lambdas.vocals_guitar_stitch.init_runtime"),
            patch("asyncio.run", return_value={"ok": True}),
        ):
            from guitar_player.lambdas.vocals_guitar_stitch import handler

            handler(
                {
                    "song_name": "test/song",
                    "vocals_key": "test/vocals.mp3",
                    "guitar_key": "test/guitar.mp3",
                    "request_id": "stitch-rid",
                    "user_id": "stitch-user",
                },
                None,
            )

            assert request_id_var.get() == "stitch-rid"
            assert user_id_var.get() == "stitch-user"

    def test_handler_tolerates_missing_user_id(self):
        from guitar_player.request_context import user_id_var

        token = user_id_var.set("should-not-change")
        try:
            with (
                patch("guitar_player.lambdas.vocals_guitar_stitch.init_runtime"),
                patch("asyncio.run", return_value={"ok": True}),
            ):
                from guitar_player.lambdas.vocals_guitar_stitch import handler

                result = handler(
                    {
                        "song_name": "test/song",
                        "vocals_key": "test/vocals.mp3",
                        "guitar_key": "test/guitar.mp3",
                        "request_id": "stitch-rid-2",
                    },
                    None,
                )
                assert result["ok"] is True
                assert user_id_var.get() == "should-not-change"
        finally:
            user_id_var.reset(token)
