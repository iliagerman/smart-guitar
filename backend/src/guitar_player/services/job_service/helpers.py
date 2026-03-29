"""Utility functions for job processing pipeline."""

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Sequence

from guitar_player.storage import StorageBackend

from .constants import (
    ADMIN_HEAL_LOG_THROTTLE_SECONDS,
    CANONICAL_TO_DEMUCS_OUTPUT,
    DEMUCS_OUTPUT_KEYS,
    DERIVED_STEMS,
    NON_LATIN_RE,
    PROCESS_STARTED_AT,
    RAW_CANONICAL_STEMS,
    STALE_ACTIVE_JOB_AFTER_SECONDS,
    STEM_EXT,
    TUTORIAL_DOMAIN_BONUS,
    TUTORIAL_NEGATIVE,
    TUTORIAL_POSITIVE,
)

logger = logging.getLogger(__name__)

# In-memory best-effort throttle for admin heal INFO logs.
_LAST_ADMIN_HEAL_INFO_LOG: dict[tuple[str, uuid.UUID], float] = {}


def score_tutorial_link(title: str, url: str) -> int:
    """Score a link: positive = likely tutorial, negative = likely music video."""
    score = 0
    t = title.lower()
    for kw in TUTORIAL_POSITIVE:
        if kw in t:
            score += 10
    for kw in TUTORIAL_NEGATIVE:
        if kw in t:
            score -= 15
    for domain in TUTORIAL_DOMAIN_BONUS:
        if domain in url:
            score += 20
    return score


async def search_youtube_tutorial(
    title: str, artist: str
) -> tuple[str, list[dict]]:
    """Search YouTube for guitar tutorials when Tavily has none.

    Returns (best_url, all_links) where all_links is a list of
    {"url", "title"} dicts sorted by score descending.
    """
    import yt_dlp
    from guitar_player.services.llm_service import _tutorial_search_suffix

    query = f"{title} {artist} {_tutorial_search_suffix(title, artist)}"

    def _search() -> tuple[str, list[dict]]:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
            "skip_download": True,
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                result = ydl.extract_info(f"ytsearch5:{query}", download=False)
                entries = result.get("entries", []) if result else []
        except Exception as e:
            logger.warning("YouTube tutorial fallback search failed: %s", e)
            return "", []

        if not entries:
            return "", []

        candidates = []
        for entry in entries:
            if not entry:
                continue
            vid_title = entry.get("title") or ""
            vid_id = entry.get("id") or ""
            url = f"https://www.youtube.com/watch?v={vid_id}"
            score = score_tutorial_link(vid_title, url)
            candidates.append((url, vid_title, score))

        if not candidates:
            return "", []

        candidates.sort(key=lambda x: x[2], reverse=True)
        best_url, best_title, best_score = candidates[0]
        logger.info(
            "YouTube fallback tutorial selected: %r (%r, score=%d) "
            "from %d candidates for %r by %r",
            best_url, best_title, best_score, len(candidates), title, artist,
        )
        all_links = [{"url": u, "title": t} for u, t, _s in candidates]
        return best_url, all_links

    return await asyncio.to_thread(_search)


def stem_candidates(song_name: str, *stem_names: str) -> list[str]:
    """Return candidate storage keys for *stem_names*."""
    return [f"{song_name}/{name}{STEM_EXT}" for name in stem_names]


def find_stem(storage: StorageBackend, song_name: str, stem: str) -> str | None:
    """Find a stem file on disk."""
    key = f"{song_name}/{stem}{STEM_EXT}"
    return key if storage.file_exists(key) else None


def has_non_latin_text(*texts: str | None) -> bool:
    """Return True if any of the provided texts contain non-Latin script characters."""
    return any(NON_LATIN_RE.search(t) for t in texts if t)


def should_log_admin_heal_info(action: str, song_id: uuid.UUID) -> bool:
    now = time.monotonic()
    key = (action, song_id)
    last = _LAST_ADMIN_HEAL_INFO_LOG.get(key)
    if last is not None and (now - last) < ADMIN_HEAL_LOG_THROTTLE_SECONDS:
        return False
    _LAST_ADMIN_HEAL_INFO_LOG[key] = now
    return True


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_aware_utc(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def is_stale_active_job(updated_at: datetime | None, *, now: datetime) -> bool:
    if updated_at is None:
        return False
    updated = to_aware_utc(updated_at)
    age_s = (now - updated).total_seconds()
    return age_s > STALE_ACTIVE_JOB_AFTER_SECONDS


def active_job_stale_reason(
    updated_at: datetime | None, *, now: datetime
) -> str | None:
    """Return a failure reason when an active job should be treated as stale.

    In local dev, background processing runs in-process. If the backend
    restarts, those asyncio tasks disappear even though the DB row still
    says PENDING/PROCESSING. Treat such jobs as stale immediately.
    """
    if is_stale_active_job(updated_at, now=now):
        return "Job timed out"

    try:
        from guitar_player.config import get_settings

        settings = get_settings()
        has_orchestrator = bool(
            getattr(getattr(settings, "lambdas", None), "job_orchestrator", None)
        )
    except Exception:
        has_orchestrator = False

    if has_orchestrator or updated_at is None:
        return None

    if to_aware_utc(updated_at) < PROCESS_STARTED_AT:
        return "Job interrupted by backend restart"

    return None


def to_demucs_requested_outputs(descriptions: Sequence[str] | None) -> list[str]:
    """Translate job descriptions to demucs requested_outputs.

    Accepts either canonical stem names ("guitar") *or* demucs output keys
    ("guitar_isolated") for backward compatibility.
    """
    if not descriptions:
        return []

    out: list[str] = []
    for raw in descriptions:
        key = str(raw)

        if key in RAW_CANONICAL_STEMS or key in DERIVED_STEMS:
            continue

        if key in DEMUCS_OUTPUT_KEYS:
            mapped = key
        else:
            mapped = CANONICAL_TO_DEMUCS_OUTPUT.get(key)

        if not mapped:
            logger.warning(
                "Unknown stem description '%s' in job payload; "
                "skipping demucs output request",
                key,
            )
            continue

        if mapped not in out:
            out.append(mapped)

    return out
