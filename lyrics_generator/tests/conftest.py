"""Test fixtures for lyrics_generator tests.

Important: in production and in the backend integration flow, the lyrics service
receives *storage keys* (e.g. "bob_dylan/.../vocals.mp3"), not absolute paths.

These tests therefore use a key relative to the configured local storage base_path
(APP_ENV=test -> base_path=../local_bucket_test), so we catch base_path/config bugs.
"""

import os
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Set test environment before any app imports
os.environ["APP_ENV"] = "test"

from lyrics_generator.api import app  # noqa: E402

TEST_BUCKET_DIR = (
    Path(__file__).resolve().parent.parent.parent / "local_bucket_test"
).resolve()

# Key relative to TEST_BUCKET_DIR (matches what backend sends to microservices)
TEST_VOCALS_KEY = "bob_dylan_vocals/knocking_on_heavens_door/vocals.mp3"

# Absolute on-disk path for local assertions.
TEST_VOCALS_ABS_PATH = str((TEST_BUCKET_DIR / TEST_VOCALS_KEY).resolve())


@pytest.fixture
def test_vocals_key() -> str:
    """Return storage key (relative path) to the test vocals file."""
    assert os.path.isfile(TEST_VOCALS_ABS_PATH), (
        f"Test file not found: {TEST_VOCALS_ABS_PATH}"
    )
    return TEST_VOCALS_KEY


@pytest_asyncio.fixture
async def client():
    """Async HTTP client with lifespan support (initializes storage + model)."""
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
