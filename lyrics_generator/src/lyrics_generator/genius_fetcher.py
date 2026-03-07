"""Genius lyrics fetcher using the official API + curl_cffi for Cloudflare bypass.

Used as a fallback when LRCLIB has no match.

Search uses the official Genius developer API (api.genius.com) with Bearer token.
Lyrics page scraping uses curl_cffi with Chrome TLS impersonation to bypass
Cloudflare's bot detection on genius.com.
"""

from __future__ import annotations

import asyncio
import logging
import re

import httpx
from bs4 import BeautifulSoup, NavigableString, Tag
from curl_cffi.requests import AsyncSession

logger = logging.getLogger(__name__)

_API_BASE = "https://api.genius.com"
_SEARCH_TIMEOUT = 10.0
_SCRAPE_TIMEOUT = 15.0


def _clean_lyrics(text: str) -> str:
    """Strip section headers and collapse blank lines."""
    text = re.sub(r"\[.*?\]", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def _parse_lyrics_html(html: str) -> str | None:
    """Extract plain-text lyrics from a Genius song page HTML."""
    soup = BeautifulSoup(html, "html.parser")

    # Remove LyricsHeader divs
    for div in soup.find_all("div", class_=re.compile("LyricsHeader__Container")):
        div.decompose()

    containers = soup.find_all("div", attrs={"data-lyrics-container": "true"})
    if not containers:
        return None

    lyrics = ""
    for container in containers:
        if not isinstance(container, Tag) or not container.contents:
            lyrics += "\n"
            continue
        for element in container.contents:
            if not isinstance(element, (Tag, NavigableString)):
                continue
            if isinstance(element, Tag) and element.name == "br":
                lyrics += "\n"
            elif isinstance(element, NavigableString):
                lyrics += str(element)
            elif isinstance(element, Tag) and element.get("data-exclude-from-selection") != "true":
                lyrics += element.get_text(separator="\n")

    return lyrics.strip("\n") or None


async def _search_genius_api(
    query: str,
    access_token: str,
) -> str | None:
    """Search the official Genius API and return the song page path, or None."""
    async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
        resp = await client.get(
            f"{_API_BASE}/search",
            params={"q": query},
            headers={"Authorization": f"Bearer {access_token}"},
        )

    if resp.status_code != 200:
        logger.warning("Genius API search returned %d", resp.status_code)
        return None

    data = resp.json()
    hits = data.get("response", {}).get("hits", [])
    if not hits:
        return None

    # Return the path of the first song result
    for hit in hits:
        if hit.get("type") == "song":
            path = hit.get("result", {}).get("path")
            if path:
                return path

    return None


async def _fetch_lyrics_page(path: str) -> str | None:
    """Fetch a Genius lyrics page using curl_cffi to bypass Cloudflare."""
    url = f"https://genius.com{path}"
    async with AsyncSession() as session:
        resp = await session.get(url, impersonate="chrome", timeout=_SCRAPE_TIMEOUT)

    if resp.status_code != 200:
        logger.warning("Genius page fetch returned %d for %s", resp.status_code, url)
        return None

    return resp.text


async def fetch_genius_lyrics(
    *,
    artist: str,
    title: str,
    access_token: str,
) -> str | None:
    """Search Genius and return plain-text lyrics, or None if not found."""
    logger.info("Searching Genius for lyrics: artist=%r title=%r", artist, title)

    query = f"{title} {artist}"
    path = await _search_genius_api(query, access_token)

    if not path:
        logger.info("No Genius results for artist=%r title=%r", artist, title)
        return None

    html = await _fetch_lyrics_page(path)
    if not html:
        logger.warning("Failed to fetch Genius lyrics page: %s", path)
        return None

    raw_lyrics = _parse_lyrics_html(html)
    if not raw_lyrics:
        logger.info("Genius returned empty lyrics for artist=%r title=%r", artist, title)
        return None

    lyrics = _clean_lyrics(raw_lyrics)
    if lyrics:
        logger.info(
            "Genius lyrics found: %d chars, %d lines",
            len(lyrics),
            lyrics.count("\n") + 1,
        )
    else:
        logger.info("Genius returned empty lyrics after cleaning for artist=%r title=%r", artist, title)

    return lyrics or None
