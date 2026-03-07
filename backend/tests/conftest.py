"""Shared fixtures for integration tests."""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import NullPool

from guitar_player.config import load_settings
from guitar_player.database import _to_async_url
from guitar_player.models import Base
from guitar_player.storage import create_storage


# ── Shared database & settings fixtures ────────────────────────────


@pytest.fixture(scope="session")
def settings():
    """Load test settings (APP_ENV=test by default)."""
    return load_settings(app_env="test")


@pytest.fixture(scope="session")
def session_factory(settings):
    """Create async engine and session factory for tests."""
    db_url = settings.db.url
    if not db_url:
        pytest.skip("No database URL configured — set db.url in test config")

    async_url = _to_async_url(db_url)

    if async_url.startswith("sqlite"):
        # File-based SQLite is sensitive to concurrent writers.
        # Use a longer busy timeout and avoid a single shared connection.
        engine = create_async_engine(
            async_url,
            echo=False,
            poolclass=NullPool,
            connect_args={"check_same_thread": False, "timeout": 30},
        )
    else:
        engine = create_async_engine(async_url, echo=False, poolclass=NullPool)

    return async_sessionmaker(engine, expire_on_commit=False)


def _apply_sqlite_pragmas(engine) -> None:
    """Apply PRAGMAs to make SQLite more reliable for concurrent test workloads."""
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql("PRAGMA journal_mode=WAL")
            conn.exec_driver_sql("PRAGMA synchronous=NORMAL")
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
            # milliseconds
            conn.exec_driver_sql("PRAGMA busy_timeout=30000")
    except Exception:
        # Best-effort; if a given SQLite build doesn't support a pragma,
        # the tests should still proceed.
        pass


@pytest.fixture(scope="session")
def storage(settings):
    """Create and initialize the storage backend."""
    s = create_storage(settings)
    if hasattr(s, "init"):
        s.init()
    return s


@pytest.fixture(scope="session", autouse=True)
def _create_tables():
    """Create all DB tables before tests, drop + clean up after."""
    # Load settings directly to avoid scope conflicts with module-level overrides
    test_settings = load_settings(app_env="test")
    db_url = test_settings.db.url
    if not db_url:
        yield
        return

    # Use a synchronous engine for DDL to avoid async fixture scoping issues
    sync_url = db_url
    if "+aiosqlite" in sync_url:
        sync_url = sync_url.replace("+aiosqlite", "")

    connect_args = {"timeout": 30} if sync_url.startswith("sqlite") else {}
    sync_engine = create_engine(sync_url, connect_args=connect_args)
    if sync_url.startswith("sqlite"):
        _apply_sqlite_pragmas(sync_engine)
    Base.metadata.create_all(sync_engine)
    sync_engine.dispose()

    yield

    # Teardown: drop tables and clean up artifacts
    # Teardown: drop tables and clean up artifacts.
    # SQLite can be briefly locked if any background task still holds a connection.
    connect_args = {"timeout": 30} if sync_url.startswith("sqlite") else {}
    sync_engine = create_engine(sync_url, connect_args=connect_args)
    if sync_url.startswith("sqlite"):
        _apply_sqlite_pragmas(sync_engine)

    last_exc: Exception | None = None
    for attempt in range(10):
        try:
            Base.metadata.drop_all(sync_engine)
            last_exc = None
            break
        except OperationalError as exc:
            last_exc = exc
            if "locked" in str(exc).lower():
                time.sleep(0.5 * (attempt + 1))
                continue
            raise
    sync_engine.dispose()
    if last_exc is not None:
        raise last_exc

    # Remove SQLite file if present
    if "sqlite" in db_url:
        db_path = db_url.split("///")[-1]
        if db_path:
            Path(db_path).unlink(missing_ok=True)


# ── Project root & server fixtures ─────────────────────────────────


@pytest.fixture(scope="session")
def project_root() -> Path:
    """Return the project root directory (parent of backend/)."""
    return Path(__file__).resolve().parent.parent.parent


def _kill_port(port: int) -> None:
    """Kill any process listening on the given port."""
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True,
            text=True,
        )
        pids = result.stdout.strip().split()
        for pid in pids:
            if pid:
                os.kill(int(pid), signal.SIGKILL)
                print(f"  Killed leftover process {pid} on port {port}", flush=True)
        if pids and pids[0]:
            time.sleep(1)  # give OS time to release the port
    except (ProcessLookupError, ValueError):
        pass


def _wait_for_health(
    url: str, name: str, proc: subprocess.Popen, timeout: float = 120
) -> None:
    """Poll a health endpoint until it responds 200 or timeout expires."""
    print(f"  Waiting for {name} at {url} ...", flush=True)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        # Check the subprocess hasn't crashed
        if proc.poll() is not None:
            raise RuntimeError(
                f"{name} process exited with code {proc.returncode} before becoming healthy"
            )
        try:
            resp = httpx.get(url, timeout=5)
            if resp.status_code == 200:
                elapsed = timeout - (deadline - time.monotonic())
                print(f"  {name} is healthy ({elapsed:.1f}s)", flush=True)
                return
        except httpx.HTTPError:
            pass
        time.sleep(2)
    raise TimeoutError(f"{name} at {url} did not become healthy within {timeout}s")


@pytest.fixture(scope="session")
def demucs_server(project_root: Path):
    """Start the demucs inference server for the test session."""
    print("\n[fixture] Starting demucs server on :8000 ...", flush=True)
    _kill_port(8000)
    proc = subprocess.Popen(
        [
            "uv",
            "run",
            "uvicorn",
            "--app-dir",
            "src",
            "inference_demucs.api:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
        ],
        cwd=project_root / "inference_demucs",
        env={
            **os.environ,
            "APP_ENV": "test",
            # Prefer workspace sources over potentially-stale installed packages.
            "PYTHONPATH": "src",
        },
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    try:
        _wait_for_health("http://localhost:8000/health", "demucs", proc)
        yield proc
    finally:
        print("\n[fixture] Stopping demucs server ...", flush=True)
        proc.terminate()
        proc.wait(timeout=10)
        print("[fixture] Demucs server stopped.", flush=True)


@pytest.fixture(scope="session")
def chords_server(project_root: Path):
    """Start the chords generator server for the test session."""
    print("\n[fixture] Starting chords server on :8001 ...", flush=True)
    _kill_port(8001)
    proc = subprocess.Popen(
        [
            "uv",
            "run",
            "uvicorn",
            "--app-dir",
            "src",
            "chords_generator.api:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8001",
        ],
        cwd=project_root / "chords_generator",
        env={
            **os.environ,
            "APP_ENV": "test",
            "TF_USE_LEGACY_KERAS": "1",
            # Prefer workspace sources over potentially-stale installed packages.
            "PYTHONPATH": "src",
        },
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    try:
        _wait_for_health("http://localhost:8001/health", "chords", proc)
        yield proc
    finally:
        print("\n[fixture] Stopping chords server ...", flush=True)
        proc.terminate()
        proc.wait(timeout=10)
        print("[fixture] Chords server stopped.", flush=True)


@pytest.fixture(scope="session")
def lyrics_server(project_root: Path):
    """Start the lyrics generator server for the test session."""
    print("\n[fixture] Starting lyrics server on :8003 ...", flush=True)
    _kill_port(8003)
    proc = subprocess.Popen(
        [
            "uv",
            "run",
            "uvicorn",
            "--app-dir",
            "src",
            "lyrics_generator.api:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8003",
        ],
        cwd=project_root / "lyrics_generator",
        env={
            **os.environ,
            "APP_ENV": "test",
            # Prefer workspace sources over potentially-stale installed packages.
            "PYTHONPATH": "src",
        },
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    try:
        _wait_for_health("http://localhost:8003/health", "lyrics", proc, timeout=180)
        yield proc
    finally:
        print("\n[fixture] Stopping lyrics server ...", flush=True)
        proc.terminate()
        proc.wait(timeout=10)
        print("[fixture] Lyrics server stopped.", flush=True)


@pytest.fixture(scope="session")
def tabs_server(project_root: Path):
    """Start the tabs generator server for the test session."""
    print("\n[fixture] Starting tabs server on :8004 ...", flush=True)
    _kill_port(8004)
    proc = subprocess.Popen(
        [
            "uv",
            "run",
            "uvicorn",
            "--app-dir",
            "src",
            "tabs_generator.api:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8004",
        ],
        cwd=project_root / "tabs_generator",
        env={
            **os.environ,
            "APP_ENV": "test",
            # Prefer workspace sources over potentially-stale installed packages.
            "PYTHONPATH": "src",
        },
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    try:
        _wait_for_health("http://localhost:8004/health", "tabs", proc)
        yield proc
    finally:
        print("\n[fixture] Stopping tabs server ...", flush=True)
        proc.terminate()
        proc.wait(timeout=10)
        print("[fixture] Tabs server stopped.", flush=True)
