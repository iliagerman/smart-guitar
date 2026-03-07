"""Tests for the multi-source lyrics fetcher (LRCLIB + Genius fallback)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from lyrics_generator.lyrics_fetcher import LyricsResult, fetch_lyrics


def _mock_httpx_response(status_code: int, json_data: dict | None = None) -> MagicMock:
    """Create a mock httpx.Response (sync methods like .json(), .raise_for_status())."""
    resp = MagicMock()
    resp.status_code = status_code
    if json_data is not None:
        resp.json.return_value = json_data
    return resp


def _mock_async_client(response: MagicMock) -> MagicMock:
    """Create a mock httpx.AsyncClient context manager."""
    client = AsyncMock()
    client.get.return_value = response
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=None)
    return cm


# ---------------------------------------------------------------------------
# LRCLIB path (primary source)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_lyrics_synced():
    """Returns synced lyrics when LRCLIB has them."""
    resp = _mock_httpx_response(200, {
        "trackName": "Sweet Child O' Mine",
        "artistName": "Guns N' Roses",
        "duration": 356.0,
        "syncedLyrics": "[00:30.00] She's got a smile\n[00:35.00] That it seems to me",
        "plainLyrics": "She's got a smile\nThat it seems to me",
    })

    with patch("lyrics_generator.lyrics_fetcher.httpx.AsyncClient", return_value=_mock_async_client(resp)):
        result = await fetch_lyrics(artist="Guns N' Roses", title="Sweet Child O' Mine")

    assert result is not None
    assert result.has_synced
    assert result.synced_lyrics is not None
    assert result.plain_lyrics is not None
    assert result.duration == 356.0
    assert result.source == "lrclib"


@pytest.mark.asyncio
async def test_fetch_lyrics_plain_only():
    """Returns plain lyrics when LRCLIB has no synced version."""
    resp = _mock_httpx_response(200, {
        "trackName": "Some Song",
        "artistName": "Some Artist",
        "duration": 200.0,
        "syncedLyrics": None,
        "plainLyrics": "Line one\nLine two",
    })

    with patch("lyrics_generator.lyrics_fetcher.httpx.AsyncClient", return_value=_mock_async_client(resp)):
        result = await fetch_lyrics(artist="Some Artist", title="Some Song")

    assert result is not None
    assert not result.has_synced
    assert result.plain_lyrics is not None
    assert result.source == "lrclib"


@pytest.mark.asyncio
async def test_fetch_lyrics_not_found_no_genius():
    """Returns None when LRCLIB returns 404 and Genius is not configured."""
    resp = _mock_httpx_response(404)

    with patch("lyrics_generator.lyrics_fetcher.httpx.AsyncClient", return_value=_mock_async_client(resp)):
        result = await fetch_lyrics(artist="Unknown", title="Nonexistent Song")

    assert result is None


# ---------------------------------------------------------------------------
# Genius fallback path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fallback_to_genius_when_lrclib_404():
    """Falls back to Genius when LRCLIB returns 404."""
    lrclib_resp = _mock_httpx_response(404)

    genius_plain = "שורה ראשונה\nשורה שנייה\nשורה שלישית"

    with (
        patch("lyrics_generator.lyrics_fetcher.httpx.AsyncClient", return_value=_mock_async_client(lrclib_resp)),
        patch("lyrics_generator.lyrics_fetcher.fetch_genius_lyrics", new_callable=AsyncMock, return_value=genius_plain),
    ):
        result = await fetch_lyrics(
            artist="מאיר אריאל",
            title="חיית הברזל",
            genius_access_token="fake_token",
        )

    assert result is not None
    assert result.source == "genius"
    assert not result.has_synced
    assert "שורה ראשונה" in result.plain_lyrics


@pytest.mark.asyncio
async def test_genius_not_called_when_lrclib_succeeds():
    """Does NOT call Genius when LRCLIB already returned lyrics."""
    lrclib_resp = _mock_httpx_response(200, {
        "trackName": "Test", "artistName": "Artist", "duration": 100.0,
        "syncedLyrics": "[00:01.00] Line", "plainLyrics": "Line",
    })

    genius_mock = AsyncMock(return_value="Should not be called")

    with (
        patch("lyrics_generator.lyrics_fetcher.httpx.AsyncClient", return_value=_mock_async_client(lrclib_resp)),
        patch("lyrics_generator.lyrics_fetcher.fetch_genius_lyrics", genius_mock),
    ):
        result = await fetch_lyrics(
            artist="Artist", title="Test",
            genius_access_token="fake_token",
        )

    assert result is not None
    assert result.source == "lrclib"
    genius_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_genius_returns_none_overall_none():
    """Returns None when both LRCLIB and Genius find nothing."""
    lrclib_resp = _mock_httpx_response(404)

    with (
        patch("lyrics_generator.lyrics_fetcher.httpx.AsyncClient", return_value=_mock_async_client(lrclib_resp)),
        patch("lyrics_generator.lyrics_fetcher.fetch_genius_lyrics", new_callable=AsyncMock, return_value=None),
    ):
        result = await fetch_lyrics(
            artist="Nobody", title="Nothing",
            genius_access_token="fake_token",
        )

    assert result is None


@pytest.mark.asyncio
async def test_genius_error_is_swallowed():
    """Genius errors are caught and None is returned (non-fatal)."""
    lrclib_resp = _mock_httpx_response(404)

    with (
        patch("lyrics_generator.lyrics_fetcher.httpx.AsyncClient", return_value=_mock_async_client(lrclib_resp)),
        patch("lyrics_generator.lyrics_fetcher.fetch_genius_lyrics", new_callable=AsyncMock, side_effect=RuntimeError("boom")),
    ):
        result = await fetch_lyrics(
            artist="Artist", title="Song",
            genius_access_token="fake_token",
        )

    assert result is None


# ---------------------------------------------------------------------------
# LyricsResult dataclass
# ---------------------------------------------------------------------------


def test_lyrics_result_has_synced():
    r = LyricsResult(
        track_name="T", artist_name="A", duration=100.0,
        synced_lyrics="[00:01.00] Line", plain_lyrics="Line",
    )
    assert r.has_synced

    r2 = LyricsResult(
        track_name="T", artist_name="A", duration=100.0,
        synced_lyrics=None, plain_lyrics="Line",
    )
    assert not r2.has_synced


def test_lyrics_result_default_source():
    r = LyricsResult(
        track_name="T", artist_name="A", duration=100.0,
        synced_lyrics=None, plain_lyrics="Line",
    )
    assert r.source == "lrclib"
