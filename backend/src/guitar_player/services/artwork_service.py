"""Artwork service — fetches official album artwork via MusicBrainz + Cover Art Archive."""

import asyncio
import logging
import os
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

MUSICBRAINZ_API = "https://musicbrainz.org/ws/2/recording"
COVERART_API = "https://coverartarchive.org/release"
TIMEOUT = 15.0
USER_AGENT = "GuitarPlayer/1.0 (https://github.com/guitar-player)"

# Max number of release MBIDs to try for cover art before giving up.
MAX_RELEASE_ATTEMPTS = 10

# Retry settings for transient HTTP errors (rate-limiting, connection issues).
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 1.5  # seconds; doubles each retry


class ArtworkService:
    """Fetches official album artwork using MusicBrainz and Cover Art Archive.

    Both services are free, open-source, and require no API key.
    MusicBrainz enforces a rate limit of ~1 request/second, so all HTTP
    calls include retry logic with exponential backoff.
    """

    @staticmethod
    def _clean_term(name: str) -> str:
        """Convert snake_case folder names back to search-friendly text."""
        return name.replace("_", " ").strip()

    @staticmethod
    def _is_retryable(exc: Exception) -> bool:
        """Return True if the error is transient and worth retrying."""
        # Connection-level errors (rate-limit resets, DNS hiccups, etc.)
        if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)):
            return True
        # Server returned a retryable status code
        if isinstance(exc, httpx.HTTPStatusError):
            return exc.response.status_code in (429, 500, 502, 503)
        return False

    async def _get_with_retry(
        self,
        client: httpx.AsyncClient,
        url: str,
        *,
        params: dict | None = None,
        headers: dict | None = None,
    ) -> httpx.Response:
        """Issue a GET request with retry + exponential backoff.

        Raises the final exception if all retries are exhausted.
        """
        last_exc: Exception | None = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                resp = await client.get(url, params=params, headers=headers)
                # Raise on 4xx/5xx so we can inspect in _is_retryable
                resp.raise_for_status()
                return resp
            except Exception as exc:
                last_exc = exc
                if attempt < MAX_RETRIES and self._is_retryable(exc):
                    delay = RETRY_BACKOFF_BASE * (2 ** attempt)
                    logger.debug(
                        "Retryable error on attempt %d/%d for %s: %s — "
                        "retrying in %.1fs",
                        attempt + 1, MAX_RETRIES + 1, url, exc, delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    raise
        # Should not be reached, but satisfy the type checker.
        raise last_exc  # type: ignore[misc]

    async def _search_release_mbids(self, artist: str, song: str) -> list[str]:
        """Search MusicBrainz for a recording and return candidate release MBIDs.

        Returns up to MAX_RELEASE_ATTEMPTS unique MBIDs, ordered by relevance.
        """
        clean_artist = self._clean_term(artist)
        clean_song = self._clean_term(song)

        if clean_artist.lower() in ("unknown", "unknown artist", ""):
            query = f'recording:"{clean_song}"'
        else:
            query = f'artist:"{clean_artist}" AND recording:"{clean_song}"'

        params = {"query": query, "fmt": "json", "limit": "10"}
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}

        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await self._get_with_retry(
                client, MUSICBRAINZ_API, params=params, headers=headers,
            )
            data = resp.json()

        seen: set[str] = set()
        mbids: list[str] = []
        for recording in data.get("recordings", []):
            for release in recording.get("releases", []):
                mbid = release.get("id")
                if mbid and mbid not in seen:
                    seen.add(mbid)
                    mbids.append(mbid)
                    if len(mbids) >= MAX_RELEASE_ATTEMPTS:
                        return mbids
        return mbids

    async def _download_cover_art(
        self, release_mbid: str, dest: str
    ) -> str | None:
        """Try to download front cover art for a release MBID.

        Uses the Cover Art Archive /front redirect endpoint which is
        a single request (307 -> image). Returns the local path on success.
        """
        url = f"{COVERART_API}/{release_mbid}/front"
        headers = {"User-Agent": USER_AGENT}

        async with httpx.AsyncClient(
            timeout=TIMEOUT, follow_redirects=True,
        ) as client:
            try:
                resp = await self._get_with_retry(
                    client, url, headers=headers,
                )
            except httpx.HTTPStatusError as exc:
                # 404 means no cover art for this release — not an error.
                if exc.response.status_code == 404:
                    return None
                raise

            if resp.status_code == 200 and len(resp.content) > 1000:
                Path(dest).parent.mkdir(parents=True, exist_ok=True)
                with open(dest, "wb") as f:
                    f.write(resp.content)
                return dest

        return None

    async def fetch_artwork(
        self, artist: str, song: str, output_dir: str, filename: str = "cover.jpg"
    ) -> str | None:
        """Search for official artwork and download it.

        Returns the local file path on success, None on any failure.
        This method never raises — failures are logged and None is returned
        so callers can fall back to YouTube thumbnails.
        """
        try:
            mbids = await self._search_release_mbids(artist, song)
            if not mbids:
                logger.info("MusicBrainz: no releases found for '%s - %s'", artist, song)
                return None

            dest = os.path.join(output_dir, filename)

            # Try each release until we find one with cover art
            for mbid in mbids:
                path = await self._download_cover_art(mbid, dest)
                if path:
                    logger.info(
                        "Downloaded official artwork for '%s - %s' (release %s)",
                        artist, song, mbid,
                    )
                    return path

            logger.info(
                "Cover Art Archive: no artwork found across %d releases for '%s - %s'",
                len(mbids), artist, song,
            )
            return None

        except Exception as e:
            logger.warning("Artwork fetch failed for '%s - %s': %s", artist, song, e)
            return None
