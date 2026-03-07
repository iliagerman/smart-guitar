"""FastAPI application entry point with Mangum Lambda handler."""

import html
import logging
import re
import sys
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from mangum import Mangum
from pythonjsonlogger.json import JsonFormatter
from starlette.middleware.cors import CORSMiddleware

from sqlalchemy import update

from guitar_player.config import get_settings
from guitar_player.middleware import RequestContextMiddleware
from guitar_player.request_context import RequestContextFilter
from guitar_player.database import close_db, init_db
from guitar_player.dependencies import set_storage
from guitar_player.exceptions import AlreadyExistsError, BadRequestError, NotFoundError
from guitar_player.models.job import Job
from guitar_player.models.song import Song
from guitar_player.routers import (
    admin,
    auth,
    favorites,
    health,
    jobs,
    songs,
    subscription,
)
from guitar_player.services.telegram_service import TelegramService
from guitar_player.services.job_service import start_startup_admin_heal
from guitar_player.services.sync_service import ensure_default_user, sync_local_bucket
from guitar_player.storage import create_storage

logger = logging.getLogger(__name__)

DEFAULT_LOCAL_EMAIL = "iliagerman@gmail.com"


class _PollFilter(logging.Filter):
    """Suppress or downgrade repetitive uvicorn access-log lines."""

    _SONG_POLL_RE = re.compile(
        r"GET /api/v1/songs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    )

    # Endpoints demoted from INFO → DEBUG (still logged, just quieter)
    _DEMOTE_TO_DEBUG = (
        "GET /api/v1/subscription/status",
        "GET /api/v1/favorites",
    )

    # Substrings that identify automated vulnerability scanners / spam probes.
    # These requests already get 404s; no need to log them.
    _SCANNER_PATTERNS = (
        "/SDK/webLanguage",
        "allow_url_include",
        "auto_prepend_file",
        "/hello.world",
        "/vendor/phpunit",
        "/wp-login",
        "/wp-admin",
        "/wp-includes",
        "/.env",
        "/cgi-bin",
        "/boaform",
        "/solr/",
        "/actuator",
        "/remote/fgt_lang",
    )

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if "GET /health" in msg:
            return False
        if "GET /api/v1/admin/jobs/" in msg or "GET /api/v1/jobs/" in msg:
            return False
        if self._SONG_POLL_RE.search(msg):
            return False
        # Drop known scanner / spam probe requests
        for pattern in self._SCANNER_PATTERNS:
            if pattern in msg:
                return False
        # Drop requests to non-API paths that return 404 (probes to /, /favicon.ico, etc.)
        if '" 404' in msg and "/api/" not in msg and "/health" not in msg:
            return False
        for pattern in self._DEMOTE_TO_DEBUG:
            if pattern in msg:
                record.levelno = logging.DEBUG
                record.levelname = "DEBUG"
                return True
        return True


def _setup_logging(level: str = "INFO", service_name: str = "backend-api") -> None:
    """Configure JSON structured logging for CloudWatch."""
    handler = logging.StreamHandler(sys.stdout)
    formatter = JsonFormatter(
        fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"asctime": "timestamp", "levelname": "level", "name": "logger"},
        static_fields={"service": service_name},
    )
    handler.setFormatter(formatter)
    handler.addFilter(RequestContextFilter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Force uvicorn loggers to propagate through root (JSON formatter + timestamps)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers.clear()
        uv_logger.propagate = True

    # Silence repetitive polling access logs
    logging.getLogger("uvicorn.access").addFilter(_PollFilter())


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize DB and storage on startup, cleanup on shutdown."""
    settings = get_settings()

    _setup_logging(level=settings.app.log_level)

    # Init database
    session_factory = init_db(settings)
    logger.info("Database initialized")

    # Init storage
    storage = create_storage(settings)
    storage.init()
    set_storage(storage)
    logger.info("Storage initialized (%s)", settings.storage.backend)

    # Mark stale PENDING/PROCESSING jobs as FAILED.
    # We only fail jobs that haven't updated in >16 minutes to avoid nuking jobs
    # that are actually being handled by external workers.
    try:
        now = datetime.now(timezone.utc)
        stale_before = now - timedelta(minutes=16)
        async with session_factory() as session:
            from sqlalchemy import select as sa_select

            # Collect IDs of stale jobs before updating, so we can release
            # the processing lock on their songs.
            stale_ids_result = await session.execute(
                sa_select(Job.id)
                .where(Job.status.in_(["PENDING", "PROCESSING"]))
                .where(Job.updated_at < stale_before)
            )
            stale_job_ids = [row[0] for row in stale_ids_result.all()]

            if stale_job_ids:
                result = await session.execute(
                    update(Job)
                    .where(Job.id.in_(stale_job_ids))
                    .values(
                        status="FAILED", stage="failed", error_message="Server restarted"
                    )
                )
                # Release processing locks held by stale jobs.
                await session.execute(
                    update(Song)
                    .where(Song.processing_job_id.in_(stale_job_ids))
                    .values(processing_job_id=None)
                )
                await session.commit()
                logger.info(
                    "Marked %d stale jobs as FAILED on startup", len(stale_job_ids)
                )
            else:
                await session.commit()
    except Exception:
        logger.warning(
            "Failed to mark stale jobs on startup (will retry on next restart)",
            exc_info=True,
        )

    # Local/dev mode: sync local_bucket → DB
    # NOTE: we intentionally do NOT auto-seed the predefined dummy catalog on startup.
    # Use `just seed-db` or `POST /api/v1/admin/seed/populate` instead.
    if settings.environment in ("local", "dev"):
        base_path = settings.storage.base_path or "./local_bucket"

        async with session_factory() as session:
            user = await ensure_default_user(session, DEFAULT_LOCAL_EMAIL)
            # Additive-only: do not delete songs that aren't present on disk.
            # The seed flow populates the DB without creating MP3s.
            count = await sync_local_bucket(
                session, base_path, user, remove_stale=False
            )
            await session.commit()
            logger.info("Local sync complete: %d songs synced", count)

        # Phase 4: optional background admin heal for songs missing stems/chords/lyrics/thumbnails
        # Disabled by default (settings.admin.startup_enabled = False).
        if settings.admin.startup_enabled:
            user_sub = f"local-{DEFAULT_LOCAL_EMAIL}"
            start_startup_admin_heal(user_sub, DEFAULT_LOCAL_EMAIL)
            logger.info("Startup admin task launched")
        else:
            logger.info("Startup admin task disabled")

    yield

    await close_db()
    logger.info("Shutdown complete")


app = FastAPI(
    title="Guitar Player API",
    lifespan=lifespan,
)

# CORS
_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestContextMiddleware)


# Exception handlers
@app.exception_handler(NotFoundError)
async def not_found_handler(request: Request, exc: NotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(AlreadyExistsError)
async def already_exists_handler(
    request: Request, exc: AlreadyExistsError
) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(BadRequestError)
async def bad_request_handler(request: Request, exc: BadRequestError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Forward 5xx HTTP errors to Telegram, pass through everything else."""
    if exc.status_code >= 500:
        logger.error(
            "HTTP %d error",
            exc.status_code,
            extra={"method": request.method, "path": str(request.url.path)},
        )
        settings = get_settings()
        telegram = TelegramService(settings.telegram)
        exc_detail = html.escape(str(exc.detail)[:500])
        await telegram.send_error(
            f"<b>HTTP {exc.status_code}</b>\n"
            f"<b>Path:</b> {request.method} {request.url.path}\n"
            f"<b>Detail:</b> {exc_detail}"
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all handler: log and notify errors channel, then return 500."""
    logger.exception(
        "Unhandled exception",
        extra={
            "method": request.method,
            "path": str(request.url.path),
            "event_type": "unhandled_error",
        },
    )
    settings = get_settings()
    telegram = TelegramService(settings.telegram)
    exc_type = html.escape(type(exc).__name__)
    exc_msg = html.escape(str(exc)[:500])
    await telegram.send_error(
        f"<b>Unhandled Error</b>\n"
        f"<b>Path:</b> {request.method} {request.url.path}\n"
        f"<b>Type:</b> <code>{exc_type}</code>\n"
        f"<b>Message:</b> {exc_msg}"
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# Routers
app.include_router(health.router)
app.include_router(auth.router)

api_prefix = _settings.app.api_prefix
app.include_router(songs.router, prefix=api_prefix)
app.include_router(jobs.router, prefix=api_prefix)
app.include_router(favorites.router, prefix=api_prefix)
app.include_router(admin.router, prefix=api_prefix)
app.include_router(subscription.router, prefix=api_prefix)
app.include_router(subscription.webhook_router, prefix=api_prefix)

# Lambda handler
handler = Mangum(app)
