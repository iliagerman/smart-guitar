"""YouTube service — search and download via yt-dlp.

Search is intentionally *not* proxied (it works fine and proxy adds cost/latency).
Downloads may use a proxy and, in production, optionally use a PO-token provider
sidecar to mitigate YouTube bot-check / PO-token enforcement.
"""

import asyncio
import logging
import os
import socket
import tempfile
import time
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlparse

import httpx
import yt_dlp  # pyright: ignore[reportMissingImports, reportMissingModuleSource]
import yt_dlp.extractor.youtube.pot._provider as _pot_provider  # pyright: ignore[reportMissingImports, reportMissingModuleSource]
from yt_dlp.utils import DownloadError  # pyright: ignore[reportMissingImports, reportMissingModuleSource]

from guitar_player.exceptions import (
    BadRequestError,
    YoutubeAuthenticationRequiredError,
)
from guitar_player.utils.youtube_filters import (
    ensure_official_query,
    extract_youtube_id_from_url,
    is_probable_live_performance_title,
)

logger = logging.getLogger(__name__)

# yt-dlp's plugin system re-registers providers on every YoutubeDL() instantiation,
# causing noisy "already registered" AssertionErrors. Patch to skip silently.
_orig_register = _pot_provider.register_provider_generic


def _idempotent_register(provider, base_class, registry):  # type: ignore[no-untyped-def]
    if provider.PROVIDER_KEY in registry:
        return provider
    return _orig_register(provider, base_class, registry)


_pot_provider.register_provider_generic = _idempotent_register


def _sanitize_song_name(title: str) -> str:
    """Create a filesystem-safe folder name from a song title."""
    safe = title.replace("/", "_").replace("\\", "_").replace(":", "_")
    safe = safe.replace('"', "").replace("'", "").replace("?", "").replace("*", "")
    safe = safe.strip(". ")
    return safe


def _looks_like_youtube_id(value: str) -> bool:
    s = (value or "").strip()
    if not s:
        return False
    if " " in s or "\t" in s or "\n" in s:
        return False
    if s.startswith("http://") or s.startswith("https://"):
        return False
    # Common YouTube video IDs are 11 chars, but don't hard-fail on that.
    return 8 <= len(s) <= 32


def _redact_proxy(proxy: str) -> str:
    """Return proxy host:port without userinfo."""
    try:
        parsed = urlparse(proxy)
        host = parsed.hostname or ""
        port = parsed.port
        if host and port:
            return f"{host}:{port}"
        if host:
            return host
        return "(invalid)"
    except Exception:
        return "(invalid)"


def _redact_file_path(path: str) -> str:
    try:
        return Path(path).name
    except Exception:
        return "(invalid)"


class YoutubeService:
    def __init__(
        self,
        proxy: str | None = None,
        *,
        cookies_file: str | None = None,
        use_cookies_for_public_videos: bool = False,
        max_duration_seconds: int = 600,
        po_token_provider_enabled: bool = False,
        po_token_provider_base_url: str = "http://127.0.0.1:4416",
        po_token_provider_disable_innertube: bool = False,
        sleep_requests_seconds: float = 0.75,
        sleep_interval_seconds: float = 8.0,
        max_sleep_interval_seconds: float = 15.0,
    ) -> None:
        self._proxy = proxy
        self._cookies_file = (
            str(Path(cookies_file).expanduser()) if cookies_file else None
        )
        self._use_cookies_for_public_videos = use_cookies_for_public_videos
        self._max_duration_seconds = max_duration_seconds
        self._po_token_provider_enabled = po_token_provider_enabled
        self._po_token_provider_base_url = po_token_provider_base_url
        self._po_token_provider_disable_innertube = po_token_provider_disable_innertube
        self._sleep_requests_seconds = sleep_requests_seconds
        self._sleep_interval_seconds = sleep_interval_seconds
        self._max_sleep_interval_seconds = max_sleep_interval_seconds

        self._po_provider_checked = False
        self._po_provider_reachable = False
        self._cookies_checked = False
        self._cookies_available = False

        logger.info(
            "YoutubeService init: proxy=%s cookies=%s cookie_mode=%s po_provider=%s base_url=%s disable_innertube=%s",
            _redact_proxy(proxy) if proxy else "none",
            _redact_file_path(self._cookies_file) if self._cookies_file else "none",
            "public" if use_cookies_for_public_videos else "auth-only",
            po_token_provider_enabled,
            po_token_provider_base_url,
            po_token_provider_disable_innertube,
        )

    def _check_cookies_available(self) -> None:
        if self._cookies_checked:
            return

        self._cookies_checked = True
        if not self._cookies_file:
            return

        cookie_path = Path(self._cookies_file)
        if not cookie_path.exists() or not cookie_path.is_file():
            logger.warning(
                "YouTube cookies file is configured but missing: %s",
                _redact_file_path(self._cookies_file),
            )
            return

        if cookie_path.stat().st_size <= 0:
            logger.warning(
                "YouTube cookies file is configured but empty: %s",
                _redact_file_path(self._cookies_file),
            )
            return

        self._cookies_available = True
        logger.info(
            "YouTube cookies file available: %s",
            _redact_file_path(self._cookies_file),
        )

    def _yt_dlp_cookiefile(self) -> str | None:
        self._check_cookies_available()
        if self._cookies_available:
            return self._cookies_file
        return None

    def _youtube_auth_error_message(self) -> str:
        cookiefile = self._yt_dlp_cookiefile()
        if cookiefile:
            return (
                "YouTube authentication required for this video. "
                "Refresh the configured YouTube cookies file and try again."
            )
        if self._cookies_file:
            return (
                "Configured YouTube cookies file is missing or unreadable. "
                "Refresh the deployed YouTube cookies file and try again."
            )
        return (
            "YouTube authentication required for this video. "
            "Configure a YouTube cookies file and try again."
        )

    def _check_po_provider_reachable(self) -> None:
        """Best-effort check that the provider sidecar is reachable.

        In ECS/Fargate tasks, all containers in a task share a network namespace,
        so the sidecar should be reachable via localhost.
        """
        if self._po_provider_checked or not self._po_token_provider_enabled:
            return

        self._po_provider_checked = True
        try:
            parsed = urlparse(self._po_token_provider_base_url)
            host = parsed.hostname or "127.0.0.1"
            port = parsed.port or 4416
            with socket.create_connection((host, port), timeout=1.0):
                pass
            self._po_provider_reachable = True
            logger.info(
                "PO-token provider reachable at %s", self._po_token_provider_base_url
            )
        except Exception as exc:
            self._po_provider_reachable = False
            logger.warning(
                "PO-token provider not reachable at %s (%s). yt-dlp may still hit bot checks.",
                self._po_token_provider_base_url,
                exc,
            )

    def _base_opts(
        self, *, use_proxy: bool, include_cookies: bool = True
    ) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "http_headers": {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            },
        }

        if include_cookies:
            cookiefile = self._yt_dlp_cookiefile()
            if cookiefile:
                opts["cookiefile"] = cookiefile

        if use_proxy and self._proxy:
            opts["proxy"] = self._proxy
            opts["socket_timeout"] = 120
            # Keep networking consistent. (Bind to IPv4)
            opts["source_address"] = "0.0.0.0"

        return opts

    def _download_extractor_args(self) -> dict[str, dict[str, list[str]]]:
        """Extractor args applied only for downloads."""
        if not self._po_token_provider_enabled:
            return {}

        # yt-dlp expects: extractor -> arg -> list[str]
        args: dict[str, dict[str, list[str]]] = {
            "youtube": {
                # Prefer mweb first; fall back to defaults if needed.
                # (CLI uses player-client; in API it's player_client)
                "player_client": ["mweb", "default"],
                # Be explicit: always attempt fetching PO tokens from providers.
                "fetch_pot": ["always"],
            },
            # bgutil-ytdlp-pot-provider plugin (HTTP server mode)
            "youtubepot-bgutilhttp": {
                "base_url": [self._po_token_provider_base_url],
            },
        }

        if self._po_token_provider_disable_innertube:
            args["youtubepot-bgutilhttp"]["disable_innertube"] = ["1"]

        return args

    @staticmethod
    def _is_probable_youtube_bot_check(exc: Exception) -> bool:
        msg = str(exc).lower()
        needles = [
            "not a bot",
            "captcha",
            "too many requests",
            "http error 429",
            "rate limit",
        ]
        return any(n in msg for n in needles)

    @staticmethod
    def _is_format_not_available(exc: Exception) -> bool:
        return "requested format is not available" in str(exc).lower()

    @staticmethod
    def _is_probable_youtube_auth_error(exc: Exception) -> bool:
        msg = str(exc).lower()
        needles = [
            "sign in to confirm your age",
            "age-restricted",
            "use --cookies",
            "authentication required",
            "members-only",
            "login required",
        ]
        return any(n in msg for n in needles)

    @staticmethod
    def _is_probable_proxy_transport_error(exc: Exception) -> bool:
        msg = str(exc).lower()
        needles = [
            "unable to connect to proxy",
            "proxyerror",
            "tunnel connection failed",
            "proxy authentication required",
            "407 proxy authentication required",
            "502 bad gateway",
            "http error 502",
            "connection to proxy closed",
            "remote end closed connection without response",
        ]
        return any(n in msg for n in needles)

    @staticmethod
    def _without_proxy(ydl_opts: dict[str, Any]) -> dict[str, Any]:
        direct_opts = dict(ydl_opts)
        direct_opts.pop("proxy", None)
        direct_opts.pop("socket_timeout", None)
        direct_opts.pop("source_address", None)
        return direct_opts

    def _extract_thumbnail_url(self, entry: dict[str, Any]) -> str | None:
        thumb = entry.get("thumbnail")
        if isinstance(thumb, str) and thumb:
            return thumb

        thumbs = entry.get("thumbnails")
        if isinstance(thumbs, list) and thumbs:
            # Prefer the last (often highest-res)
            last = thumbs[-1]
            if isinstance(last, dict):
                url = last.get("url")
                if isinstance(url, str) and url:
                    return url
        return None

    def _extract_video_info_with_retries(
        self,
        ydl_opts: dict[str, Any],
        url: str,
    ) -> tuple[list[Any], Any]:
        """Extract info for a single video URL with bot-check retries."""
        attempts = 3 if self._po_token_provider_enabled else 2
        last_exc: Exception | None = None
        current_opts = dict(ydl_opts)

        t0_total = time.monotonic()
        for idx in range(attempts):
            try:
                t0 = time.monotonic()
                with yt_dlp.YoutubeDL(cast(Any, current_opts)) as ydl:
                    result = ydl.extract_info(url, download=False)
                logger.info(
                    "TIMING extract_info(download=False) attempt %d took %.1fs [url=%s]",
                    idx + 1,
                    time.monotonic() - t0,
                    url,
                )
                return [result] if result else [], result
            except DownloadError as exc:
                logger.info(
                    "TIMING extract_info(download=False) attempt %d failed after %.1fs [url=%s]: %s",
                    idx + 1,
                    time.monotonic() - t0,
                    url,
                    exc,
                )
                last_exc = exc
                if self._is_probable_youtube_auth_error(exc):
                    raise YoutubeAuthenticationRequiredError(
                        self._youtube_auth_error_message()
                    ) from exc
                if current_opts.get(
                    "proxy"
                ) and self._is_probable_proxy_transport_error(exc):
                    logger.warning(
                        "yt-dlp metadata fetch hit proxy transport failure for %s; retrying direct: %s",
                        url,
                        exc,
                    )
                    current_opts = self._without_proxy(current_opts)
                    continue
                if idx < attempts - 1 and self._is_probable_youtube_bot_check(exc):
                    sleep_s = min(30.0, 5.0 * (2**idx))
                    logger.warning(
                        "yt-dlp search blocked for %s, sleeping %.1fs then retrying (elapsed %.1fs): %s",
                        url,
                        sleep_s,
                        time.monotonic() - t0_total,
                        exc,
                    )
                    time.sleep(sleep_s)
                    continue
                raise

        raise RuntimeError(f"yt-dlp search failed for {url}: {last_exc}") from last_exc

    def _search_sync(self, query: str, max_results: int = 10) -> list[dict]:
        """Search YouTube and return lightweight metadata.

        Keyword searches are unproxied (they work fine and proxy adds cost).
        Direct video-ID lookups use proxy + PO-token because YouTube applies
        the same bot-check enforcement as downloads.
        """
        t0_search = time.monotonic()
        if max_results <= 0:
            return []

        # Allow callers/UI to pass full YouTube URLs.
        extracted_id = extract_youtube_id_from_url(query)
        if extracted_id:
            query = extracted_id

        is_video_id = _looks_like_youtube_id(query)

        # Policy: prefer official uploads for keyword searches.
        if not is_video_id:
            query = ensure_official_query(query)

        # Video-ID lookups need the same protections as downloads.
        use_proxy = is_video_id and bool(self._proxy)
        ydl_opts: dict[str, Any] = {
            **self._base_opts(
                use_proxy=use_proxy,
                include_cookies=self._use_cookies_for_public_videos,
            ),
            "extract_flat": not is_video_id,
        }

        if is_video_id:
            # We only need metadata, so ignore format errors that the mweb
            # player client can trigger (limited format lists).
            ydl_opts["ignore_no_formats_error"] = True
            if self._po_token_provider_enabled:
                self._check_po_provider_reachable()
            extractor_args = self._download_extractor_args()
            if extractor_args:
                ydl_opts["extractor_args"] = extractor_args

        if is_video_id:
            url = f"https://www.youtube.com/watch?v={query.strip()}"
            entries, result = self._extract_video_info_with_retries(ydl_opts, url)
        else:
            # We filter out live-performance results, so we over-fetch to avoid
            # returning fewer than requested.
            fetch_n = min(max_results * 5, 50)
            t0 = time.monotonic()
            with yt_dlp.YoutubeDL(cast(Any, ydl_opts)) as ydl:
                result = ydl.extract_info(
                    f"ytsearch{fetch_n}:{query}",
                    download=False,
                )
                entries = result.get("entries", []) if result else []
            logger.info(
                "TIMING keyword search took %.1fs [query=%s]",
                time.monotonic() - t0,
                query,
            )

        results: list[dict] = []
        for entry in entries:
            if not entry:
                continue
            entry = cast(dict[str, Any], entry)
            title = entry.get("title") or ""

            # Policy: skip live concerts/shows for keyword searches.
            # (Video-ID lookups are left unfiltered so callers can still inspect
            # metadata and decide what to do.)
            if not is_video_id and is_probable_live_performance_title(title):
                continue

            # Policy: skip videos longer than the configured max duration.
            duration = entry.get("duration")
            if (
                not is_video_id
                and self._max_duration_seconds > 0
                and isinstance(duration, (int, float))
                and duration > self._max_duration_seconds
            ):
                continue

            youtube_id = entry.get("id") or ""
            results.append(
                {
                    "youtube_id": youtube_id,
                    "title": title,
                    "artist": entry.get("uploader") or entry.get("channel"),
                    "duration_seconds": entry.get("duration"),
                    "thumbnail_url": self._extract_thumbnail_url(entry),
                    "view_count": entry.get("view_count"),
                }
            )

            if not is_video_id and len(results) >= max_results:
                break

        logger.info(
            "TIMING _search_sync total %.1fs [query=%s, is_video_id=%s, results=%d]",
            time.monotonic() - t0_search,
            query,
            is_video_id,
            len(results),
        )
        return results

    async def search(self, query: str, max_results: int = 10) -> list[dict]:
        return await asyncio.to_thread(self._search_sync, query, max_results)

    async def fetch_title(self, youtube_id: str) -> str | None:
        """Fetch just the video title via YouTube oEmbed (no PO-token/proxy needed).

        Returns the title string or None if the video is unavailable.
        This is much faster than a full search() call for video-ID lookups.
        """
        url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={youtube_id}&format=json"
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url)
            if resp.status_code == 200:
                title = resp.json().get("title")
                logger.info(
                    "TIMING fetch_title (oEmbed) took %.1fs [yt=%s]",
                    time.monotonic() - t0,
                    youtube_id,
                )
                return title
            logger.warning(
                "oEmbed returned %d for %s (%.1fs)",
                resp.status_code,
                youtube_id,
                time.monotonic() - t0,
            )
            return None
        except Exception as exc:
            logger.warning(
                "oEmbed failed for %s (%.1fs): %s",
                youtube_id,
                time.monotonic() - t0,
                exc,
            )
            return None

    def _download_sync(
        self, youtube_id: str, output_dir: str, *, skip_preflight: bool = False
    ) -> tuple[str, str, dict[str, Any]]:
        """Download OGG Vorbis audio for a YouTube video.

        Returns (local_ogg_path, song_name, metadata) where metadata contains
        title, artist, duration_seconds, and thumbnail_url extracted during download.

        When *skip_preflight* is True the live-performance title check is
        skipped (caller already validated).
        """
        t0_total = time.monotonic()
        url = f"https://www.youtube.com/watch?v={youtube_id}"

        proxy_redacted = _redact_proxy(self._proxy) if self._proxy else "none"
        if self._po_token_provider_enabled:
            t0 = time.monotonic()
            self._check_po_provider_reachable()
            logger.info(
                "TIMING po_provider_reachable_check took %.1fs [yt=%s]",
                time.monotonic() - t0,
                youtube_id,
            )

        if skip_preflight:
            logger.info(
                "Skipping preflight metadata check for %s (caller validated)",
                youtube_id,
            )
        else:
            # Policy: refuse probable live performance/concert recordings.
            # Fail closed: if we cannot verify metadata, do not download.
            # Skip format resolution and PO-token/mweb extractor args —
            # we only need the title, so a lightweight metadata fetch is
            # enough and avoids minutes of innertube round-trips.
            t0 = time.monotonic()
            preflight_opts: dict[str, Any] = {
                **self._base_opts(
                    use_proxy=bool(self._proxy),
                    include_cookies=self._use_cookies_for_public_videos,
                ),
                "extract_flat": False,
                "skip_download": True,
                "ignore_no_formats_error": True,
            }

            try:
                _entries, preflight = self._extract_video_info_with_retries(
                    preflight_opts, url
                )
                preflight_d = cast(dict[str, Any], preflight) if preflight else {}
                preflight_title = cast(str, preflight_d.get("title") or "")
            except YoutubeAuthenticationRequiredError:
                raise
            except Exception as exc:
                logger.warning(
                    "YouTube metadata preflight failed for %s; refusing download: %s",
                    youtube_id,
                    exc,
                )
                raise BadRequestError(
                    "Could not verify YouTube video metadata; please try again."
                ) from exc
            finally:
                logger.info(
                    "TIMING preflight metadata took %.1fs [yt=%s]",
                    time.monotonic() - t0,
                    youtube_id,
                )

            if not preflight_title:
                raise BadRequestError(
                    "Could not verify YouTube video title; please try again."
                )

            if is_probable_live_performance_title(preflight_title):
                raise BadRequestError(
                    f"Refusing to download probable live performance: {preflight_title}"
                )

        # Attempt with proxy, then without on hard blocks.
        attempts = [True, False] if self._proxy else [False]
        last_exc: Exception | None = None

        for use_proxy in attempts:
            label = f"proxy={proxy_redacted}" if use_proxy else "direct"
            logger.info(
                "yt-dlp download start %s (%s, cookies=%s)",
                youtube_id,
                label,
                "on" if self._use_cookies_for_public_videos else "off",
            )

            ydl_opts: dict[str, Any] = {
                **self._base_opts(
                    use_proxy=use_proxy,
                    include_cookies=self._use_cookies_for_public_videos,
                ),
                "format": "bestaudio/best",
                "outtmpl": os.path.join(output_dir, "%(title)s.%(ext)s"),
                # Reduce rate-limit / bot-check likelihood
                "sleep_requests": self._sleep_requests_seconds,
                "sleep_interval": self._sleep_interval_seconds,
                "max_sleep_interval": self._max_sleep_interval_seconds,
                # Be more resilient on transient failures
                "retries": 10,
                "fragment_retries": 10,
                "extractor_retries": 3,
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "192",
                    }
                ],
            }

            extractor_args = self._download_extractor_args()
            if extractor_args:
                ydl_opts["extractor_args"] = extractor_args

            try:
                outer_attempts = 3 if self._po_token_provider_enabled else 2
                info: Any = None
                for outer_idx in range(outer_attempts):
                    try:
                        t0_dl = time.monotonic()
                        with yt_dlp.YoutubeDL(cast(Any, ydl_opts)) as ydl:
                            info = ydl.extract_info(url, download=True)
                        logger.info(
                            "TIMING extract_info(download=True) attempt %d took %.1fs [yt=%s, %s]",
                            outer_idx + 1,
                            time.monotonic() - t0_dl,
                            youtube_id,
                            label,
                        )
                        break
                    except DownloadError as exc:
                        logger.info(
                            "TIMING extract_info(download=True) attempt %d failed after %.1fs [yt=%s, %s]: %s",
                            outer_idx + 1,
                            time.monotonic() - t0_dl,
                            youtube_id,
                            label,
                            exc,
                        )
                        last_exc = exc
                        if self._is_probable_youtube_auth_error(exc):
                            cookiefile = self._yt_dlp_cookiefile()
                            if cookiefile and not ydl_opts.get("cookiefile"):
                                logger.warning(
                                    "YouTube auth required for %s (%s) without cookies — retrying with cookies",
                                    youtube_id,
                                    label,
                                )
                                ydl_opts["cookiefile"] = cookiefile
                                continue
                            raise YoutubeAuthenticationRequiredError(
                                self._youtube_auth_error_message()
                            ) from exc
                        is_block = self._is_probable_youtube_bot_check(exc)
                        if outer_idx < outer_attempts - 1 and is_block:
                            sleep_s = min(60.0, 5.0 * (2**outer_idx))
                            logger.warning(
                                "yt-dlp blocked for %s (%s), sleeping %.1fs then retrying: %s",
                                youtube_id,
                                label,
                                sleep_s,
                                exc,
                            )
                            time.sleep(sleep_s)
                            continue
                        raise

                if not info:
                    raise RuntimeError(f"yt-dlp returned no info for {youtube_id}")

                info_d = cast(dict[str, Any], info)
                title = info_d.get("title") or youtube_id
                song_name = _sanitize_song_name(cast(str, title))

                meta: dict[str, Any] = {
                    "youtube_id": youtube_id,
                    "title": title,
                    "artist": info_d.get("uploader") or info_d.get("channel"),
                    "duration_seconds": info_d.get("duration"),
                    "thumbnail_url": self._extract_thumbnail_url(info_d),
                }

                audio_files = [
                    os.path.join(output_dir, f)
                    for f in os.listdir(output_dir)
                    if f.lower().endswith(".mp3")
                ]
                if audio_files:
                    audio_files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
                    logger.info(
                        "TIMING _download_sync total %.1fs [yt=%s]",
                        time.monotonic() - t0_total,
                        youtube_id,
                    )
                    return audio_files[0], song_name, meta

                raise FileNotFoundError(f"Downloaded audio not found in {output_dir}")

            except DownloadError as exc:
                last_exc = exc
                if self._is_probable_youtube_auth_error(exc):
                    raise YoutubeAuthenticationRequiredError(
                        self._youtube_auth_error_message()
                    ) from exc
                logger.warning(
                    "yt-dlp DownloadError for %s (%s): %s", youtube_id, label, exc
                )
                # Expired/invalid cookies can cause YouTube to return no
                # usable formats.  Retry without cookies before giving up.
                if self._is_format_not_available(exc) and ydl_opts.get("cookiefile"):
                    logger.warning(
                        "Format not available with cookies for %s — retrying without cookies (cookies may be expired)",
                        youtube_id,
                    )
                    ydl_opts.pop("cookiefile", None)
                    try:
                        with yt_dlp.YoutubeDL(cast(Any, ydl_opts)) as ydl:
                            info = ydl.extract_info(url, download=True)
                        if info:
                            info_d = cast(dict[str, Any], info)
                            title = info_d.get("title") or youtube_id
                            song_name = _sanitize_song_name(cast(str, title))
                            meta = {
                                "youtube_id": youtube_id,
                                "title": title,
                                "artist": info_d.get("uploader")
                                or info_d.get("channel"),
                                "duration_seconds": info_d.get("duration"),
                                "thumbnail_url": self._extract_thumbnail_url(info_d),
                            }
                            audio_files = [
                                os.path.join(output_dir, f)
                                for f in os.listdir(output_dir)
                                if f.lower().endswith(".mp3")
                            ]
                            if audio_files:
                                audio_files.sort(
                                    key=lambda p: os.path.getmtime(p), reverse=True
                                )
                                return audio_files[0], song_name, meta
                    except DownloadError:
                        pass  # fall through to existing retry logic

                # If the proxy is blocked, try direct.
                if use_proxy and (
                    "403" in str(exc)
                    or self._is_probable_youtube_bot_check(exc)
                    or self._is_probable_proxy_transport_error(exc)
                ):
                    logger.info(
                        "Retrying %s without proxy after proxy failure…", youtube_id
                    )
                    continue
                break

        logger.error(
            "yt-dlp failed for %s after all attempts: %s", youtube_id, last_exc
        )
        raise RuntimeError(
            f"YouTube download failed for {youtube_id}: {last_exc}"
        ) from last_exc

    async def download(
        self,
        youtube_id: str,
        output_dir: str | None = None,
        *,
        skip_preflight: bool = False,
    ) -> tuple[str, str, dict[str, Any]]:
        if output_dir is None:
            output_dir = tempfile.mkdtemp(prefix="yt_download_")
        return await asyncio.to_thread(
            self._download_sync, youtube_id, output_dir, skip_preflight=skip_preflight
        )

    async def download_thumbnail(self, youtube_id: str, output_dir: str) -> str:
        urls = [
            f"https://img.youtube.com/vi/{youtube_id}/maxresdefault.jpg",
            f"https://img.youtube.com/vi/{youtube_id}/hqdefault.jpg",
        ]
        dest = os.path.join(output_dir, f"{youtube_id}.jpg")

        async with httpx.AsyncClient(timeout=15) as client:
            for url in urls:
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200 and len(resp.content) > 1000:
                        Path(dest).parent.mkdir(parents=True, exist_ok=True)
                        with open(dest, "wb") as f:
                            f.write(resp.content)
                        return dest
                except httpx.HTTPError:
                    continue

        raise FileNotFoundError(f"Could not download thumbnail for {youtube_id}")
