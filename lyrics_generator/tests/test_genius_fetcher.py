"""Tests for the Genius lyrics fetcher."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from lyrics_generator.genius_fetcher import (
    _clean_lyrics,
    _parse_lyrics_html,
    fetch_genius_lyrics,
)


# ---------------------------------------------------------------------------
# _clean_lyrics (pure text processing, no mocking needed)
# ---------------------------------------------------------------------------


def test_clean_lyrics_strips_section_headers():
    text = "[Verse 1]\nFirst line\n[Chorus]\nChorus line"
    result = _clean_lyrics(text)
    assert "[Verse 1]" not in result
    assert "[Chorus]" not in result
    assert "First line" in result
    assert "Chorus line" in result


def test_clean_lyrics_collapses_blank_lines():
    text = "Line one\n\n\n\n\nLine two"
    result = _clean_lyrics(text)
    assert result == "Line one\n\nLine two"


def test_clean_lyrics_empty():
    assert _clean_lyrics("   ") == ""


# ---------------------------------------------------------------------------
# _parse_lyrics_html
# ---------------------------------------------------------------------------

_SAMPLE_HTML = """
<html><body>
<div data-lyrics-container="true">שורה ראשונה<br/>שורה שנייה</div>
<div data-lyrics-container="true">שורה שלישית</div>
</body></html>
"""


def test_parse_lyrics_html_extracts_text():
    result = _parse_lyrics_html(_SAMPLE_HTML)
    assert result is not None
    assert "שורה ראשונה" in result
    assert "שורה שנייה" in result
    assert "שורה שלישית" in result


def test_parse_lyrics_html_no_containers():
    html = "<html><body><div>No lyrics here</div></body></html>"
    assert _parse_lyrics_html(html) is None


# ---------------------------------------------------------------------------
# fetch_genius_lyrics (mocked API + page fetch)
# ---------------------------------------------------------------------------

_SEARCH_RESPONSE = {
    "response": {
        "hits": [
            {
                "type": "song",
                "result": {
                    "path": "/Dan-toren-white-on-white-lyrics",
                },
            }
        ]
    }
}


@pytest.mark.asyncio
async def test_fetch_genius_lyrics_success():
    mock_search_resp = MagicMock()
    mock_search_resp.status_code = 200
    mock_search_resp.json.return_value = _SEARCH_RESPONSE

    mock_page_resp = MagicMock()
    mock_page_resp.status_code = 200
    mock_page_resp.text = _SAMPLE_HTML

    mock_session_instance = AsyncMock()
    mock_session_instance.get = AsyncMock(return_value=mock_page_resp)
    mock_session_instance.__aenter__ = AsyncMock(return_value=mock_session_instance)
    mock_session_instance.__aexit__ = AsyncMock(return_value=None)

    with (
        patch("lyrics_generator.genius_fetcher.httpx.AsyncClient") as mock_httpx,
        patch("lyrics_generator.genius_fetcher.AsyncSession", return_value=mock_session_instance),
    ):
        mock_httpx_instance = AsyncMock()
        mock_httpx_instance.get = AsyncMock(return_value=mock_search_resp)
        mock_httpx_instance.__aenter__ = AsyncMock(return_value=mock_httpx_instance)
        mock_httpx_instance.__aexit__ = AsyncMock(return_value=None)
        mock_httpx.return_value = mock_httpx_instance

        result = await fetch_genius_lyrics(
            artist="מאיר אריאל",
            title="חיית הברזל",
            access_token="fake_token",
        )

    assert result is not None
    assert "שורה ראשונה" in result


@pytest.mark.asyncio
async def test_fetch_genius_lyrics_no_results():
    mock_search_resp = MagicMock()
    mock_search_resp.status_code = 200
    mock_search_resp.json.return_value = {"response": {"hits": []}}

    with patch("lyrics_generator.genius_fetcher.httpx.AsyncClient") as mock_httpx:
        mock_httpx_instance = AsyncMock()
        mock_httpx_instance.get = AsyncMock(return_value=mock_search_resp)
        mock_httpx_instance.__aenter__ = AsyncMock(return_value=mock_httpx_instance)
        mock_httpx_instance.__aexit__ = AsyncMock(return_value=None)
        mock_httpx.return_value = mock_httpx_instance

        result = await fetch_genius_lyrics(
            artist="Unknown",
            title="Nonexistent",
            access_token="fake_token",
        )

    assert result is None


@pytest.mark.asyncio
async def test_fetch_genius_lyrics_empty_lyrics():
    mock_search_resp = MagicMock()
    mock_search_resp.status_code = 200
    mock_search_resp.json.return_value = _SEARCH_RESPONSE

    mock_page_resp = MagicMock()
    mock_page_resp.status_code = 200
    mock_page_resp.text = "<html><body><div>No lyrics containers</div></body></html>"

    mock_session_instance = AsyncMock()
    mock_session_instance.get = AsyncMock(return_value=mock_page_resp)
    mock_session_instance.__aenter__ = AsyncMock(return_value=mock_session_instance)
    mock_session_instance.__aexit__ = AsyncMock(return_value=None)

    with (
        patch("lyrics_generator.genius_fetcher.httpx.AsyncClient") as mock_httpx,
        patch("lyrics_generator.genius_fetcher.AsyncSession", return_value=mock_session_instance),
    ):
        mock_httpx_instance = AsyncMock()
        mock_httpx_instance.get = AsyncMock(return_value=mock_search_resp)
        mock_httpx_instance.__aenter__ = AsyncMock(return_value=mock_httpx_instance)
        mock_httpx_instance.__aexit__ = AsyncMock(return_value=None)
        mock_httpx.return_value = mock_httpx_instance

        result = await fetch_genius_lyrics(
            artist="מאיר אריאל",
            title="חיית הברזל",
            access_token="fake_token",
        )

    assert result is None
