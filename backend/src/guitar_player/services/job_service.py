"""Job service — creates and tracks processing jobs."""

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
import tempfile
import time
from typing import Sequence

import httpx

from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.database import safe_session
from guitar_player.app_state import get_storage
from guitar_player.exceptions import NotFoundError
from guitar_player.schemas.job import JobResponse
from guitar_player.schemas.records import JobRecord, SongRecord
from guitar_player.services.processing_service import ProcessingService
from guitar_player.services.llm_service import LlmService
from guitar_player.services.youtube_service import YoutubeService
from guitar_player.request_context import request_id_var, user_id_var
from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)

_STEM_EXT = ".mp3"
_PROCESS_STARTED_AT = datetime.now(timezone.utc)


def _stem_candidates(song_name: str, *stem_names: str) -> list[str]:
    """Return candidate storage keys for *stem_names*."""
    return [f"{song_name}/{name}{_STEM_EXT}" for name in stem_names]


def _find_stem(storage: StorageBackend, song_name: str, stem: str) -> str | None:
    """Find a stem file on disk."""
    key = f"{song_name}/{stem}{_STEM_EXT}"
    return key if storage.file_exists(key) else None


# If the API process restarts while a job is PENDING/PROCESSING, the DB can be left
# with an "active" job that no longer has a running background task. That would
# block admin healing forever. Consider such jobs stale after this many seconds.
_STALE_ACTIVE_JOB_AFTER_SECONDS = 60 * 16  # 16 minutes

# Cooldown for lightweight background tasks (lyrics/merge).
# Prevents re-enqueuing on every UI poll after a task completes or fails.
_LIGHTWEIGHT_TASK_COOLDOWN_SECONDS = 300  # 5 minutes


# Throttle INFO logs for repeated "blocked" outcomes (e.g., missing stems while
# the UI polls). Keyed by (action, song_id). This is in-memory best-effort.
_ADMIN_HEAL_LOG_THROTTLE_SECONDS = 600  # 10 minutes
_LAST_ADMIN_HEAL_INFO_LOG: dict[tuple[str, uuid.UUID], float] = {}

# Bump this to allow a one-time lyrics re-transcription via OpenAI on next deploy.
_CURRENT_LYRICS_HEAL_VERSION = 2

# Regex matching characters from non-Latin scripts (Hebrew, Arabic, CJK, etc.)
_NON_LATIN_RE = re.compile(
    r"[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F"
    r"\u3000-\u9FFF\uAC00-\uD7AF\u1100-\u11FF]"
)


def _has_non_latin_text(*texts: str | None) -> bool:
    """Return True if any of the provided texts contain non-Latin script characters."""
    return any(_NON_LATIN_RE.search(t) for t in texts if t)


def _should_log_admin_heal_info(action: str, song_id: uuid.UUID) -> bool:
    now = time.monotonic()
    key = (action, song_id)
    last = _LAST_ADMIN_HEAL_INFO_LOG.get(key)
    if last is not None and (now - last) < _ADMIN_HEAL_LOG_THROTTLE_SECONDS:
        return False
    _LAST_ADMIN_HEAL_INFO_LOG[key] = now
    return True


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_aware_utc(dt: datetime) -> datetime:
    # Some DB drivers may return naive datetimes even when timezone=True.
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _is_stale_active_job(updated_at: datetime | None, *, now: datetime) -> bool:
    if updated_at is None:
        return False
    updated = _to_aware_utc(updated_at)
    age_s = (now - updated).total_seconds()
    return age_s > _STALE_ACTIVE_JOB_AFTER_SECONDS


def _active_job_stale_reason(
    updated_at: datetime | None, *, now: datetime
) -> str | None:
    """Return a failure reason when an active job should be treated as stale.

    In local dev we often run background processing in-process (no external
    orchestrator). If the backend restarts, those asyncio tasks disappear even
    though the DB row still says PENDING/PROCESSING. Treat such jobs as stale
    immediately so the next page refresh can resume processing.
    """
    if _is_stale_active_job(updated_at, now=now):
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

    if _to_aware_utc(updated_at) < _PROCESS_STARTED_AT:
        return "Job interrupted by backend restart"

    return None


# Maps demucs output stem names to Song model field base names.
STEM_NAME_MAP: dict[str, str] = {
    "guitar": "guitar",
    "vocals": "vocals",
    "guitar_removed": "guitar_removed",
}

# Stems we do not keep in storage or UI.
# Demucs may still produce them, but we delete them immediately after separation.
_UNWANTED_STEMS: set[str] = {"drums", "bass", "piano", "other"}

DEFAULT_REQUESTED_OUTPUTS = ["guitar_isolated", "vocals_isolated", "guitar_removed"]

# Demucs service expects *output keys* (e.g. "guitar_isolated"), while the frontend
# and SongService use canonical stem names (e.g. "guitar"). Translate here so
# job payloads can stay stable even if the demucs microservice contract differs.
_DEMUCS_OUTPUT_KEYS: set[str] = {
    "guitar_isolated",
    "vocals_isolated",
    "guitar_removed",
    "vocals_removed",
}

_CANONICAL_TO_DEMUCS_OUTPUT: dict[str, str] = {
    # canonical -> demucs output key
    "guitar": "guitar_isolated",
    "vocals": "vocals_isolated",
    "guitar_removed": "guitar_removed",
    "vocals_removed": "vocals_removed",
}


# Canonical stems that are *raw* demucs stems (not requested_outputs keys).
# Our demucs service always writes these stems alongside the requested derived
# mixes, so we don't need to translate them into requested_outputs.
_RAW_CANONICAL_STEMS: set[str] = {"drums", "bass", "piano", "other"}


def _to_demucs_requested_outputs(descriptions: Sequence[str] | None) -> list[str]:
    """Translate job descriptions to demucs requested_outputs.

    Accepts either canonical stem names ("guitar") *or* demucs output keys
    ("guitar_isolated") for backward compatibility.

    Unknown descriptions are ignored (but logged).
    """

    if not descriptions:
        return []

    out: list[str] = []
    for raw in descriptions:
        key = str(raw)

        # These are raw demucs stems that are always produced, or derived
        # stems generated by post-processing; don't warn and don't attempt
        # to map them to requested_outputs.
        if key in _RAW_CANONICAL_STEMS or key in _DERIVED_STEMS:
            continue

        if key in _DEMUCS_OUTPUT_KEYS:
            mapped = key
        else:
            mapped = _CANONICAL_TO_DEMUCS_OUTPUT.get(key)

        if not mapped:
            logger.warning(
                "Unknown stem description '%s' in job payload; skipping demucs output request",
                key,
            )
            continue

        if mapped not in out:
            out.append(mapped)

    return out


_STEM_FILE_VARIANTS: dict[str, list[str]] = {
    "guitar": ["guitar.mp3", "guitar_isolated.mp3"],
    "vocals": ["vocals.mp3", "vocals_isolated.mp3"],
    "guitar_removed": ["guitar_removed.mp3"],
    "vocals_guitar": ["vocals_guitar.mp3"],
}

# Derived stems are generated by post-processing (not by Demucs directly).
# A missing derived stem should NOT trigger a full Demucs reprocess.
_DERIVED_STEMS: set[str] = {"vocals_guitar"}


# ---- Vocals+guitar merge background task ----

_MERGE_TASKS: dict[uuid.UUID, asyncio.Task] = {}


def _enqueue_vocals_guitar_merge(song_id: uuid.UUID) -> None:
    """Fire-and-forget vocals+guitar merge in the background."""
    existing = _MERGE_TASKS.get(song_id)
    if existing and not existing.done():
        return

    task = asyncio.create_task(_merge_vocals_guitar_only(song_id))
    _MERGE_TASKS[song_id] = task

    def _done(t: asyncio.Task) -> None:
        if _MERGE_TASKS.get(song_id) is t:
            _MERGE_TASKS.pop(song_id, None)

    task.add_done_callback(_done)


# ---- Lyrics-only background transcription ----

_LYRICS_TASKS: dict[uuid.UUID, asyncio.Task] = {}


def _enqueue_lyrics_transcription(
    song_id: uuid.UUID, *, quick_only: bool = False
) -> None:
    """Fire-and-forget lyrics transcription in the background.

    This is intentionally separate from the full Demucs+Chords job pipeline so
    we can fetch lyrics when *only* lyrics are missing.

    When *quick_only* is True, only lyrics_quick.json is produced (Whisper is
    skipped via the lyrics_generator's fast_only mode).
    """

    existing = _LYRICS_TASKS.get(song_id)
    if existing and not existing.done():
        return

    task = asyncio.create_task(_transcribe_lyrics_only(song_id, quick_only=quick_only))
    _LYRICS_TASKS[song_id] = task

    def _done(t: asyncio.Task) -> None:
        # Only clear if the same task is still stored (avoid races).
        if _LYRICS_TASKS.get(song_id) is t:
            _LYRICS_TASKS.pop(song_id, None)

    task.add_done_callback(_done)


# ---- Tabs-only background generation ----

_TABS_TASKS: dict[uuid.UUID, asyncio.Task] = {}


def _enqueue_tabs_generation(song_id: uuid.UUID) -> None:
    """Fire-and-forget tabs generation in the background."""
    existing = _TABS_TASKS.get(song_id)
    if existing and not existing.done():
        return

    task = asyncio.create_task(_generate_tabs_only(song_id))
    _TABS_TASKS[song_id] = task

    def _done(t: asyncio.Task) -> None:
        if _TABS_TASKS.get(song_id) is t:
            _TABS_TASKS.pop(song_id, None)

    task.add_done_callback(_done)


class JobService:
    def __init__(
        self,
        session,
        storage: StorageBackend,
    ) -> None:
        self._storage = storage
        self._job_dao = JobDAO(session)
        self._song_dao = SongDAO(session)
        self._user_dao = UserDAO(session)

    async def _refresh_active_job_if_stale(self, job: JobRecord) -> JobRecord:
        """Mark stale/orphaned active jobs failed and return the latest row."""
        if job.status not in ("PENDING", "PROCESSING"):
            return job

        reason = _active_job_stale_reason(
            getattr(job, "updated_at", None),
            now=_utcnow(),
        )
        if not reason:
            return job

        await self._job_dao.update_status(job.id, "FAILED", error_message=reason)

        song = await self._song_dao.get_by_id(job.song_id)
        if song and song.processing_job_id == job.id:
            await self._song_dao.update_by_id(song.id, processing_job_id=None)

        await self._job_dao.flush()
        refreshed = await self._job_dao.get_by_id(job.id)
        return refreshed or job

    async def create_and_process_job(
        self,
        user_sub: str,
        user_email: str,
        song_id: uuid.UUID,
        descriptions: list[str],
        mode: str = "isolate",
        processing: ProcessingService | None = None,
    ) -> JobResponse:
        """Create a job and (optionally) enqueue processing.

        Idempotent: if a non-stale active job already exists for this song,
        return it instead of creating a duplicate.  Uses a DB-level row lock
        (SELECT FOR UPDATE) via ``acquire_processing_lock`` to prevent races.

        This endpoint used to run Demucs + chord recognition synchronously.
        To enable progress reporting in the UI (and avoid request timeouts),
        processing now runs in a background task.
        """
        user = await self._user_dao.get_or_create(user_sub, user_email)

        # Acquire a row-level lock on the song to prevent concurrent job creation.
        song = await self._song_dao.acquire_processing_lock(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        # Idempotency: if a processing_job_id is set, check the referenced job.
        if song.processing_job_id:
            existing_job = await self._job_dao.get_by_id(song.processing_job_id)
            if existing_job and existing_job.status in ("PENDING", "PROCESSING"):
                reason = _active_job_stale_reason(
                    getattr(existing_job, "updated_at", None),
                    now=_utcnow(),
                )
                if reason:
                    await self._job_dao.update_status(
                        existing_job.id,
                        "FAILED",
                        error_message=reason,
                    )
                    await self._song_dao.update_by_id(song.id, processing_job_id=None)
                else:
                    logger.info(
                        "Idempotent job creation: returning existing active job %s for song %s",
                        existing_job.id,
                        song_id,
                    )
                    return self._enrich_job(existing_job)
            else:
                # Job doesn't exist or is already COMPLETED/FAILED — clear the lock.
                await self._song_dao.update_by_id(song.id, processing_job_id=None)

        # Reset failure flags so the full pipeline can retry.
        job = await self._job_dao.create(
            user_id=user.id,
            song_id=song.id,
            status="PENDING",
            progress=0,
            stage="queued",
            descriptions=descriptions,
            mode=mode,
        )

        # Set the processing lock to the new job and reset failure flags.
        await self._song_dao.update_by_id(
            song.id, processing_job_id=job.id, lyrics_failed=False, tabs_failed=False
        )

        # IMPORTANT: job processing runs in a *separate* DB session.
        # If we enqueue the background task before committing, Postgres won't
        # expose the new Job row to the worker yet, and the worker will bail
        # out thinking the job doesn't exist.
        if processing is not None:
            await self._song_dao.commit()

            # Write an initial "pending" manifest so the presigned S3 URL
            # the client polls never returns 404 (avoids noisy browser console errors).
            try:
                from guitar_player.job_status_manifest import write_job_status_manifest

                storage = get_storage()
                write_job_status_manifest(
                    storage,
                    song_name=song.song_name,
                    job_id=job.id,
                    song_id=song.id,
                    status="PENDING",
                    stage="queued",
                    progress=0,
                    min_interval_s=0,
                )
            except Exception:
                logger.debug("Failed to write initial job manifest", exc_info=True)

            try:
                from guitar_player.config import get_settings
                from guitar_player.services.lambda_invoke import invoke_event

                settings = get_settings()
                fn = getattr(
                    getattr(settings, "lambdas", None), "job_orchestrator", None
                )
                if fn:
                    await invoke_event(
                        region=settings.aws.region,
                        function_name=fn,
                        payload={"job_id": str(job.id)},
                    )
                else:
                    # Local fallback (no orchestrator configured).
                    _enqueue_job_processing(job.id)
            except Exception:
                logger.exception("Failed to dispatch job %s", job.id)
                _enqueue_job_processing(job.id)

        return self._enrich_job(job)

    async def trigger_reprocess(
        self,
        user_sub: str,
        user_email: str,
        song_id: uuid.UUID,
        processing: ProcessingService,
    ) -> uuid.UUID | None:
        """Admin: fix DB keys from existing files, or reprocess if truly missing.

        Returns the job ID if a reprocessing job was triggered, None if keys
        were fixed from existing files or a job is already running.
        """
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        # Policy: never keep drums/bass/piano/other stems.
        # If legacy keys/files exist, delete them and clear the DB columns.
        # This makes admin heal idempotent and prevents the UI from ever seeing them.
        cleared_changes: dict = {}
        for stem_name in sorted(_UNWANTED_STEMS):
            col = f"{stem_name}_key"
            existing_key = getattr(song, col, None)
            if existing_key:
                try:
                    if self._storage.file_exists(existing_key):
                        self._storage.delete_file(existing_key)
                except Exception:
                    logger.debug(
                        "Admin: failed deleting unwanted stem %s=%s",
                        col,
                        existing_key,
                        exc_info=True,
                    )
                cleared_changes[col] = None
            # Also delete conventional filenames, even if DB key is already NULL.
            candidate_key = f"{song.song_name}/{stem_name}{_STEM_EXT}"
            try:
                if self._storage.file_exists(candidate_key):
                    self._storage.delete_file(candidate_key)
            except Exception:
                logger.debug(
                    "Admin: failed deleting unwanted stem key %s",
                    candidate_key,
                    exc_info=True,
                )

        if cleared_changes:
            await self._song_dao.update_by_id(song.id, **cleared_changes)
            # Re-read song after update
            song = await self._song_dao.get_by_id(song_id)
            if not song:
                raise NotFoundError("Song", str(song_id))

        # Scan disk for stem/chords/lyrics files under alternate names and fix DB keys.
        # IMPORTANT: this method may be called from endpoints other than /stream, so it
        # must be safe to call even when nothing is missing.
        fixed = 0
        missing_any = False
        fix_changes: dict = {}

        for stem_name, variants in _STEM_FILE_VARIANTS.items():
            col = f"{stem_name}_key"
            current_key = getattr(song, col, None)

            stem_ok = bool(current_key) and self._storage.file_exists(current_key)
            if stem_ok:
                continue

            # Something about this stem is missing (no key, or key points to a missing file).
            stem_missing = True
            for filename in variants:
                candidate_key = f"{song.song_name}/{filename}"
                if self._storage.file_exists(candidate_key):
                    fix_changes[col] = candidate_key
                    logger.info("Admin: fixed %s -> %s", col, candidate_key)
                    fixed += 1
                    stem_missing = False
                    break

            if stem_missing and stem_name not in _DERIVED_STEMS:
                missing_any = True

        # Chords
        chords_ok = bool(song.chords_key) and self._storage.file_exists(song.chords_key)
        if not chords_ok:
            chords_candidate = f"{song.song_name}/chords.json"
            if self._storage.file_exists(chords_candidate):
                fix_changes["chords_key"] = chords_candidate
                fixed += 1
            else:
                missing_any = True

        # Lyrics: if present on disk, fix DB key; but *do not* trigger a full
        # demucs+chords reprocess solely because lyrics.json is missing.
        lyrics_ok = bool(song.lyrics_key) and self._storage.file_exists(song.lyrics_key)
        if not lyrics_ok:
            lyrics_candidate = f"{song.song_name}/lyrics.json"
            if self._storage.file_exists(lyrics_candidate):
                fix_changes["lyrics_key"] = lyrics_candidate
                fixed += 1

        if fix_changes:
            await self._song_dao.update_by_id(song.id, **fix_changes)

        # If nothing is missing after key-fixes, we're done.
        if not missing_any:
            return None

        # Files truly missing — trigger reprocess if no *non-stale* active job.
        active_job = await self._job_dao.get_active_job(song_id)
        if active_job is not None:
            reason = _active_job_stale_reason(
                getattr(active_job, "updated_at", None),
                now=_utcnow(),
            )
            if reason:
                await self._job_dao.update_status(
                    active_job.id,
                    "FAILED",
                    error_message=reason,
                )
                if song.processing_job_id == active_job.id:
                    await self._song_dao.update_by_id(song.id, processing_job_id=None)
            else:
                return None

        # Re-read song after potential updates
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        # Guard: don't trigger stem separation if the source audio is missing.
        audio_ok = bool(song.audio_key) and self._storage.file_exists(song.audio_key)
        if not audio_ok:
            logger.info(
                "Admin: skipping reprocess for song %s — audio missing (key=%r)",
                song_id,
                song.audio_key,
            )
            return None

        logger.info("Admin: triggering reprocess for song %s", song_id)
        job_resp = await self.create_and_process_job(
            user_sub=user_sub,
            user_email=user_email,
            song_id=song_id,
            descriptions=DEFAULT_REQUESTED_OUTPUTS,
            processing=processing,
        )
        return job_resp.id

    async def trigger_lyrics_transcription_if_missing(
        self,
        song_id: uuid.UUID,
    ) -> bool:
        """If lyrics are missing but vocals exist, enqueue a lyrics-only transcription.

        Returns True if a background transcription task was enqueued.

        Notes:
        - This does *not* create a Job row; the UI already polls song detail.
        - If a full processing job is active, we don't enqueue to avoid duplicate work.
        """

        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        # Determine whether full lyrics already exist before consulting the
        # failure gate. A previous full-transcription failure should no longer
        # block a fresh lyrics.json regeneration, but it should still block a
        # quick-lyrics-only retry when full lyrics already exist.
        lyrics_ok = bool(song.lyrics_key) and self._storage.file_exists(song.lyrics_key)
        if not lyrics_ok and song.song_name:
            lyrics_ok = self._storage.file_exists(f"{song.song_name}/lyrics.json")

        # A previous transcription attempt already failed — don't retry
        # automatically on every page load / poll. The user can trigger
        # a manual retry via the full reprocess flow if needed.
        #
        # Exception: allow a one-time retry when a new heal version is deployed
        # (bump _CURRENT_LYRICS_HEAL_VERSION).
        is_non_latin = _has_non_latin_text(song.title, song.artist, song.song_name)

        if song.lyrics_failed:
            needs_heal = (
                is_non_latin and song.lyrics_heal_version < _CURRENT_LYRICS_HEAL_VERSION
            )
            if needs_heal:
                logger.info(
                    "Admin heal: one-time lyrics retry "
                    "(heal_version %d -> %d) song_id=%s song_name=%r",
                    song.lyrics_heal_version,
                    _CURRENT_LYRICS_HEAL_VERSION,
                    song_id,
                    song.song_name,
                )
                await self._song_dao.update_by_id(
                    song.id,
                    lyrics_failed=False,
                    lyrics_attempted_at=None,
                    lyrics_heal_version=_CURRENT_LYRICS_HEAL_VERSION,
                )
                # Re-read song after update
                song = await self._song_dao.get_by_id(song_id)
                if not song:
                    return False
                lyrics_ok = bool(song.lyrics_key) and self._storage.file_exists(
                    song.lyrics_key
                )
                if not lyrics_ok and song.song_name:
                    lyrics_ok = self._storage.file_exists(
                        f"{song.song_name}/lyrics.json"
                    )
                # fall through to the rest of the method
            elif not lyrics_ok:
                logger.info(
                    "Admin heal: retrying full lyrics transcription despite "
                    "lyrics_failed=True song_id=%s song_name=%r",
                    song_id,
                    song.song_name,
                    extra={
                        "event_type": "admin_heal",
                        "action": "lyrics_only",
                        "song_id": str(song_id),
                        "outcome": "retrying",
                        "reason": "missing_lyrics_after_failure",
                    },
                )
                await self._song_dao.update_by_id(
                    song.id,
                    lyrics_failed=False,
                    lyrics_attempted_at=None,
                )
                song = await self._song_dao.get_by_id(song_id)
                if not song:
                    return False
            else:
                if _should_log_admin_heal_info("lyrics_only", song_id):
                    logger.info(
                        "Admin heal: lyrics-only blocked (lyrics_failed=True) "
                        "song_id=%s song_name=%r",
                        song_id,
                        song.song_name,
                        extra={
                            "event_type": "admin_heal",
                            "action": "lyrics_only",
                            "song_id": str(song_id),
                            "outcome": "blocked",
                            "reason": "lyrics_failed",
                        },
                    )
                return False

        # DB-based cooldown: don't re-enqueue if we attempted recently.
        if song.lyrics_attempted_at:
            age_s = (
                _utcnow() - _to_aware_utc(song.lyrics_attempted_at)
            ).total_seconds()
            if age_s < _LIGHTWEIGHT_TASK_COOLDOWN_SECONDS:
                logger.debug(
                    "Admin: skipping lyrics transcription for %s (attempted %.0fs ago)",
                    song_id,
                    age_s,
                )
                return False

        # Best-effort cleanup: if the DB claims there's an active job but it looks stale,
        # mark it failed so it doesn't block other admin healing flows.
        # IMPORTANT: do NOT block lyrics-only transcription just because a job row exists;
        # that state can be stale/incorrect after restarts and lyrics generation is safe
        # to run independently.
        active_job = await self._job_dao.get_active_job(song_id)
        if active_job is not None:
            reason = _active_job_stale_reason(
                getattr(active_job, "updated_at", None),
                now=_utcnow(),
            )
            if reason:
                await self._job_dao.update_status(
                    active_job.id,
                    "FAILED",
                    error_message=reason,
                )

        # If a lyrics-only transcription is already running (e.g., user is polling),
        # don't enqueue duplicates.
        existing_task = _LYRICS_TASKS.get(song_id)
        if existing_task and not existing_task.done():
            logger.debug(
                "Admin: lyrics-only transcription already in-flight for %s",
                song_id,
            )
            return False

        # Determine whether we need to generate anything.
        quick_ok = bool(song.lyrics_quick_key) and self._storage.file_exists(
            song.lyrics_quick_key
        )

        # If full lyrics exist, try to backfill quick_lyrics_key from disk.
        # If quick lyrics are missing, we now *do* attempt to generate them,
        # because the UI expects fast lyrics even when full lyrics already exist.
        if lyrics_ok and not quick_ok and song.song_name:
            quick_candidate = f"{song.song_name}/lyrics_quick.json"
            if self._storage.file_exists(quick_candidate):
                await self._song_dao.update_by_id(
                    song.id, lyrics_quick_key=quick_candidate
                )
                logger.info(
                    "Admin heal: backfilled lyrics_quick_key for song_id=%s "
                    "song_name=%r quick_candidate=%s",
                    song_id,
                    song.song_name,
                    quick_candidate,
                    extra={
                        "event_type": "admin_heal",
                        "action": "lyrics_only",
                        "song_id": str(song_id),
                        "outcome": "backfilled",
                        "reason": "quick_file_exists",
                    },
                )
                return False

        # One-time re-transcription via OpenAI Whisper for better accuracy.
        # Triggers once per heal version bump for any song with existing lyrics.
        if (
            lyrics_ok
            and is_non_latin
            and song.lyrics_heal_version < _CURRENT_LYRICS_HEAL_VERSION
        ):
            logger.info(
                "Admin heal: forcing OpenAI re-transcription "
                "(heal_version %d -> %d) song_id=%s song_name=%r",
                song.lyrics_heal_version,
                _CURRENT_LYRICS_HEAL_VERSION,
                song_id,
                song.song_name,
            )
            for stale_key in (song.lyrics_key, song.lyrics_corrected_key):
                if stale_key:
                    self._storage.delete_file(stale_key)
            await self._song_dao.update_by_id(
                song.id,
                lyrics_key=None,
                lyrics_corrected_key=None,
                lyrics_failed=False,
                lyrics_attempted_at=None,
                lyrics_heal_version=_CURRENT_LYRICS_HEAL_VERSION,
            )
            lyrics_ok = False

        # Both present — nothing to do.
        if lyrics_ok and quick_ok:
            logger.debug("Admin: lyrics already present for %s", song_id)
            return False

        # If the DB is missing lyrics_key but the file exists, fix it and stop.
        if not lyrics_ok and song.song_name:
            candidate = f"{song.song_name}/lyrics.json"
            if self._storage.file_exists(candidate):
                fix_kwargs: dict = {"lyrics_key": candidate}
                # Also backfill quick lyrics if present on disk.
                quick_candidate = f"{song.song_name}/lyrics_quick.json"
                if self._storage.file_exists(quick_candidate):
                    fix_kwargs["lyrics_quick_key"] = quick_candidate
                await self._song_dao.update_by_id(song.id, **fix_kwargs)
                logger.info(
                    "Admin heal: fixed lyrics_key for song_id=%s song_name=%r -> %s",
                    song_id,
                    song.song_name,
                    candidate,
                )
                return False

        if not song.song_name:
            if _should_log_admin_heal_info("lyrics_only", song_id):
                logger.info(
                    "Admin heal: lyrics-only blocked (missing song_name) "
                    "song_id=%s vocals_key=%r",
                    song_id,
                    getattr(song, "vocals_key", None),
                    extra={
                        "event_type": "admin_heal",
                        "action": "lyrics_only",
                        "song_id": str(song_id),
                        "outcome": "blocked",
                        "reason": "missing_song_name",
                    },
                )
            return False

        # When only quick_lyrics are missing (full lyrics exist), we can use
        # fast_only mode which skips Whisper entirely.
        quick_only = lyrics_ok and not quick_ok

        # Require an audio source. Prefer isolated vocals; when only quick
        # lyrics are needed, also accept the raw audio file (onset alignment
        # works on any audio).
        vocals_candidates = [
            getattr(song, "vocals_key", None),
            *_stem_candidates(song.song_name, "vocals", "vocals_isolated"),
        ]
        vocals_key = next(
            (k for k in vocals_candidates if k and self._storage.file_exists(k)), None
        )
        # Fallback: use raw audio when only quick lyrics are needed.
        if not vocals_key and quick_only:
            if song.audio_key and self._storage.file_exists(song.audio_key):
                vocals_key = song.audio_key
                logger.info(
                    "Admin heal: using audio_key fallback for quick-lyrics-only "
                    "song_id=%s song_name=%r audio_key=%s",
                    song_id,
                    song.song_name,
                    song.audio_key,
                )

        if not vocals_key:
            # This can be hit repeatedly while stems are still being generated.
            # Emit an INFO line (throttled) so we can diagnose why lyrics were
            # not enqueued even though they're missing / quick lyrics are missing.
            checked = [k for k in vocals_candidates if k]
            need = "quick_only" if quick_only else "full"
            if _should_log_admin_heal_info("lyrics_only", song_id):
                logger.info(
                    "Admin heal: lyrics-only blocked (no audio source found) "
                    "song_id=%s song_name=%r vocals_key=%r need=%s checked=%s",
                    song_id,
                    song.song_name,
                    song.vocals_key,
                    need,
                    checked,
                    extra={
                        "event_type": "admin_heal",
                        "action": "lyrics_only",
                        "song_id": str(song_id),
                        "outcome": "blocked",
                        "reason": "vocals_missing",
                        "checked": checked,
                        "lyrics_ok": lyrics_ok,
                        "quick_ok": quick_ok,
                    },
                )
            return False

        # Record the attempt timestamp so concurrent/subsequent polls skip this.
        await self._song_dao.update_by_id(song.id, lyrics_attempted_at=_utcnow())

        # Emit a single INFO log per enqueue; this is the key signal we want
        # in CloudWatch/Grafana.
        reason = "missing_lyrics" if not lyrics_ok else "missing_quick_lyrics"
        logger.info(
            "Admin heal: enqueued lyrics-only transcription "
            "song_id=%s song_name=%r reason=%s vocals_key=%s quick_only=%s",
            song_id,
            song.song_name,
            reason,
            vocals_key,
            quick_only,
            extra={
                "event_type": "admin_heal",
                "action": "lyrics_only",
                "song_id": str(song_id),
                "outcome": "enqueued",
                "reason": reason,
            },
        )
        _enqueue_lyrics_transcription(song_id, quick_only=quick_only)
        return True

    async def trigger_vocals_guitar_merge_if_missing(
        self,
        song_id: uuid.UUID,
    ) -> bool:
        """If vocals+guitar merge is missing but both source stems exist, enqueue merge.

        Returns True if a background merge task was enqueued.
        """
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        # DB-based cooldown: don't re-enqueue if we attempted recently.
        if song.merge_attempted_at:
            age_s = (_utcnow() - _to_aware_utc(song.merge_attempted_at)).total_seconds()
            if age_s < _LIGHTWEIGHT_TASK_COOLDOWN_SECONDS:
                logger.debug(
                    "Admin: skipping merge for %s (attempted %.0fs ago)",
                    song_id,
                    age_s,
                )
                return False

        existing_task = _MERGE_TASKS.get(song_id)
        if existing_task and not existing_task.done():
            return False

        # Already present.
        vg_ok = bool(song.vocals_guitar_key) and self._storage.file_exists(
            song.vocals_guitar_key
        )
        if vg_ok:
            return False

        if not song.song_name:
            return False

        # Fix DB key from disk if file exists.
        vg_candidate = _find_stem(self._storage, song.song_name, "vocals_guitar")
        if vg_candidate:
            await self._song_dao.update_by_id(song.id, vocals_guitar_key=vg_candidate)
            return False

        # Both source stems must exist.
        vocals_candidates = [
            getattr(song, "vocals_key", None),
            *_stem_candidates(song.song_name, "vocals", "vocals_isolated"),
        ]
        vocals_key = next(
            (k for k in vocals_candidates if k and self._storage.file_exists(k)),
            None,
        )

        guitar_candidates = [
            getattr(song, "guitar_key", None),
            *_stem_candidates(song.song_name, "guitar", "guitar_isolated"),
        ]
        guitar_key = next(
            (k for k in guitar_candidates if k and self._storage.file_exists(k)),
            None,
        )

        if not vocals_key or not guitar_key:
            return False

        # Record the attempt timestamp so concurrent/subsequent polls skip this.
        await self._song_dao.update_by_id(song.id, merge_attempted_at=_utcnow())

        logger.debug(
            "Admin: vocals+guitar merge missing for %s; enqueuing merge",
            song_id,
        )
        _enqueue_vocals_guitar_merge(song_id)
        return True

    async def trigger_tabs_generation_if_missing(
        self,
        song_id: uuid.UUID,
        *,
        force: bool = False,
    ) -> bool:
        """If tabs are missing but the guitar stem exists, enqueue tabs generation.

        Returns True if a background tabs task was enqueued.

        When *force* is True, the ``tabs_failed`` flag is ignored (admin retry).
        """
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        logger.debug(
            "trigger_tabs: song_id=%s tabs_failed=%s tabs_attempted_at=%s "
            "tabs_key=%s song_name=%s guitar_key=%s",
            song_id,
            song.tabs_failed,
            song.tabs_attempted_at,
            song.tabs_key,
            song.song_name,
            song.guitar_key,
        )

        tabs_key_missing_on_disk = bool(
            song.tabs_key
        ) and not self._storage.file_exists(song.tabs_key)
        if tabs_key_missing_on_disk:
            logger.info(
                "trigger_tabs: stale tabs_key missing on disk; clearing DB key and bypassing cooldown song_id=%s tabs_key=%s",
                song_id,
                song.tabs_key,
            )
            await self._song_dao.update_by_id(song.id, tabs_key=None)
            song.tabs_key = None

        tabs_attempt_age_s: float | None = None
        if song.tabs_attempted_at:
            tabs_attempt_age_s = (
                _utcnow() - _to_aware_utc(song.tabs_attempted_at)
            ).total_seconds()

        if song.tabs_failed and not force and not tabs_key_missing_on_disk:
            if (
                tabs_attempt_age_s is not None
                and tabs_attempt_age_s < _LIGHTWEIGHT_TASK_COOLDOWN_SECONDS
            ):
                logger.debug(
                    "trigger_tabs: blocked by recent tabs_failed cooldown (age=%.0fs)",
                    tabs_attempt_age_s,
                )
                return False

            logger.info(
                "trigger_tabs: retrying after previous failure song_id=%s age_s=%s",
                song_id,
                None if tabs_attempt_age_s is None else round(tabs_attempt_age_s, 1),
            )

        # DB-based cooldown: don't re-enqueue if we attempted recently.
        if song.tabs_attempted_at and not force and not tabs_key_missing_on_disk:
            if (
                tabs_attempt_age_s is not None
                and tabs_attempt_age_s < _LIGHTWEIGHT_TASK_COOLDOWN_SECONDS
            ):
                logger.debug(
                    "trigger_tabs: blocked by cooldown (age=%.0fs)",
                    tabs_attempt_age_s,
                )
                return False

        existing_task = _TABS_TASKS.get(song_id)
        if existing_task and not existing_task.done():
            logger.debug("trigger_tabs: blocked by existing task")
            return False

        # Already present.
        tabs_ok = bool(song.tabs_key) and self._storage.file_exists(song.tabs_key)
        if tabs_ok:
            logger.debug("trigger_tabs: tabs already present")
            return False

        if not song.song_name:
            logger.debug("trigger_tabs: no song_name")
            return False

        # Fix DB key from disk if file exists.
        tabs_candidate = f"{song.song_name}/tabs.json"
        if self._storage.file_exists(tabs_candidate):
            logger.debug("trigger_tabs: found tabs.json on disk, fixing DB key")
            await self._song_dao.update_by_id(song.id, tabs_key=tabs_candidate)
            return False

        # Guitar stem must exist.
        guitar_candidates = [
            getattr(song, "guitar_key", None),
            *_stem_candidates(song.song_name, "guitar", "guitar_isolated"),
        ]
        guitar_key = next(
            (k for k in guitar_candidates if k and self._storage.file_exists(k)),
            None,
        )
        if not guitar_key:
            logger.debug(
                "trigger_tabs: no guitar stem found, candidates=%s",
                guitar_candidates,
            )
            return False

        # Record the attempt timestamp so concurrent/subsequent polls skip this.
        update_kwargs: dict = {"tabs_attempted_at": _utcnow()}
        if force or song.tabs_failed:
            update_kwargs["tabs_failed"] = False
        await self._song_dao.update_by_id(song.id, **update_kwargs)

        logger.info(
            "Admin: tabs missing for %s; enqueuing generation",
            song_id,
        )
        _enqueue_tabs_generation(song_id)
        return True

    async def get_active_job_for_song(self, song_id: uuid.UUID) -> JobRecord | None:
        """Return the active (PENDING/PROCESSING) job for a song, if any."""
        job = await self._job_dao.get_active_job(song_id)
        if not job:
            return None

        refreshed = await self._refresh_active_job_if_stale(job)
        if refreshed.status not in ("PENDING", "PROCESSING"):
            return None
        return refreshed

    async def get_job(self, job_id: uuid.UUID) -> JobResponse:
        job = await self._job_dao.get_by_id(job_id)
        if not job:
            raise NotFoundError("Job", str(job_id))
        job = await self._refresh_active_job_if_stale(job)
        return self._enrich_job(job)

    async def list_user_jobs(
        self, user_sub: str, offset: int = 0, limit: int = 50
    ) -> list[JobResponse]:
        user = await self._user_dao.get_by_cognito_sub(user_sub)
        if not user:
            return []
        jobs = await self._job_dao.get_by_user(user.id, offset, limit)
        return [self._enrich_job(j) for j in jobs]

    def _enrich_job(self, job: JobRecord) -> JobResponse:
        """Convert job to response, resolving result URLs if completed."""
        resp = JobResponse.model_validate(job)
        if resp.results and resp.status == "COMPLETED":
            for result_entry in resp.results:
                if hasattr(result_entry, "target_key") and result_entry.target_key:
                    if self._storage.file_exists(result_entry.target_key):
                        result_entry.target_key = self._storage.get_url(
                            result_entry.target_key
                        )
                if hasattr(result_entry, "residual_key") and result_entry.residual_key:
                    if self._storage.file_exists(result_entry.residual_key):
                        result_entry.residual_key = self._storage.get_url(
                            result_entry.residual_key
                        )
        return resp


# ---- Background processing orchestration ----

_BACKGROUND_TASKS: set[asyncio.Task] = set()


def _track_task(task: asyncio.Task) -> None:
    _BACKGROUND_TASKS.add(task)

    def _done(t: asyncio.Task) -> None:
        _BACKGROUND_TASKS.discard(t)

    task.add_done_callback(_done)


def _enqueue_job_processing(job_id: uuid.UUID) -> None:
    """Fire-and-forget job processing in the background."""
    task = asyncio.create_task(_process_job(job_id))
    _track_task(task)


async def _transcribe_lyrics_only(
    song_id: uuid.UUID, *, quick_only: bool = False
) -> None:
    """Transcribe lyrics for an existing song if vocals are available.

    Delegates to the lyrics_generator service, passing OpenAI credentials
    so the service can try OpenAI first and fall back to local Whisper.

    When *quick_only* is True, only lyrics_quick.json is produced via onset
    alignment (Whisper is skipped via the lyrics_generator's fast_only mode).
    """

    try:
        storage = get_storage()
    except Exception:
        return

    from guitar_player.config import get_settings

    settings = get_settings()

    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return

        # Check whether full lyrics and quick lyrics both exist already.
        lyrics_exists = bool(song.lyrics_key) and storage.file_exists(song.lyrics_key)
        if not lyrics_exists:
            lyrics_key = f"{song.song_name}/lyrics.json"
            if storage.file_exists(lyrics_key):
                await song_dao.update_by_id(song_id, lyrics_key=lyrics_key)
                lyrics_exists = True

        quick_exists = bool(song.lyrics_quick_key) and storage.file_exists(
            song.lyrics_quick_key
        )
        if not quick_exists:
            quick_candidate = f"{song.song_name}/lyrics_quick.json"
            if storage.file_exists(quick_candidate):
                await song_dao.update_by_id(song_id, lyrics_quick_key=quick_candidate)
                quick_exists = True

        # Both present — nothing to do.
        if lyrics_exists and quick_exists:
            await song_dao.flush()
            return

        vocals_candidates = [
            getattr(song, "vocals_key", None),
            *_stem_candidates(song.song_name, "vocals", "vocals_isolated"),
        ]
        vocals_key = next(
            (k for k in vocals_candidates if k and storage.file_exists(k)), None
        )
        # Fallback: use raw audio when only quick lyrics are needed.
        if not vocals_key and quick_only:
            if song.audio_key and storage.file_exists(song.audio_key):
                vocals_key = song.audio_key

        if not vocals_key:
            return

        song_title = song.title
        song_artist = song.artist
        song_name = song.song_name

    logger.info(
        "Lyrics-only transcription starting song_id=%s quick_only=%s vocals_key=%s",
        song_id,
        quick_only,
        vocals_key,
        extra={
            "event_type": "background_task_start",
            "task": "lyrics_only",
            "song_id": str(song_id),
            "vocals_key": vocals_key,
            "quick_only": quick_only,
        },
    )
    t0 = time.monotonic()

    processing = ProcessingService(settings)

    # Start transcription and poll for quick lyrics in parallel.
    # The lyrics-generator stores lyrics_quick.json early (fast-track alignment)
    # while full transcription may still be running.
    # When quick_only, fast_only mode skips Whisper entirely — but if that fails
    # (no online lyrics found), we fall back to full transcription.
    service_path = storage.resolve_service_path(vocals_key)
    transcribe_coro = processing.transcribe_lyrics(
        service_path,
        title=song_title,
        artist=song_artist,
        language=settings.openai.transcription_language,
        openai_api_key=settings.openai.api_key,
        openai_model=settings.openai.transcription_model,
        fast_only=quick_only,
    )

    if quick_only:
        # If fast_only fails (no online lyrics), retry with full transcription
        # so OpenAI/WhisperX can still produce lyrics.
        async def _fast_with_fallback():
            try:
                return await transcribe_coro
            except Exception as e:
                logger.info(
                    "fast_only failed for song_id=%s (%s), falling back to full transcription",
                    song_id,
                    e,
                )
                return await processing.transcribe_lyrics(
                    service_path,
                    title=song_title,
                    artist=song_artist,
                    language=settings.openai.transcription_language,
                    openai_api_key=settings.openai.api_key,
                    openai_model=settings.openai.transcription_model,
                    fast_only=False,
                )

        transcribe_task = asyncio.create_task(_fast_with_fallback())
    else:
        transcribe_task = asyncio.create_task(transcribe_coro)

    quick_key = f"{song_name}/lyrics_quick.json"

    # In quick_only / fast_only mode, lyrics_quick.json is written synchronously
    # by the lyrics_generator before the HTTP response returns, so no polling needed.
    quick_task: asyncio.Task | None = None
    if not quick_only:

        async def _poll_and_persist_quick() -> None:
            for _ in range(90):  # up to ~3 minutes
                await asyncio.sleep(2)
                if not storage.file_exists(quick_key):
                    continue
                try:
                    async with safe_session() as session:
                        s_dao = SongDAO(session)
                        s = await s_dao.get_by_id(song_id)
                        if s and not s.lyrics_quick_key:
                            await s_dao.update_by_id(
                                song_id, lyrics_quick_key=quick_key
                            )
                            await s_dao.commit()
                    logger.info(
                        "Lyrics-only quick lyrics ready",
                        extra={
                            "event_type": "background_task_progress",
                            "task": "lyrics_only",
                            "song_id": str(song_id),
                            "stage": "quick_lyrics_ready",
                        },
                    )
                except Exception:
                    logger.debug(
                        "Failed to persist lyrics_quick_key for %s",
                        song_id,
                        exc_info=True,
                    )
                return

        quick_task = asyncio.create_task(_poll_and_persist_quick())

    try:
        await transcribe_task
        elapsed_s = time.monotonic() - t0
        logger.info(
            "Lyrics-only transcription finished (%.1fs) song_id=%s quick_only=%s",
            elapsed_s,
            song_id,
            quick_only,
            extra={
                "event_type": "background_task_done",
                "task": "lyrics_only",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
                "quick_only": quick_only,
            },
        )
    except Exception as e:
        elapsed_s = time.monotonic() - t0
        logger.warning(
            "Lyrics-only transcription failed (%.1fs): %s song_id=%s quick_only=%s",
            elapsed_s,
            e,
            song_id,
            quick_only,
            extra={
                "event_type": "background_task_failed",
                "task": "lyrics_only",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
                "error": str(e),
                "quick_only": quick_only,
            },
        )
        # Mark as failed in the DB so we don't retry on every page load/poll.
        # But only for full transcription failures — a quick_only failure
        # (e.g. no lyrics found online) should not block a future full attempt.
        if not quick_only:
            try:
                async with safe_session() as session:
                    song_dao = SongDAO(session)
                    song = await song_dao.get_by_id(song_id)
                    if song:
                        await song_dao.update_by_id(song_id, lyrics_failed=True)
                        await song_dao.commit()
            except Exception:
                logger.debug(
                    "Failed to persist lyrics_failed for %s",
                    song_id,
                    exc_info=True,
                )
        return
    finally:
        if quick_task is not None:
            if not quick_task.done():
                quick_task.cancel()
            try:
                await quick_task
            except Exception:
                pass

    # Persist lyrics_key and lyrics_quick_key if the files are now present.
    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return
        changes: dict = {}
        # Always check for lyrics.json — even when quick_only was requested,
        # the fallback may have run a full transcription.
        lyrics_key = f"{song_name}/lyrics.json"
        lyrics_present = storage.file_exists(lyrics_key)
        if lyrics_present and not song.lyrics_key:
            await _cleanup_lyrics_preamble(storage, lyrics_key)
            changes["lyrics_key"] = lyrics_key
        lyrics_corrected_key = f"{song_name}/lyrics_corrected.json"
        lyrics_corrected_present = storage.file_exists(lyrics_corrected_key)
        if lyrics_corrected_present and not song.lyrics_corrected_key:
            changes["lyrics_corrected_key"] = lyrics_corrected_key
            changes["lyrics_corrected"] = True
        lyrics_quick_key = f"{song_name}/lyrics_quick.json"
        lyrics_quick_present = storage.file_exists(lyrics_quick_key)
        if lyrics_quick_present and not song.lyrics_quick_key:
            changes["lyrics_quick_key"] = lyrics_quick_key
        # Clear failure flag and attempt timestamp on success, even when the
        # DB keys were already set and there is nothing else to backfill.
        if lyrics_present or lyrics_corrected_present or lyrics_quick_present:
            if song.lyrics_failed:
                changes["lyrics_failed"] = False
            if song.lyrics_attempted_at is not None:
                changes["lyrics_attempted_at"] = None

        if changes:
            await song_dao.update_by_id(song_id, **changes)
            await song_dao.commit()


async def _merge_vocals_guitar_only(song_id: uuid.UUID) -> None:
    """Merge vocals + guitar stems for an existing song if both are available."""

    try:
        settings_storage = get_storage()
    except Exception:
        return

    storage = settings_storage

    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return

        # If the merged file appeared meanwhile, just fix the DB key.
        if song.vocals_guitar_key and storage.file_exists(song.vocals_guitar_key):
            return

        vg_key = _find_stem(storage, song.song_name, "vocals_guitar")
        if vg_key:
            await song_dao.update_by_id(song_id, vocals_guitar_key=vg_key)
            await song_dao.commit()
            return

        # Find vocals and guitar stems.
        vocals_candidates = [
            getattr(song, "vocals_key", None),
            *_stem_candidates(song.song_name, "vocals", "vocals_isolated"),
        ]
        vocals_key = next(
            (k for k in vocals_candidates if k and storage.file_exists(k)), None
        )

        guitar_candidates = [
            getattr(song, "guitar_key", None),
            *_stem_candidates(song.song_name, "guitar", "guitar_isolated"),
        ]
        guitar_key = next(
            (k for k in guitar_candidates if k and storage.file_exists(k)), None
        )

        if not vocals_key or not guitar_key:
            return

    # Execute outside the DB session.
    t0 = time.monotonic()
    try:
        from guitar_player.services.audio_merge import merge_vocals_guitar_stem

        logger.info(
            "Vocals+guitar merge starting",
            extra={
                "event_type": "background_task_start",
                "task": "merge_only",
                "song_id": str(song_id),
                "vocals_key": vocals_key,
                "guitar_key": guitar_key,
            },
        )
        result_key = await merge_vocals_guitar_stem(
            storage, song.song_name, vocals_key, guitar_key
        )
        if result_key:
            elapsed_s = time.monotonic() - t0
            logger.info(
                "Vocals+guitar merge finished (%.1fs)",
                elapsed_s,
                extra={
                    "event_type": "background_task_done",
                    "task": "merge_only",
                    "song_id": str(song_id),
                    "elapsed_s": round(elapsed_s, 1),
                },
            )
        else:
            # merge_vocals_guitar_stem returned None — no result produced.
            return
    except Exception as e:
        elapsed_s = time.monotonic() - t0
        logger.warning(
            "Vocals+guitar merge failed (%.1fs): %s",
            elapsed_s,
            e,
            extra={
                "event_type": "background_task_failed",
                "task": "merge_only",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
                "error": str(e),
            },
        )
        # merge_attempted_at already set by trigger method; it will act as
        # cooldown until _LIGHTWEIGHT_TASK_COOLDOWN_SECONDS expires.
        return

    # Persist vocals_guitar_key if the file is now present.
    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return
        vg_key = _find_stem(storage, song.song_name, "vocals_guitar")
        if vg_key:
            await song_dao.update_by_id(
                song_id, vocals_guitar_key=vg_key, merge_attempted_at=None
            )
            await song_dao.commit()


async def _generate_tabs_only(song_id: uuid.UUID) -> None:
    """Generate tabs for an existing song if the guitar stem is available."""

    try:
        storage = get_storage()
    except Exception:
        return

    from guitar_player.config import get_settings

    settings = get_settings()

    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return

        # If the tabs file appeared meanwhile, just fix the DB key.
        tabs_key = f"{song.song_name}/tabs.json"
        if storage.file_exists(tabs_key):
            if not song.tabs_key:
                await song_dao.update_by_id(song_id, tabs_key=tabs_key)
                await song_dao.commit()
            return

        guitar_candidates = [
            getattr(song, "guitar_key", None),
            *_stem_candidates(song.song_name, "guitar", "guitar_isolated"),
        ]
        guitar_key = next(
            (k for k in guitar_candidates if k and storage.file_exists(k)), None
        )
        if not guitar_key:
            return

        song_name = song.song_name

    t0 = time.monotonic()
    try:
        processing = ProcessingService(settings)
        service_path = storage.resolve_service_path(guitar_key)
        logger.info(
            "Tabs generation starting song_id=%s guitar_key=%s",
            song_id,
            guitar_key,
            extra={
                "event_type": "background_task_start",
                "task": "tabs_only",
                "song_id": str(song_id),
                "guitar_key": guitar_key,
            },
        )
        await processing.generate_tabs(service_path)
        elapsed_s = time.monotonic() - t0
        logger.info(
            "Tabs generation finished (%.1fs) song_id=%s",
            elapsed_s,
            song_id,
            extra={
                "event_type": "background_task_done",
                "task": "tabs_only",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
            },
        )
    except Exception as e:
        elapsed_s = time.monotonic() - t0
        logger.warning(
            "Tabs generation failed (%.1fs): %s song_id=%s",
            elapsed_s,
            e,
            song_id,
            extra={
                "event_type": "background_task_failed",
                "task": "tabs_only",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
                "error": str(e),
            },
        )
        try:
            async with safe_session() as session:
                song_dao = SongDAO(session)
                await song_dao.update_by_id(song_id, tabs_failed=True)
                await song_dao.commit()
        except Exception:
            logger.debug("Failed to persist tabs_failed for %s", song_id, exc_info=True)
        return

    # Persist tabs_key if the file is now present.
    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return
        tabs_key = f"{song_name}/tabs.json"
        if storage.file_exists(tabs_key):
            await song_dao.update_by_id(
                song_id, tabs_key=tabs_key, tabs_failed=False, tabs_attempted_at=None
            )
            await song_dao.commit()


_LYRICS_CLEANUP_TIMEOUT_S = 30


async def _cleanup_lyrics_preamble(
    storage: StorageBackend,
    lyrics_key: str,
) -> None:
    """Remove non-lyrics preamble segments from a stored lyrics.json using LLM.

    Reads lyrics.json, asks the LLM to identify the first real lyrics segment,
    and re-uploads the cleaned version. Non-fatal: logs a warning on failure.
    """
    from guitar_player.config import get_settings

    try:
        raw = storage.read_json(lyrics_key)
        if not isinstance(raw, dict):
            return
        segments = raw.get("segments", [])
        if len(segments) < 2:
            return

        texts = [s.get("text", "") for s in segments[:15]]

        settings = get_settings()

        # Quick-fail: skip if AWS credentials are clearly unavailable.
        if not settings.aws.use_iam_role and not settings.aws.access_key:
            logger.debug(
                "Lyrics preamble cleanup skipped for %s: no AWS credentials configured",
                lyrics_key,
            )
            return

        llm = LlmService(settings)
        first_index = await asyncio.wait_for(
            llm.cleanup_lyrics_preamble(texts),
            timeout=_LYRICS_CLEANUP_TIMEOUT_S,
        )

        if first_index <= 0:
            logger.debug(
                "Lyrics preamble cleanup: nothing to remove for %s", lyrics_key
            )
            return

        logger.info(
            "Removing %d non-lyrics preamble segment(s) from %s",
            first_index,
            lyrics_key,
        )
        raw["segments"] = segments[first_index:]

        import json as _json

        tmp_path = os.path.join(
            tempfile.gettempdir(), f"lyrics_cleaned_{uuid.uuid4()}.json"
        )
        with open(tmp_path, "w") as f:
            _json.dump(raw, f, indent=2)
        storage.upload_file(tmp_path, lyrics_key)
        os.unlink(tmp_path)
    except asyncio.TimeoutError:
        logger.warning(
            "Lyrics preamble cleanup timed out for %s (non-fatal)", lyrics_key
        )
    except Exception as e:
        logger.warning(
            "Lyrics preamble cleanup failed for %s (non-fatal): %s", lyrics_key, e
        )


async def _set_progress(job_id: uuid.UUID, progress: int, stage: str) -> None:
    """Persist progress updates without keeping a DB session open for the entire job."""
    try:
        storage = get_storage()
    except Exception:
        storage = None

    async with safe_session() as session:
        job_dao = JobDAO(session)
        song_dao = SongDAO(session)
        job = await job_dao.get_by_id(job_id)
        if not job:
            return
        await job_dao.update_progress(job.id, progress=progress, stage=stage)
        song = await song_dao.get_by_id(job.song_id)
        await job_dao.commit()

    if storage and song and song.song_name:
        try:
            from guitar_player.job_status_manifest import write_job_status_manifest

            write_job_status_manifest(
                storage,
                song_name=song.song_name,
                job_id=job_id,
                song_id=song.id,
                status=job.status,
                stage=stage,
                progress=progress,
            )
        except Exception:
            # Non-fatal; the UI can fall back to DB polling.
            logger.debug("Failed to write job status manifest", exc_info=True)


async def _fail_job(job_id: uuid.UUID, message: str) -> None:
    try:
        storage = get_storage()
    except Exception:
        storage = None

    async with safe_session() as session:
        job_dao = JobDAO(session)
        song_dao = SongDAO(session)
        job = await job_dao.get_by_id(job_id)
        if not job:
            return
        await job_dao.update_status(job.id, "FAILED", error_message=message)
        song = await song_dao.get_by_id(job.song_id)
        # Release processing lock if this job owns it.
        if song and song.processing_job_id == job_id:
            await song_dao.update_by_id(song.id, processing_job_id=None)
        await job_dao.commit()

    if storage and song and song.song_name:
        try:
            from guitar_player.job_status_manifest import write_job_status_manifest

            write_job_status_manifest(
                storage,
                song_name=song.song_name,
                job_id=job_id,
                song_id=song.id,
                status="FAILED",
                stage="failed",
                progress=job.progress,
                error_message=message,
                min_interval_s=0.0,
            )
        except Exception:
            logger.debug("Failed to write job status manifest", exc_info=True)


async def _complete_job(job_id: uuid.UUID, results: list[dict]) -> None:
    try:
        storage = get_storage()
    except Exception:
        storage = None

    async with safe_session() as session:
        job_dao = JobDAO(session)
        song_dao = SongDAO(session)
        job = await job_dao.get_by_id(job_id)
        if not job:
            return
        await job_dao.update_status(job.id, "COMPLETED", results=results)
        song = await song_dao.get_by_id(job.song_id)
        # Release processing lock if this job owns it.
        if song and song.processing_job_id == job_id:
            await song_dao.update_by_id(song.id, processing_job_id=None)
        await job_dao.commit()

    if storage and song and song.song_name:
        try:
            from guitar_player.job_status_manifest import write_job_status_manifest

            write_job_status_manifest(
                storage,
                song_name=song.song_name,
                job_id=job_id,
                song_id=song.id,
                status="COMPLETED",
                stage="completed",
                progress=100,
                min_interval_s=0.0,
                extra={"results": results},
            )
        except Exception:
            logger.debug("Failed to write job status manifest", exc_info=True)


async def _process_job(job_id: uuid.UUID) -> None:
    """Run stem separation + chord recognition and update the DB as we go."""
    try:
        settings_storage = get_storage()
    except Exception:
        # If storage isn't initialized (e.g. during shutdown), just bail.
        return

    from guitar_player.config import get_settings

    settings = get_settings()
    storage = settings_storage
    processing = ProcessingService(settings)

    await _set_progress(job_id, 1, "starting")

    # Resolve job + song in a short-lived session.
    async with safe_session() as session:
        job_dao = JobDAO(session)
        song_dao = SongDAO(session)

        job = await job_dao.get_by_id(job_id)
        if not job:
            return
        # Job "descriptions" come from the frontend and represent canonical stems.
        # Convert to the demucs microservice's requested_outputs keys.
        raw_descriptions: list[str] = DEFAULT_REQUESTED_OUTPUTS
        if job.descriptions:
            # Stored in JSON; ensure it's a list[str]
            raw_descriptions = [str(x) for x in job.descriptions]
        demucs_requested_outputs = _to_demucs_requested_outputs(raw_descriptions)

        # Lyrics transcription relies on the vocals stem. Ensure we request vocals isolation
        # even if the UI only asked for e.g. "guitar_removed".
        if "vocals_isolated" not in demucs_requested_outputs:
            demucs_requested_outputs.append("vocals_isolated")
        song = await song_dao.get_by_id(job.song_id)
        if not song:
            await job_dao.update_status(
                job.id, "FAILED", error_message="Song not found"
            )
            await job_dao.commit()
            return

        # Mark processing.
        await job_dao.update_status(job.id, "PROCESSING")
        await job_dao.update_progress(job.id, progress=3, stage="resolving_audio")
        await job_dao.commit()

        if not song.audio_key or not storage.file_exists(song.audio_key):
            await job_dao.update_status(
                job.id, "FAILED", error_message="Audio file not found"
            )
            await job_dao.commit()
            return

        audio_path = storage.resolve_service_path(song.audio_key)
        song_name = song.song_name
        song_title = song.title
        song_artist = song.artist

    job_start_time = time.monotonic()
    logger.info(
        "Processing job",
        extra={
            "job_id": str(job_id),
            "audio_path": audio_path,
            "event_type": "job_start",
        },
    )

    # Idempotency/"healing": if core artifacts already exist, skip expensive work.
    # We treat stems+chords as the core. Lyrics/merge are best-effort followups.
    def _find_existing_key(candidates: list[str]) -> str | None:
        return next((k for k in candidates if storage.file_exists(k)), None)

    vocals_key_existing = _find_existing_key(
        _stem_candidates(song_name, "vocals", "vocals_isolated")
    )
    guitar_key_existing = _find_existing_key(
        _stem_candidates(song_name, "guitar", "guitar_isolated")
    )
    chords_key_existing = _find_existing_key([f"{song_name}/chords.json"])

    stems_already_ok = bool(vocals_key_existing and guitar_key_existing)
    chords_already_ok = bool(chords_key_existing)

    # Kick off tasks (or skip if artifacts exist), but keep progress moving.
    await _set_progress(job_id, 10, "separating")

    from guitar_player.services.processing_service import (
        ChordRecognitionResult,
        SeparationResult,
        StemInfo,
    )

    async def _cached_separation() -> SeparationResult:
        # Best-effort: report existing stems as if they were produced.
        stem_names = [
            "guitar",
            "vocals",
            "guitar_removed",
        ]
        stems: list[StemInfo] = []
        for name in stem_names:
            key = _find_stem(storage, song_name, name)
            if key:
                stems.append(StemInfo(name=name, path=key))
        return SeparationResult(stems=stems, output_path=f"{song_name}/")

    async def _cached_chords() -> ChordRecognitionResult:
        return ChordRecognitionResult(chords=[], output_path=f"{song_name}/chords.json")

    if stems_already_ok:
        logger.info(
            "Skipping demucs separation: stems already present",
            extra={
                "event_type": "job_skip",
                "job_id": str(job_id),
                "reason": "stems_cached",
            },
        )
        sep_task = asyncio.create_task(_cached_separation())
    else:
        sep_task = asyncio.create_task(
            processing.separate_stems(
                audio_path,
                requested_outputs=demucs_requested_outputs or None,
            )
        )

    if chords_already_ok:
        logger.info(
            "Skipping chord recognition: chords already present",
            extra={
                "event_type": "job_skip",
                "job_id": str(job_id),
                "reason": "chords_cached",
            },
        )
        chords_task = asyncio.create_task(_cached_chords())
    else:
        chords_task = asyncio.create_task(processing.recognize_chords(audio_path))

    async def _tick_until_done(
        t: asyncio.Task, start: int, end: int, stage: str
    ) -> None:
        # Best-effort progress approximation: keep UI alive even though Demucs doesn't
        # provide granular progress callbacks in our current implementation.
        # Uses an asymptotic approach: slows down as it approaches `end` so it never
        # stalls at a fixed value for long periods.
        progress = float(start)
        tick_count = 0
        while not t.done():
            clamped = min(end, int(progress))
            await _set_progress(job_id, clamped, stage)
            # Asymptotic: the closer to `end`, the smaller the increment.
            remaining = end - progress
            increment = max(0.2, remaining * 0.06)
            progress = min(end, progress + increment)
            tick_count += 1
            if tick_count % 15 == 0:  # INFO heartbeat every ~30s
                logger.info(
                    "Job %s still in stage '%s': progress=%d",
                    job_id,
                    stage,
                    clamped,
                    extra={
                        "event_type": "job_heartbeat",
                        "job_id": str(job_id),
                        "stage": stage,
                        "progress": clamped,
                    },
                )
            else:
                logger.debug(
                    "Job %s tick: progress=%.1f (clamped=%d), stage=%s",
                    job_id,
                    progress,
                    clamped,
                    stage,
                )
            await asyncio.sleep(2)

    tick_task = asyncio.create_task(
        _tick_until_done(sep_task, start=12, end=70, stage="separating")
    )

    try:
        separation_result = await sep_task
    except Exception as e:
        tick_task.cancel()

        # Avoid leaking an unhandled exception if chords_task already failed.
        if not chords_task.done():
            chords_task.cancel()
        try:
            await chords_task
        except Exception:
            pass

        await _fail_job(job_id, str(e))
        return
    finally:
        if not tick_task.done():
            tick_task.cancel()

    logger.info(
        "Separation done, advancing to chords",
        extra={
            "job_id": str(job_id),
            "stage": "recognizing_chords",
            "progress": 75,
            "event_type": "job_progress",
            "elapsed_s": round(time.monotonic() - job_start_time, 1),
        },
    )
    await _set_progress(job_id, 75, "recognizing_chords")

    # Enforce "no unwanted stems" policy: Demucs may produce these, but we do not
    # keep them in storage or DB.
    for unwanted in sorted(_UNWANTED_STEMS):
        key = f"{song_name}/{unwanted}{_STEM_EXT}"
        if storage.file_exists(key):
            try:
                storage.delete_file(key)
            except Exception:
                logger.debug("Failed to delete unwanted stem %s", key, exc_info=True)

    # Filter out any unwanted stems from the in-memory result so we don't
    # reference deleted keys later (e.g. job results).
    separation_result.stems = [
        s for s in separation_result.stems if s.name not in _UNWANTED_STEMS
    ]

    try:
        chords_result = await chords_task
    except httpx.ConnectError as e:
        await _fail_job(
            job_id,
            f"Chords service unavailable ({settings.services.chords_generator}): {e}",
        )
        return
    except httpx.HTTPError as e:
        await _fail_job(
            job_id,
            f"Chords service request failed ({settings.services.chords_generator}): {e}",
        )
        return
    except Exception as e:
        await _fail_job(job_id, str(e))
        return

    # Run lyrics and vocals+guitar merge in parallel (all non-fatal).
    logger.info(
        "Chords done, starting lyrics/merge in parallel",
        extra={
            "job_id": str(job_id),
            "stage": "transcribing",
            "progress": 78,
            "event_type": "job_progress",
            "elapsed_s": round(time.monotonic() - job_start_time, 1),
        },
    )
    await _set_progress(job_id, 78, "transcribing")

    async def _do_lyrics() -> None:
        """Transcribe lyrics from the vocals stem (non-fatal).

        Delegates to the lyrics_generator service, which tries OpenAI first
        (if credentials provided) and falls back to local Whisper.
        """
        vocals_stem_key = _find_stem(storage, song_name, "vocals")
        t0 = time.monotonic()
        try:
            if not vocals_stem_key:
                logger.warning(
                    "Skipping lyrics: vocals stem not found",
                    extra={
                        "event_type": "subtask_skip",
                        "job_id": str(job_id),
                        "subtask": "lyrics",
                        "reason": "vocals_stem_missing",
                    },
                )
                return

            logger.info(
                "Sub-task started: lyrics",
                extra={
                    "event_type": "subtask_start",
                    "job_id": str(job_id),
                    "subtask": "lyrics",
                    "input_key": vocals_stem_key,
                },
            )

            await processing.transcribe_lyrics(
                storage.resolve_service_path(vocals_stem_key),
                title=song_title,
                artist=song_artist,
                language=settings.openai.transcription_language,
                openai_api_key=settings.openai.api_key,
                openai_model=settings.openai.transcription_model,
            )
            elapsed_s = time.monotonic() - t0
            logger.info(
                "Sub-task finished: lyrics (%.1fs)",
                elapsed_s,
                extra={
                    "event_type": "subtask_done",
                    "job_id": str(job_id),
                    "subtask": "lyrics",
                    "elapsed_s": round(elapsed_s, 1),
                },
            )
        except Exception as e:
            elapsed_s = time.monotonic() - t0
            logger.warning(
                "Sub-task failed: lyrics (non-fatal, %.1fs): %s",
                elapsed_s,
                e,
                extra={
                    "event_type": "subtask_failed",
                    "job_id": str(job_id),
                    "subtask": "lyrics",
                    "elapsed_s": round(elapsed_s, 1),
                    "error": str(e),
                },
            )

    async def _do_merge() -> None:
        """Merge vocals + guitar into a combined stem (non-fatal)."""
        t0 = time.monotonic()
        try:
            vocals_merge_key = _find_stem(storage, song_name, "vocals")
            guitar_merge_key = _find_stem(storage, song_name, "guitar")
            if vocals_merge_key and guitar_merge_key:
                logger.info(
                    "Sub-task started: merge",
                    extra={
                        "event_type": "subtask_start",
                        "job_id": str(job_id),
                        "subtask": "merge",
                    },
                )

                stitch_fn = getattr(
                    getattr(settings, "lambdas", None), "vocals_guitar_stitch", None
                )
                if stitch_fn:
                    import boto3

                    stitch_payload: dict = {
                        "song_name": song_name,
                        "vocals_key": vocals_merge_key,
                        "guitar_key": guitar_merge_key,
                    }
                    rid = request_id_var.get()
                    if rid:
                        stitch_payload["request_id"] = rid
                    uid = user_id_var.get()
                    if uid:
                        stitch_payload["user_id"] = uid

                    def _invoke() -> None:
                        client = boto3.client("lambda", region_name=settings.aws.region)
                        client.invoke(
                            FunctionName=stitch_fn,
                            InvocationType="RequestResponse",
                            Payload=json.dumps(stitch_payload).encode("utf-8"),
                        )

                    await asyncio.to_thread(_invoke)
                else:
                    from guitar_player.services.audio_merge import (
                        merge_vocals_guitar_stem,
                    )

                    await merge_vocals_guitar_stem(
                        storage, song_name, vocals_merge_key, guitar_merge_key
                    )

                elapsed_s = time.monotonic() - t0
                logger.info(
                    "Sub-task finished: merge (%.1fs)",
                    elapsed_s,
                    extra={
                        "event_type": "subtask_done",
                        "job_id": str(job_id),
                        "subtask": "merge",
                        "elapsed_s": round(elapsed_s, 1),
                    },
                )
            else:
                logger.info(
                    "Skipping merge: missing source stems",
                    extra={
                        "event_type": "subtask_skip",
                        "job_id": str(job_id),
                        "subtask": "merge",
                        "reason": "stems_missing",
                    },
                )
        except Exception as e:
            elapsed_s = time.monotonic() - t0
            logger.warning(
                "Sub-task failed: merge (non-fatal, %.1fs): %s",
                elapsed_s,
                e,
                extra={
                    "event_type": "subtask_failed",
                    "job_id": str(job_id),
                    "subtask": "merge",
                    "elapsed_s": round(elapsed_s, 1),
                    "error": str(e),
                },
            )

    async def _do_tabs() -> None:
        """Generate tabs from the guitar stem (non-fatal)."""
        t0 = time.monotonic()
        try:
            tabs_key = f"{song_name}/tabs.json"
            if storage.file_exists(tabs_key):
                logger.info(
                    "Skipping tabs: tabs.json already present",
                    extra={
                        "event_type": "subtask_skip",
                        "job_id": str(job_id),
                        "subtask": "tabs",
                        "reason": "tabs_cached",
                    },
                )
                return

            guitar_tabs_key = _find_stem(storage, song_name, "guitar")
            if not guitar_tabs_key:
                logger.info(
                    "Skipping tabs: guitar stem not found",
                    extra={
                        "event_type": "subtask_skip",
                        "job_id": str(job_id),
                        "subtask": "tabs",
                        "reason": "guitar_stem_missing",
                    },
                )
                return

            logger.info(
                "Sub-task started: tabs",
                extra={
                    "event_type": "subtask_start",
                    "job_id": str(job_id),
                    "subtask": "tabs",
                    "input_key": guitar_tabs_key,
                },
            )

            await processing.generate_tabs(
                storage.resolve_service_path(guitar_tabs_key)
            )

            elapsed_s = time.monotonic() - t0
            logger.info(
                "Sub-task finished: tabs (%.1fs)",
                elapsed_s,
                extra={
                    "event_type": "subtask_done",
                    "job_id": str(job_id),
                    "subtask": "tabs",
                    "elapsed_s": round(elapsed_s, 1),
                },
            )
        except Exception as e:
            elapsed_s = time.monotonic() - t0
            logger.warning(
                "Sub-task failed: tabs (non-fatal, %.1fs): %s",
                elapsed_s,
                e,
                extra={
                    "event_type": "subtask_failed",
                    "job_id": str(job_id),
                    "subtask": "tabs",
                    "elapsed_s": round(elapsed_s, 1),
                    "error": str(e),
                },
            )

    async def _check_quick_lyrics() -> None:
        """Poll for lyrics_quick.json appearing during lyrics transcription.

        The lyrics service stores this file within seconds (fast-track alignment)
        while Whisper is still running.  Once detected, update the DB and manifest
        so the frontend can show quick lyrics immediately.
        """
        quick_key = f"{song_name}/lyrics_quick.json"
        song_id = job.song_id if job else None
        for _ in range(60):  # poll for up to ~2 minutes
            await asyncio.sleep(2)
            if storage.file_exists(quick_key):
                if song_id:
                    try:
                        async with safe_session() as sess:
                            s_dao = SongDAO(sess)
                            s = await s_dao.get_by_id(song_id)
                            if s and not s.lyrics_quick_key:
                                await s_dao.update_by_id(
                                    song_id, lyrics_quick_key=quick_key
                                )
                                await s_dao.commit()
                    except Exception as e:
                        logger.debug("Failed to persist lyrics_quick_key: %s", e)
                await _set_progress(job_id, 80, "quick_lyrics_ready")
                logger.info(
                    "Quick lyrics detected for job %s",
                    job_id,
                    extra={
                        "event_type": "subtask_done",
                        "job_id": str(job_id),
                        "subtask": "quick_lyrics",
                    },
                )
                return

    # Wrap lyrics/merge in a sentinel task so we can tick progress and keep
    # `updated_at` fresh.  Without this, the stale-job check in `get_job` marks
    # the job as timed-out when these tasks exceed _STALE_ACTIVE_JOB_AFTER_SECONDS.
    async def _all_subtasks() -> None:
        await asyncio.gather(
            _do_lyrics(), _do_merge(), _do_tabs(), _check_quick_lyrics()
        )

    gather_task = asyncio.create_task(_all_subtasks())
    ltt_tick = asyncio.create_task(
        _tick_until_done(gather_task, start=79, end=89, stage="transcribing")
    )
    try:
        await gather_task
    finally:
        if not ltt_tick.done():
            ltt_tick.cancel()

    logger.info(
        "Lyrics/merge done, saving results",
        extra={
            "job_id": str(job_id),
            "stage": "saving_results",
            "progress": 90,
            "event_type": "job_progress",
            "elapsed_s": round(time.monotonic() - job_start_time, 1),
        },
    )
    await _set_progress(job_id, 90, "saving_results")

    # Persist song stem keys + chords key and mark job completed.
    async with safe_session() as session:
        job_dao = JobDAO(session)
        song_dao = SongDAO(session)

        job = await job_dao.get_by_id(job_id)
        if not job:
            return
        song = await song_dao.get_by_id(job.song_id)
        if not song:
            await job_dao.update_status(
                job.id, "FAILED", error_message="Song not found"
            )
            await job_dao.commit()
            return

        song_changes: dict = {}

        for stem_info in separation_result.stems:
            canonical = STEM_NAME_MAP.get(stem_info.name)
            if canonical:
                from pathlib import Path as _Path

                ext = _Path(stem_info.path).suffix or _STEM_EXT
                song_changes[f"{canonical}_key"] = f"{song_name}/{stem_info.name}{ext}"

        if chords_result.output_path:
            song_changes["chords_key"] = f"{song_name}/chords.json"

        lyrics_key = f"{song_name}/lyrics.json"
        if storage.file_exists(lyrics_key):
            await _cleanup_lyrics_preamble(storage, lyrics_key)
            song_changes["lyrics_key"] = lyrics_key
            song_changes["lyrics_failed"] = False
        else:
            # Lyrics transcription didn't produce output — mark as failed
            # so the admin heal loop doesn't retry on every page load.
            song_changes["lyrics_failed"] = True

        lyrics_quick_key = f"{song_name}/lyrics_quick.json"
        if storage.file_exists(lyrics_quick_key):
            song_changes["lyrics_quick_key"] = lyrics_quick_key

        tabs_key = f"{song_name}/tabs.json"
        if storage.file_exists(tabs_key):
            song_changes["tabs_key"] = tabs_key
            song_changes["tabs_failed"] = False

        vg_key = _find_stem(storage, song_name, "vocals_guitar")
        if vg_key:
            song_changes["vocals_guitar_key"] = vg_key

        # Policy: never persist these stem keys.
        for stem_name in sorted(_UNWANTED_STEMS):
            song_changes[f"{stem_name}_key"] = None

        if song_changes:
            await song_dao.update_by_id(song.id, **song_changes)

        job_results = [
            {
                "description": stem_info.name,
                "target_key": stem_info.path,
            }
            for stem_info in separation_result.stems
        ]

        await job_dao.update_status(job.id, "COMPLETED", results=job_results)
        await job_dao.commit()

    logger.info(
        "Job completed",
        extra={
            "job_id": str(job_id),
            "event_type": "job_completed",
            "total_elapsed_s": round(time.monotonic() - job_start_time, 1),
        },
    )


# ---- Startup admin healing ----

# Thumbnail filenames to scan on disk when the DB key is missing.
_THUMB_CANDIDATES = ["thumbnail.jpg", "thumbnail.jpeg", "cover.jpg", "cover.jpeg"]


_STEM_LIKE_AUDIO_FILENAMES: set[str] = {
    "vocals.mp3",
    "guitar.mp3",
    "guitar_isolated.mp3",
    "vocals_isolated.mp3",
    "guitar_removed.mp3",
    "vocals_guitar.mp3",
    "drums.mp3",
    "bass.mp3",
    "piano.mp3",
    "other.mp3",
}


async def _admin_heal_audio_and_thumbnail_on_startup(
    *,
    song: SongRecord,
    song_dao: SongDAO,
    storage: StorageBackend,
    user_sub: str,
    user_email: str,
    user_dao: UserDAO,
    youtube: YoutubeService,
    allow_youtube_downloads: bool,
) -> int:
    """Best-effort audio/thumbnail repair for startup admin heal.

    Returns the number of DB keys updated.

    Notes:
    - This intentionally mirrors `SongService.admin_heal_audio_and_thumbnail` but avoids
      instantiating the full `SongService` (which would also require Bedrock LLM
      configuration).
    - We only hit YouTube when explicitly allowed by the caller.
    """

    fixed = 0

    audio_ok = bool(song.audio_key) and storage.file_exists(song.audio_key)
    thumb_ok = bool(song.thumbnail_key) and storage.file_exists(song.thumbnail_key)

    if audio_ok and thumb_ok:
        return 0

    changes: dict = {}

    # 1) Try to fix from existing files in storage.
    if song.song_name:
        try:
            files = set(storage.list_files(song.song_name))

            if not audio_ok:
                audio_candidates = [
                    f"{song.song_name}/audio.mp3",
                    f"{song.song_name}/full_mix.mp3",
                    f"{song.song_name}/mix.mp3",
                ]

                # Also consider any audio file that doesn't look like a stem.
                for f in files:
                    if not f.endswith(".mp3"):
                        continue
                    if f.rsplit("/", 1)[-1] in _STEM_LIKE_AUDIO_FILENAMES:
                        continue
                    audio_candidates.append(f)

                for key in audio_candidates:
                    if key in files and storage.file_exists(key):
                        changes["audio_key"] = key
                        audio_ok = True
                        fixed += 1
                        break

            if not thumb_ok:
                thumb_candidates = [
                    f"{song.song_name}/{fname}" for fname in _THUMB_CANDIDATES
                ]
                if song.youtube_id:
                    thumb_candidates.insert(
                        0, f"{song.song_name}/{song.youtube_id}.jpg"
                    )

                for key in thumb_candidates:
                    if key in files and storage.file_exists(key):
                        changes["thumbnail_key"] = key
                        thumb_ok = True
                        fixed += 1
                        break
        except Exception as e:
            logger.warning(
                "Startup admin: failed to list files for %s: %s",
                song.song_name,
                e,
            )

    # 2) If still missing and we have youtube_id, re-download (if allowed).
    if (not audio_ok or not thumb_ok) and song.youtube_id and allow_youtube_downloads:
        tmp_dir = tempfile.mkdtemp(prefix="startup_admin_")
        try:
            # Mark who triggered the repair if downloaded_by is empty.
            user = await user_dao.get_or_create(user_sub, user_email)

            if not audio_ok:
                local_mp3, _raw_name, _meta = await youtube.download(
                    song.youtube_id, tmp_dir
                )
                audio_filename = os.path.basename(local_mp3)
                audio_key = f"{song.song_name}/{audio_filename}"
                storage.upload_file(local_mp3, audio_key)
                changes["audio_key"] = audio_key
                audio_ok = True
                fixed += 1

            if not thumb_ok:
                thumb_path = await youtube.download_thumbnail(song.youtube_id, tmp_dir)
                thumb_key = f"{song.song_name}/{song.youtube_id}.jpg"
                storage.upload_file(thumb_path, thumb_key)
                changes["thumbnail_key"] = thumb_key
                thumb_ok = True
                fixed += 1

            if fixed and not song.downloaded_by:
                changes["downloaded_by"] = user.id
        finally:
            try:
                # Always cleanup local temp dir.
                import shutil

                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass

    if changes:
        await song_dao.update_by_id(song.id, **changes)

    return fixed


async def _processing_services_healthy(
    settings,
    *,
    timeout_s: float = 2.0,
) -> tuple[bool, str | None]:
    """Best-effort connectivity check for the processing microservices.

    Returns (ok, reason). When ok=False, reason is a short string that can be logged.
    """

    urls = {
        "demucs": f"http://{settings.services.inference_demucs}/health",
        "chords": f"http://{settings.services.chords_generator}/health",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            for name, url in urls.items():
                resp = await client.get(url)
                if resp.status_code != 200:
                    return False, f"{name} unhealthy (status={resp.status_code})"
    except Exception as e:
        return False, str(e)

    return True, None


async def _service_healthy(
    url: str, *, timeout_s: float = 2.0
) -> tuple[bool, str | None]:
    """Best-effort health check for a single downstream service."""

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return False, f"status={resp.status_code}"
    except Exception as e:
        return False, str(e)

    return True, None


async def _startup_admin_heal(user_sub: str, user_email: str) -> None:
    """Background task: scan every song and heal missing stems/chords/lyrics/thumbnails."""

    # Propagate user context so downstream HTTP calls (e.g. lyrics-generator)
    # receive the X-User-ID header via processing_service._request().
    user_id_var.set(user_sub)

    # Give the app a moment to finish startup before hitting the processing services.
    await asyncio.sleep(2)

    try:
        storage = get_storage()
    except Exception:
        return

    from guitar_player.config import get_settings

    settings = get_settings()
    processing = ProcessingService(settings)

    services_ok, services_reason = await _processing_services_healthy(settings)
    if not services_ok:
        logger.warning(
            "Startup admin: processing services not ready (demucs=%s chords=%s): %s. Will only repair DB keys from existing storage.",
            settings.services.inference_demucs,
            settings.services.chords_generator,
            services_reason,
        )

    tabs_service_ok, tabs_service_reason = await _service_healthy(
        f"http://{settings.services.tabs_generator}/health"
    )
    if not tabs_service_ok:
        logger.warning(
            "Startup admin: tabs service not ready (%s): %s. Will skip tabs healing for now.",
            settings.services.tabs_generator,
            tabs_service_reason,
        )

    # YouTube downloads are only safe/expected in local-ish environments.
    # In prod we still fix keys from existing storage files, but we don't
    # re-download missing originals on API startup.
    allow_youtube_downloads = (
        settings.environment in {"local", "dev", "test"}
        and settings.storage.backend == "local"
    )

    youtube = YoutubeService(
        proxy=settings.youtube.proxy,
        cookies_file=settings.youtube.cookies_file,
        max_duration_seconds=settings.youtube.max_duration_seconds,
        po_token_provider_enabled=settings.youtube.po_token_provider_enabled,
        po_token_provider_base_url=settings.youtube.po_token_provider_base_url,
        po_token_provider_disable_innertube=settings.youtube.po_token_provider_disable_innertube,
        sleep_requests_seconds=settings.youtube.sleep_requests_seconds,
        sleep_interval_seconds=settings.youtube.sleep_interval_seconds,
        max_sleep_interval_seconds=settings.youtube.max_sleep_interval_seconds,
    )

    # Collect candidate song IDs via DAO.
    async with safe_session() as session:
        song_dao = SongDAO(session)
        rows = await song_dao.get_all_ids_with_song_name()

    candidates = [(row_id, row_name) for row_id, row_name in rows if row_name]

    if not candidates:
        logger.info("Startup admin: no songs to check")
        return

    logger.info("Startup admin: checking %d songs", len(candidates))
    jobs_triggered = 0
    keys_fixed = 0

    for song_id, song_name in candidates:
        try:
            async with safe_session() as session:
                song_dao = SongDAO(session)
                user_dao = UserDAO(session)
                song = await song_dao.get_by_id(song_id)
                if not song or not song.song_name:
                    continue

                # -- Audio + thumbnail --
                # Fill missing originals first so downstream jobs have a valid input.
                fixed_here = await _admin_heal_audio_and_thumbnail_on_startup(
                    song=song,
                    song_dao=song_dao,
                    storage=storage,
                    user_sub=user_sub,
                    user_email=user_email,
                    user_dao=user_dao,
                    youtube=youtube,
                    allow_youtube_downloads=allow_youtube_downloads,
                )
                if fixed_here:
                    keys_fixed += fixed_here
                    await song_dao.flush()

                # Re-read song after potential updates
                song = await song_dao.get_by_id(song_id)
                if not song:
                    continue
                audio_ok = bool(song.audio_key) and storage.file_exists(song.audio_key)

                # -- Stems / chords (trigger_reprocess also fixes DB keys from disk) --
                job_svc = JobService(session, storage)

                # If we still don't have original audio, we can't reprocess stems.
                triggered = False
                if audio_ok and services_ok:
                    triggered = await job_svc.trigger_reprocess(
                        user_sub=user_sub,
                        user_email=user_email,
                        song_id=song_id,
                        processing=processing,
                    )
                else:
                    logger.debug(
                        "Startup admin: skipping reprocess for %s (%s) — %s",
                        song.song_name,
                        song_id,
                        (
                            "audio missing"
                            if not audio_ok
                            else "processing services unavailable"
                        ),
                    )
                if triggered:
                    jobs_triggered += 1

                # -- Lyrics (lightweight, only if vocals exist) --
                if not triggered:
                    await job_svc.trigger_lyrics_transcription_if_missing(song_id)

                if tabs_service_ok:
                    await job_svc.trigger_tabs_generation_if_missing(song_id)

                await song_dao.commit()
        except Exception as e:
            logger.warning(
                "Startup admin: song %s (%s) failed: %s", song_name, song_id, e
            )

        # Pace requests so we don't overwhelm the processing microservices.
        await asyncio.sleep(0.5)

    logger.info(
        "Startup admin complete: %d songs checked, %d jobs triggered, %d keys fixed",
        len(candidates),
        jobs_triggered,
        keys_fixed,
    )


def start_startup_admin_heal(user_sub: str, user_email: str) -> None:
    """Launch the post-startup admin healing scan as a background task."""
    task = asyncio.create_task(_startup_admin_heal(user_sub, user_email))
    _track_task(task)
