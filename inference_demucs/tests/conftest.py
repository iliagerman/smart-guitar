"""Test fixtures for inference_demucs tests.

Important: inference_demucs's LocalStorage does NOT resolve relative keys
against base_path (unlike lyrics_generator). Tests must pass absolute file
paths to the API.

The /separate endpoint checks for existing stems and short-circuits if all
required outputs already exist. The test fixture uses a song directory where
no stems have been pre-generated yet.
"""

import os
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Set test environment before any app imports
os.environ["APP_ENV"] = "test"

from inference_demucs.api import app  # noqa: E402

TEST_BUCKET_DIR = (
    Path(__file__).resolve().parent.parent.parent / "local_bucket_test"
).resolve()

# Use a full-mix song that does NOT yet have pre-separated stems,
# so the API actually runs Demucs separation rather than short-circuiting.
TEST_SONG_KEY = "the_white_buffalo/the_house_of_the_rising_sun/The House of The Rising Sun - The White Buffalo.mp3"
TEST_SONG_ABS_PATH = str((TEST_BUCKET_DIR / TEST_SONG_KEY).resolve())


@pytest.fixture
def test_song_path() -> str:
    """Return absolute path to the test full-mix song file."""
    assert os.path.isfile(TEST_SONG_ABS_PATH), (
        f"Test file not found: {TEST_SONG_ABS_PATH}"
    )
    return TEST_SONG_ABS_PATH


@pytest_asyncio.fixture
async def client():
    """Async HTTP client with lifespan support (initializes storage + model config)."""
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
