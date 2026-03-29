"""JobService -- creates and tracks processing jobs."""

import logging
import uuid

from guitar_player.app_state import get_storage
from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.exceptions import NotFoundError
from guitar_player.schemas.job import JobResponse
from guitar_player.schemas.records import JobRecord
from guitar_player.services.processing_service import ProcessingService
from guitar_player.storage import StorageBackend

from .background_tasks import (
    EXTERNAL_STRUMS_TASKS,
    LYRICS_TASKS,
    MERGE_TASKS,
    TABS_TASKS,
    WEB_CHORDS_TASKS,
)
from .constants import (
    CURRENT_LYRICS_HEAL_VERSION,
    DEFAULT_REQUESTED_OUTPUTS,
    DERIVED_STEMS,
    LIGHTWEIGHT_TASK_COOLDOWN_SECONDS,
    STEM_FILE_VARIANTS,
)
from .helpers import (
    active_job_stale_reason,
    find_stem,
    has_non_latin_text,
    should_log_admin_heal_info,
    stem_candidates,
    to_aware_utc,
    utcnow,
)

logger = logging.getLogger(__name__)


def _pkg_enqueue(name: str, *args, **kwargs):
    """Call an enqueue function via the package module for mock-ability.

    Tests patch ``guitar_player.services.job_service._enqueue_*`` attributes
    on the package ``__init__`` module. This helper resolves the function at
    call time so those patches take effect.
    """
    import sys  # deferred to avoid linter removal

    mod = sys.modules["guitar_player.services.job_service"]
    return getattr(mod, name)(*args, **kwargs)


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

    # ------------------------------------------------------------------
    # Job lifecycle
    # ------------------------------------------------------------------

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
        return it instead of creating a duplicate.
        """
        user = await self._user_dao.get_or_create(user_sub, user_email)

        song = await self._song_dao.acquire_processing_lock(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        if song.processing_job_id:
            existing = await self._handle_existing_job(song)
            if existing is not None:
                return existing

        job = await self._job_dao.create(
            user_id=user.id,
            song_id=song.id,
            status="PENDING",
            progress=0,
            stage="queued",
            descriptions=descriptions,
            mode=mode,
        )

        await self._song_dao.update_by_id(
            song.id, processing_job_id=job.id,
            lyrics_failed=False, tabs_failed=False,
        )

        if processing is not None:
            await self._song_dao.commit()
            self._write_initial_manifest(song, job)
            self._dispatch_job(job)

        return self._enrich_job(job)

    async def _handle_existing_job(self, song) -> JobResponse | None:
        """Check existing job; return response if still active, else clear lock."""
        existing_job = await self._job_dao.get_by_id(song.processing_job_id)
        if existing_job and existing_job.status in ("PENDING", "PROCESSING"):
            reason = active_job_stale_reason(
                getattr(existing_job, "updated_at", None), now=utcnow(),
            )
            if reason:
                await self._job_dao.update_status(
                    existing_job.id, "FAILED", error_message=reason,
                )
                await self._song_dao.update_by_id(
                    song.id, processing_job_id=None,
                )
                return None
            logger.info(
                "Idempotent job creation: returning existing active job %s for song %s",
                existing_job.id, song.id,
            )
            return self._enrich_job(existing_job)
        # Job doesn't exist or is already COMPLETED/FAILED.
        await self._song_dao.update_by_id(song.id, processing_job_id=None)
        return None

    def _write_initial_manifest(self, song, job) -> None:
        """Write an initial "pending" manifest so the presigned URL never 404s."""
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

    def _dispatch_job(self, job) -> None:
        """Dispatch job to Lambda orchestrator or local background task."""
        try:
            from guitar_player.config import get_settings
            from guitar_player.services.lambda_invoke import invoke_event

            settings = get_settings()
            fn = getattr(
                getattr(settings, "lambdas", None), "job_orchestrator", None
            )
            if fn:
                import asyncio
                asyncio.create_task(invoke_event(
                    region=settings.aws.region,
                    function_name=fn,
                    payload={"job_id": str(job.id)},
                ))
            else:
                _pkg_enqueue("_enqueue_job_processing", job.id)
        except Exception:
            logger.exception("Failed to dispatch job %s", job.id)
            _pkg_enqueue("_enqueue_job_processing", job.id)

    async def trigger_reprocess(
        self,
        user_sub: str,
        user_email: str,
        song_id: uuid.UUID,
        processing: ProcessingService,
    ) -> uuid.UUID | None:
        """Admin: fix DB keys from existing files, or reprocess if truly missing.

        Returns the job ID if a reprocessing job was triggered, None otherwise.
        """
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        missing_any = await self._fix_keys_from_disk(song)

        if not missing_any:
            return None

        # Files truly missing -- trigger reprocess if no non-stale active job.
        active_job = await self._job_dao.get_active_job(song_id)
        if active_job is not None:
            reason = active_job_stale_reason(
                getattr(active_job, "updated_at", None), now=utcnow(),
            )
            if reason:
                await self._job_dao.update_status(
                    active_job.id, "FAILED", error_message=reason,
                )
                if song.processing_job_id == active_job.id:
                    await self._song_dao.update_by_id(
                        song.id, processing_job_id=None,
                    )
            else:
                return None

        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        audio_ok = bool(song.audio_key) and self._storage.file_exists(song.audio_key)
        if not audio_ok:
            logger.info(
                "Admin: skipping reprocess for song %s -- audio missing (key=%r)",
                song_id, song.audio_key,
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

    async def _fix_keys_from_disk(self, song) -> bool:
        """Scan disk for stem/chords/lyrics files and fix DB keys.

        Returns True if any core artifact is still missing after fixes.
        """
        missing_any = False
        fix_changes: dict = {}

        for stem_name, variants in STEM_FILE_VARIANTS.items():
            col = f"{stem_name}_key"
            current_key = getattr(song, col, None)

            if bool(current_key) and self._storage.file_exists(current_key):
                continue

            stem_missing = True
            for filename in variants:
                candidate_key = f"{song.song_name}/{filename}"
                if self._storage.file_exists(candidate_key):
                    fix_changes[col] = candidate_key
                    logger.info("Admin: fixed %s -> %s", col, candidate_key)
                    stem_missing = False
                    break

            if stem_missing and stem_name not in DERIVED_STEMS:
                missing_any = True

        # Chords
        chords_ok = bool(song.chords_key) and self._storage.file_exists(song.chords_key)
        if not chords_ok:
            chords_candidate = f"{song.song_name}/chords.json"
            if self._storage.file_exists(chords_candidate):
                fix_changes["chords_key"] = chords_candidate
            else:
                missing_any = True

        # Lyrics: fix DB key from disk but don't trigger full reprocess for it.
        lyrics_ok = bool(song.lyrics_key) and self._storage.file_exists(song.lyrics_key)
        if not lyrics_ok:
            lyrics_candidate = f"{song.song_name}/lyrics.json"
            if self._storage.file_exists(lyrics_candidate):
                fix_changes["lyrics_key"] = lyrics_candidate

        if fix_changes:
            await self._song_dao.update_by_id(song.id, **fix_changes)

        return missing_any

    # ------------------------------------------------------------------
    # Lightweight trigger methods (lyrics, merge, tabs, strums, chords)
    # ------------------------------------------------------------------

    async def trigger_lyrics_transcription_if_missing(
        self, song_id: uuid.UUID,
    ) -> bool:
        """If lyrics are missing but vocals exist, enqueue a lyrics-only transcription.

        Returns True if a background transcription task was enqueued.
        """
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        lyrics_ok = self._check_lyrics_on_disk(song)
        is_non_latin = has_non_latin_text(song.title, song.artist, song.song_name)

        # Handle lyrics_failed gate with heal-version logic.
        if song.lyrics_failed:
            result = await self._handle_lyrics_failed_gate(
                song, song_id, lyrics_ok, is_non_latin,
            )
            if result is not None:
                if not result:
                    return False
                # Gate passed -- re-read song and re-check.
                song = await self._song_dao.get_by_id(song_id)
                if not song:
                    return False
                lyrics_ok = self._check_lyrics_on_disk(song)

        if not self._should_enqueue_lyrics(song, song_id, lyrics_ok, is_non_latin):
            return False

        quick_ok = bool(song.lyrics_quick_key) and self._storage.file_exists(
            song.lyrics_quick_key
        )
        quick_only = lyrics_ok and not quick_ok

        vocals_key = self._find_vocals_source(song, quick_only)
        if not vocals_key:
            self._log_blocked_lyrics(song, song_id, lyrics_ok, quick_ok, quick_only)
            return False

        await self._song_dao.update_by_id(song.id, lyrics_attempted_at=utcnow())

        reason = "missing_lyrics" if not lyrics_ok else "missing_quick_lyrics"
        logger.info(
            "Admin heal: enqueued lyrics-only transcription "
            "song_id=%s song_name=%r reason=%s vocals_key=%s quick_only=%s",
            song_id, song.song_name, reason, vocals_key, quick_only,
            extra={
                "event_type": "admin_heal",
                "action": "lyrics_only",
                "song_id": str(song_id),
                "outcome": "enqueued",
                "reason": reason,
            },
        )
        _pkg_enqueue("_enqueue_lyrics_transcription", song_id, quick_only=quick_only)
        return True

    def _check_lyrics_on_disk(self, song) -> bool:
        """Check whether full lyrics exist in DB or on disk."""
        lyrics_ok = bool(song.lyrics_key) and self._storage.file_exists(song.lyrics_key)
        if not lyrics_ok and song.song_name:
            lyrics_ok = self._storage.file_exists(f"{song.song_name}/lyrics.json")
        return lyrics_ok

    async def _handle_lyrics_failed_gate(
        self, song, song_id: uuid.UUID, lyrics_ok: bool, is_non_latin: bool,
    ) -> bool | None:
        """Handle lyrics_failed gate. Returns True to continue, False to stop, None for passthrough."""
        needs_heal = (
            is_non_latin and song.lyrics_heal_version < CURRENT_LYRICS_HEAL_VERSION
        )
        if needs_heal:
            logger.info(
                "Admin heal: one-time lyrics retry (heal_version %d -> %d) song_id=%s",
                song.lyrics_heal_version, CURRENT_LYRICS_HEAL_VERSION, song_id,
            )
            await self._song_dao.update_by_id(
                song.id,
                lyrics_failed=False,
                lyrics_attempted_at=None,
                lyrics_heal_version=CURRENT_LYRICS_HEAL_VERSION,
            )
            return True
        if not lyrics_ok:
            logger.info(
                "Admin heal: retrying full lyrics transcription despite "
                "lyrics_failed=True song_id=%s",
                song_id,
            )
            await self._song_dao.update_by_id(
                song.id, lyrics_failed=False, lyrics_attempted_at=None,
            )
            return True
        if should_log_admin_heal_info("lyrics_only", song_id):
            logger.info(
                "Admin heal: lyrics-only blocked (lyrics_failed=True) song_id=%s",
                song_id,
            )
        return False

    def _should_enqueue_lyrics(
        self, song, song_id: uuid.UUID, lyrics_ok: bool, is_non_latin: bool,
    ) -> bool:
        """Check cooldown, in-flight tasks, and whether work is needed."""
        # DB-based cooldown
        if song.lyrics_attempted_at:
            age_s = (utcnow() - to_aware_utc(song.lyrics_attempted_at)).total_seconds()
            if age_s < LIGHTWEIGHT_TASK_COOLDOWN_SECONDS:
                return False

        # Clear stale active job if needed.
        # (best-effort; doesn't block lyrics-only transcription)

        # Check in-flight task.
        existing_task = LYRICS_TASKS.get(song_id)
        if existing_task and not existing_task.done():
            return False

        quick_ok = bool(song.lyrics_quick_key) and self._storage.file_exists(
            song.lyrics_quick_key
        )

        # Backfill quick lyrics from disk.
        if lyrics_ok and not quick_ok and song.song_name:
            quick_candidate = f"{song.song_name}/lyrics_quick.json"
            if self._storage.file_exists(quick_candidate):
                # Will be handled synchronously; no background task needed.
                return False

        # One-time re-transcription for non-Latin songs.
        if (
            lyrics_ok
            and is_non_latin
            and song.lyrics_heal_version < CURRENT_LYRICS_HEAL_VERSION
        ):
            return True

        if lyrics_ok and quick_ok:
            return False

        # Fix from disk if possible.
        if not lyrics_ok and song.song_name:
            candidate = f"{song.song_name}/lyrics.json"
            if self._storage.file_exists(candidate):
                return False

        if not song.song_name:
            if should_log_admin_heal_info("lyrics_only", song_id):
                logger.info(
                    "Admin heal: lyrics-only blocked (missing song_name) song_id=%s",
                    song_id,
                )
            return False

        return True

    def _find_vocals_source(self, song, quick_only: bool) -> str | None:
        """Find a vocals audio source for lyrics transcription."""
        if not song.song_name:
            return None
        vocals_candidates = [
            getattr(song, "vocals_key", None),
            *stem_candidates(song.song_name, "vocals", "vocals_isolated"),
        ]
        vocals_key = next(
            (k for k in vocals_candidates if k and self._storage.file_exists(k)), None,
        )
        if not vocals_key and quick_only:
            if song.audio_key and self._storage.file_exists(song.audio_key):
                vocals_key = song.audio_key
        return vocals_key

    def _log_blocked_lyrics(
        self, song, song_id, lyrics_ok, quick_ok, quick_only,
    ) -> None:
        """Log when lyrics transcription is blocked due to missing audio source."""
        if should_log_admin_heal_info("lyrics_only", song_id):
            logger.info(
                "Admin heal: lyrics-only blocked (no audio source) song_id=%s",
                song_id,
            )

    async def trigger_vocals_guitar_merge_if_missing(
        self, song_id: uuid.UUID,
    ) -> bool:
        """If vocals+guitar merge is missing but both source stems exist, enqueue merge."""
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        if song.merge_attempted_at:
            age_s = (utcnow() - to_aware_utc(song.merge_attempted_at)).total_seconds()
            if age_s < LIGHTWEIGHT_TASK_COOLDOWN_SECONDS:
                return False

        existing_task = MERGE_TASKS.get(song_id)
        if existing_task and not existing_task.done():
            return False

        vg_ok = bool(song.vocals_guitar_key) and self._storage.file_exists(
            song.vocals_guitar_key
        )
        if vg_ok:
            return False

        if not song.song_name:
            return False

        vg_candidate = find_stem(self._storage, song.song_name, "vocals_guitar")
        if vg_candidate:
            await self._song_dao.update_by_id(song.id, vocals_guitar_key=vg_candidate)
            return False

        vocals_key, guitar_key = self._find_merge_stems(song)
        if not vocals_key or not guitar_key:
            return False

        await self._song_dao.update_by_id(song.id, merge_attempted_at=utcnow())
        _pkg_enqueue("_enqueue_vocals_guitar_merge", song_id)
        return True

    def _find_merge_stems(self, song) -> tuple[str | None, str | None]:
        """Find vocals and guitar stems for merging."""
        vocals_candidates = [
            getattr(song, "vocals_key", None),
            *stem_candidates(song.song_name, "vocals", "vocals_isolated"),
        ]
        vocals_key = next(
            (k for k in vocals_candidates if k and self._storage.file_exists(k)), None,
        )

        guitar_candidates = [
            getattr(song, "guitar_key", None),
            *stem_candidates(song.song_name, "guitar", "guitar_isolated"),
        ]
        guitar_key = next(
            (k for k in guitar_candidates if k and self._storage.file_exists(k)), None,
        )
        return vocals_key, guitar_key

    async def trigger_tabs_generation_if_missing(
        self, song_id: uuid.UUID, *, force: bool = False,
    ) -> bool:
        """If tabs are missing but the guitar stem exists, enqueue tabs generation."""
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        tabs_key_missing_on_disk = (
            bool(song.tabs_key) and not self._storage.file_exists(song.tabs_key)
        )
        if tabs_key_missing_on_disk:
            await self._song_dao.update_by_id(song.id, tabs_key=None)
            song.tabs_key = None

        tabs_attempt_age_s = self._get_attempt_age(song.tabs_attempted_at)

        if not self._should_enqueue_tabs(
            song, force, tabs_key_missing_on_disk, tabs_attempt_age_s,
        ):
            return False

        existing_task = TABS_TASKS.get(song_id)
        if existing_task and not existing_task.done():
            return False

        tabs_ok = bool(song.tabs_key) and self._storage.file_exists(song.tabs_key)
        if tabs_ok:
            return False

        if not song.song_name:
            return False

        tabs_candidate = f"{song.song_name}/tabs.json"
        if self._storage.file_exists(tabs_candidate):
            await self._song_dao.update_by_id(song.id, tabs_key=tabs_candidate)
            return False

        guitar_key = self._find_guitar_stem(song)
        if not guitar_key:
            return False

        update_kwargs: dict = {"tabs_attempted_at": utcnow()}
        if force or song.tabs_failed:
            update_kwargs["tabs_failed"] = False
        await self._song_dao.update_by_id(song.id, **update_kwargs)

        logger.info("Admin: tabs missing for %s; enqueuing generation", song_id)
        _pkg_enqueue("_enqueue_tabs_generation", song_id)
        return True

    def _should_enqueue_tabs(
        self, song, force: bool, tabs_key_missing_on_disk: bool,
        tabs_attempt_age_s: float | None,
    ) -> bool:
        """Check whether tabs generation should proceed."""
        if song.tabs_failed and not force and not tabs_key_missing_on_disk:
            if (
                tabs_attempt_age_s is not None
                and tabs_attempt_age_s < LIGHTWEIGHT_TASK_COOLDOWN_SECONDS
            ):
                return False

        if song.tabs_attempted_at and not force and not tabs_key_missing_on_disk:
            if (
                tabs_attempt_age_s is not None
                and tabs_attempt_age_s < LIGHTWEIGHT_TASK_COOLDOWN_SECONDS
            ):
                return False

        return True

    def _find_guitar_stem(self, song) -> str | None:
        """Find a guitar stem file."""
        if not song.song_name:
            return None
        guitar_candidates = [
            getattr(song, "guitar_key", None),
            *stem_candidates(song.song_name, "guitar", "guitar_isolated"),
        ]
        return next(
            (k for k in guitar_candidates if k and self._storage.file_exists(k)), None,
        )

    def _get_attempt_age(self, attempted_at) -> float | None:
        """Calculate age in seconds since an attempt timestamp."""
        if not attempted_at:
            return None
        return (utcnow() - to_aware_utc(attempted_at)).total_seconds()

    async def trigger_external_strums_if_missing(
        self, song_id: uuid.UUID, *, force: bool = False,
    ) -> bool:
        """If external strums are missing, enqueue background Songsterr fetch."""
        song = await self._song_dao.get_by_id(song_id)
        if not song or not song.song_name or not song.artist:
            return False

        if not force:
            if (
                song.external_strums_key
                and self._storage.file_exists(song.external_strums_key)
            ):
                return False

            candidate = f"{song.song_name}/external_strums.json"
            if self._storage.file_exists(candidate):
                await self._song_dao.update_by_id(
                    song.id, external_strums_key=candidate,
                )
                return False

        if not self._should_enqueue_by_cooldown(
            song.external_strums_failed,
            song.external_strums_attempted_at,
            force,
        ):
            return False

        existing_task = EXTERNAL_STRUMS_TASKS.get(song_id)
        if existing_task and not existing_task.done():
            return False

        update_kwargs: dict = {"external_strums_attempted_at": utcnow()}
        if force or song.external_strums_failed:
            update_kwargs["external_strums_failed"] = False
        await self._song_dao.update_by_id(song.id, **update_kwargs)

        logger.info(
            "External strums: enqueuing fetch for %s (%s - %s)",
            song_id, song.artist, song.title,
        )
        _pkg_enqueue("_enqueue_external_strums_fetch", song_id)
        return True

    async def trigger_web_chords_if_missing(
        self, song_id: uuid.UUID, *, force: bool = False,
    ) -> bool:
        """If Gemini web chords are missing, enqueue background detection."""
        song = await self._song_dao.get_by_id(song_id)
        if not song or not song.song_name or not song.audio_key:
            return False

        if not force:
            if (
                song.web_chords_key
                and self._storage.file_exists(song.web_chords_key)
            ):
                return False

            candidate = f"{song.song_name}/chords_web.json"
            if self._storage.file_exists(candidate):
                await self._song_dao.update_by_id(
                    song.id, web_chords_key=candidate,
                )
                return False

        if not self._should_enqueue_by_cooldown(
            song.web_chords_failed,
            song.web_chords_attempted_at,
            force,
        ):
            return False

        existing_task = WEB_CHORDS_TASKS.get(song_id)
        if existing_task and not existing_task.done():
            return False

        update_kwargs: dict = {"web_chords_attempted_at": utcnow()}
        if force or song.web_chords_failed:
            update_kwargs["web_chords_failed"] = False
        await self._song_dao.update_by_id(song.id, **update_kwargs)

        logger.info(
            "Web chords: enqueuing Gemini detection for %s (%s - %s)",
            song_id, song.artist, song.title,
        )
        _pkg_enqueue("_enqueue_web_chords_fetch", song_id)
        return True

    def _should_enqueue_by_cooldown(
        self, failed: bool, attempted_at, force: bool,
    ) -> bool:
        """Shared cooldown check for external strums and web chords."""
        attempt_age_s = self._get_attempt_age(attempted_at)

        if failed and not force:
            if (
                attempt_age_s is not None
                and attempt_age_s < LIGHTWEIGHT_TASK_COOLDOWN_SECONDS
            ):
                return False

        if attempted_at and not force:
            if (
                attempt_age_s is not None
                and attempt_age_s < LIGHTWEIGHT_TASK_COOLDOWN_SECONDS
            ):
                return False

        return True

    # ------------------------------------------------------------------
    # Read methods
    # ------------------------------------------------------------------

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
        self, user_sub: str, offset: int = 0, limit: int = 50,
    ) -> list[JobResponse]:
        user = await self._user_dao.get_by_cognito_sub(user_sub)
        if not user:
            return []
        jobs = await self._job_dao.get_by_user(user.id, offset, limit)
        return [self._enrich_job(j) for j in jobs]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _refresh_active_job_if_stale(self, job: JobRecord) -> JobRecord:
        """Mark stale/orphaned active jobs failed and return the latest row."""
        if job.status not in ("PENDING", "PROCESSING"):
            return job

        reason = active_job_stale_reason(
            getattr(job, "updated_at", None), now=utcnow(),
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
