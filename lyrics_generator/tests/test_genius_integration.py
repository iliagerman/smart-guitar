"""Integration tests for Genius lyrics fetching.

These tests hit the real Genius API and require credentials in secrets.yml.
Run with:  pytest tests/test_genius_integration.py -m integration
Skip in CI with:  pytest -m "not integration"
"""

import pytest

from lyrics_generator.config import load_settings
from lyrics_generator.genius_fetcher import fetch_genius_lyrics
from lyrics_generator.lyrics_fetcher import LyricsResult, fetch_lyrics

# Load Genius creds from secrets.yml (via config system)
_settings = load_settings(app_env="local")
_genius = _settings.genius
_has_genius = bool(_genius.access_token)

skip_no_genius = pytest.mark.skipif(
    not _has_genius, reason="Genius credentials not configured in secrets.yml"
)

pytestmark = [pytest.mark.integration, skip_no_genius]


# ---------------------------------------------------------------------------
# genius_fetcher direct
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_genius_fetcher_hebrew_song():
    """fetch_genius_lyrics returns Hebrew lyrics for חיית הברזל by מאיר אריאל."""
    result = await fetch_genius_lyrics(
        artist="מאיר אריאל",
        title="חיית הברזל",
        access_token=_genius.access_token,
    )

    assert result is not None, "Genius should find חיית הברזל"
    assert len(result) > 50, f"Expected substantial lyrics, got {len(result)} chars"
    # Verify it's actually Hebrew text
    assert any("\u0590" <= ch <= "\u05FF" for ch in result), "Lyrics should contain Hebrew characters"


@pytest.mark.asyncio
async def test_genius_fetcher_nonexistent_song():
    """fetch_genius_lyrics returns None for a clearly fake song."""
    result = await fetch_genius_lyrics(
        artist="zzznonexistent_artist_zzz",
        title="zzznonexistent_title_zzz",
        access_token=_genius.access_token,
    )

    assert result is None


# ---------------------------------------------------------------------------
# Full fetch_lyrics pipeline (LRCLIB miss -> Genius fallback)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_lyrics_falls_back_to_genius_for_hebrew():
    """fetch_lyrics returns Genius lyrics for a song not on LRCLIB.

    חיית הברזל by מאיר אריאל exists on Genius but not on LRCLIB.
    """
    result = await fetch_lyrics(
        artist="מאיר אריאל",
        title="חיית הברזל",
        genius_access_token=_genius.access_token,
    )

    assert result is not None, "Should fall back to Genius when LRCLIB has no match"
    assert isinstance(result, LyricsResult)
    assert result.source == "genius"
    assert not result.has_synced, "Genius only provides plain lyrics"
    assert result.plain_lyrics is not None
    assert len(result.plain_lyrics) > 50
    assert any("\u0590" <= ch <= "\u05FF" for ch in result.plain_lyrics)
