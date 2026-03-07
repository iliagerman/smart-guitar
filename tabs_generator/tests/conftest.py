"""Test fixtures for tabs_generator tests.

Uses storage keys (relative to configured local storage base_path),
matching the pattern from other microservices.
"""

import os
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Set test environment before any app imports
os.environ["APP_ENV"] = "test"

from tabs_generator.api import app  # noqa: E402

TEST_BUCKET_DIR = (
    Path(__file__).resolve().parent.parent.parent / "local_bucket_test"
).resolve()

# Key relative to TEST_BUCKET_DIR (matches what backend sends to microservices)
TEST_GUITAR_KEY = "tabs_generation/guitar.mp3"

# Absolute on-disk path for local assertions
TEST_GUITAR_ABS_PATH = str((TEST_BUCKET_DIR / TEST_GUITAR_KEY).resolve())


@pytest.fixture
def test_guitar_key() -> str:
    """Return storage key (relative path) to the test guitar stem file."""
    assert os.path.isfile(TEST_GUITAR_ABS_PATH), (
        f"Test file not found: {TEST_GUITAR_ABS_PATH}"
    )
    return TEST_GUITAR_KEY


@pytest_asyncio.fixture
async def client():
    """Async HTTP client with lifespan support (initializes storage + model)."""
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
