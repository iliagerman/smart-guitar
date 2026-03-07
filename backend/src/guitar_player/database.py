"""Async SQLAlchemy engine and session factory.

Notes on SQLite in tests:
- The integration tests run with a file-based SQLite DB.
- Background tasks + polling can lead to concurrent writes.
- SQLite is sensitive to concurrent writers; to reduce "database is locked"
    failures we use a longer busy timeout and avoid StaticPool.
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from guitar_player.config import Settings

_IS_LAMBDA = bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))

logger = logging.getLogger(__name__)

_engine = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _to_async_url(url: str) -> str:
    """Convert postgresql:// to postgresql+asyncpg://."""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def init_db(settings: Settings) -> async_sessionmaker[AsyncSession]:
    """Create the async engine and session factory. Called once at startup."""
    global _engine, _session_factory

    db_url = settings.db.url
    if not db_url:
        raise RuntimeError("Database URL not configured")

    async_url = _to_async_url(db_url)

    engine_kwargs: dict = {"echo": settings.db.echo}
    if async_url.startswith("sqlite"):
        # File-based SQLite (tests): prefer NullPool so concurrent async sessions
        # don't fight over a single shared connection, and give SQLite time to
        # wait on locks instead of failing fast.
        #
        # StaticPool is appropriate for in-memory SQLite, but tends to be brittle
        # with concurrent async usage against a file DB.
        engine_kwargs["poolclass"] = NullPool
        engine_kwargs["connect_args"] = {
            "check_same_thread": False,
            # seconds; sqlite3 uses a busy timeout for locked DB
            "timeout": 30,
        }
    elif _IS_LAMBDA:
        # Lambda reuses the process across invocations but asyncio.run() creates
        # a new event loop each time.  Pooled connections are bound to the old
        # loop, causing "Future attached to a different loop" on warm starts.
        # NullPool avoids this by never keeping connections between requests.
        engine_kwargs["poolclass"] = NullPool
    else:
        engine_kwargs["pool_size"] = settings.db.pool_size
        engine_kwargs["max_overflow"] = settings.db.max_overflow
        engine_kwargs["pool_pre_ping"] = True

    _engine = create_async_engine(async_url, **engine_kwargs)

    # SQLite doesn't support SELECT FOR UPDATE.  Use BEGIN IMMEDIATE so the
    # transaction acquires a write lock at the start, providing equivalent
    # serialization for the processing-lock check-and-set pattern.
    if async_url.startswith("sqlite"):

        @event.listens_for(_engine.sync_engine, "begin")
        def _sqlite_begin_immediate(conn):
            conn.exec_driver_sql("BEGIN IMMEDIATE")

    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    logger.info("Database engine created for %s", settings.environment)
    return _session_factory


async def close_db() -> None:
    """Dispose engine on shutdown."""
    global _engine, _session_factory
    if _engine:
        await _engine.dispose()
        _engine = None
        _session_factory = None
        logger.info("Database engine disposed")


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the session factory singleton."""
    if _session_factory is None:
        raise RuntimeError("Database not initialized — call init_db() first")
    return _session_factory


@asynccontextmanager
async def safe_session() -> AsyncIterator[AsyncSession]:
    """Yield a session whose ``close()`` is shielded from task cancellation.

    When uvicorn cancels a request task (e.g. client disconnect during SSE),
    ``CancelledError`` propagates through ``AsyncSession.__aexit__`` and
    interrupts ``session.close()``, leaving the underlying connection checked
    out of the pool.  This wrapper uses ``asyncio.shield`` so the close
    always completes (in the background if necessary).
    """
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        try:
            await asyncio.shield(session.close())
        except asyncio.CancelledError:
            pass  # close() continues in background via shield
