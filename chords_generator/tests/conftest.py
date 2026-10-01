"""Test fixtures for chords_generator tests.

Important: chords_generator's LocalStorage does NOT resolve relative keys
against base_path (unlike lyrics_generator). Tests must pass absolute file
paths to the API.
"""

import os
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Set test environment before any app imports
os.environ["APP_ENV"] = "test"

from chords_generator.api import app  # noqa: E402

TEST_BUCKET_DIR = (
    Path(__file__).resolve().parent.parent.parent / "local_bucket_test"
).resolve()

# Absolute path to a full song mix for chord recognition.
# Chord recognition requires a full audio mix, not an isolated stem.
TEST_SONG_KEY = "bob_dylan/knocking_on_heavens_door/Bob Dylan - Knockin' On Heaven's Door (Official Audio).mp3"
TEST_SONG_ABS_PATH = str((TEST_BUCKET_DIR / TEST_SONG_KEY).resolve())


@pytest.fixture
def test_song_path() -> str:
    """Return absolute path to the test song file."""
    assert os.path.isfile(TEST_SONG_ABS_PATH), (
        f"Test file not found: {TEST_SONG_ABS_PATH}"
    )
    return TEST_SONG_ABS_PATH


@pytest_asyncio.fixture
async def client():
    """Async HTTP client with lifespan support (initializes storage)."""
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
