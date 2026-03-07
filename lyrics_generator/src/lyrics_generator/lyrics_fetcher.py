"""Multi-source lyrics fetcher.

Tries sources in order:
1. LRCLIB  -- free, open-source, has synced (LRC) + plain lyrics.
2. Genius  -- large database, plain lyrics only (scraped from page HTML).

The first source that returns a result wins.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from lyrics_generator.genius_fetcher import fetch_genius_lyrics

logger = logging.getLogger(__name__)

LRCLIB_BASE_URL = "https://lrclib.net/api"
_TIMEOUT = 10.0


@dataclass
class LyricsResult:
    """Result from a lyrics lookup."""

    track_name: str
    artist_name: str
    duration: float
    synced_lyrics: str | None
    plain_lyrics: str | None
    source: str = "lrclib"

    @property
    def has_synced(self) -> bool:
        return bool(self.synced_lyrics)


async def _fetch_lrclib(
    *,
    artist: str,
    title: str,
    album: str | None = None,
    duration: float | None = None,
) -> LyricsResult | None:
    """Fetch lyrics from LRCLIB by artist and track name."""
    params: dict[str, str] = {
        "artist_name": artist.strip(),
        "track_name": title.strip(),
    }
    if album:
        params["album_name"] = album.strip()
    if duration is not None:
        params["duration"] = str(int(duration))

    logger.info("Fetching lyrics from LRCLIB: artist=%r title=%r", artist, title)

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{LRCLIB_BASE_URL}/get",
            params=params,
            headers={"User-Agent": "guitar-player-lyrics-generator/0.1.0"},
        )

    if resp.status_code == 404:
        logger.info("No lyrics found on LRCLIB for artist=%r title=%r", artist, title)
        return None

    resp.raise_for_status()
    data = resp.json()

    result = LyricsResult(
        track_name=data.get("trackName", title),
        artist_name=data.get("artistName", artist),
        duration=float(data.get("duration", 0)),
        synced_lyrics=data.get("syncedLyrics") or None,
        plain_lyrics=data.get("plainLyrics") or None,
        source="lrclib",
    )

    logger.info(
        "LRCLIB result: synced=%s plain=%s duration=%.1f",
        result.has_synced,
        bool(result.plain_lyrics),
        result.duration,
    )
    return result


async def _fetch_genius(
    *,
    artist: str,
    title: str,
    access_token: str,
) -> LyricsResult | None:
    """Fetch plain-text lyrics from Genius (fallback source)."""
    try:
        plain = await fetch_genius_lyrics(
            artist=artist,
            title=title,
            access_token=access_token,
        )
    except Exception as e:
        logger.warning("Genius fetch failed: %s", e)
        return None

    if not plain:
        return None

    return LyricsResult(
        track_name=title,
        artist_name=artist,
        duration=0.0,
        synced_lyrics=None,
        plain_lyrics=plain,
        source="genius",
    )


async def fetch_lyrics(
    *,
    artist: str,
    title: str,
    album: str | None = None,
    duration: float | None = None,
    genius_access_token: str | None = None,
) -> LyricsResult | None:
    """Fetch lyrics from all configured sources (LRCLIB, then Genius).

    Returns a LyricsResult with synced and/or plain lyrics, or None if
    no source has a match.
    """
    # 1. Try LRCLIB first (best quality -- may have synced lyrics).
    try:
        result = await _fetch_lrclib(
            artist=artist, title=title, album=album, duration=duration,
        )
        if result:
            return result
    except Exception as e:
        logger.warning("LRCLIB fetch failed: %s", e)

    # 2. Fallback to Genius (plain lyrics only).
    if genius_access_token:
        result = await _fetch_genius(
            artist=artist,
            title=title,
            access_token=genius_access_token,
        )
        if result:
            return result
    else:
        logger.warning("Genius not configured (missing access_token), skipping fallback")

    return None
