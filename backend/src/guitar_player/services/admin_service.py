"""Admin service — business logic for admin endpoints.

Handles determining which songs need repair, healing songs, managing
download completion, and dropping songs. The router delegates all
business logic here.
"""

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.song_dao import SongDAO
from guitar_player.exceptions import NotFoundError, YoutubeAuthenticationRequiredError
from guitar_player.schemas.admin import (
    AdminDownloadCompleteResponse,
    AdminDropSongsResponse,
    AdminRequiredSong,
    AdminRequiredSongsResponse,
    AdminSongResponse,
)
from guitar_player.schemas.records import SongRecord
from guitar_player.services.job_service import JobService
from guitar_player.services.processing_service import ProcessingService
from guitar_player.services.song_service import SongService
from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)

_SERVICE_USER_SUB = "admin-service"
_SERVICE_USER_EMAIL = "admin-service@local.test"

_UNRECOVERABLE_LOG = Path(__file__).resolve().parents[4] / "unrecoverable_songs.log"

_MISSING_CHECK_COLUMNS: tuple[str, ...] = (
    "audio_key",
    "thumbnail_key",
    "vocals_key",
    "guitar_key",
    "guitar_removed_key",
    "chords_key",
    "lyrics_key",
    "lyrics_quick_key",
    "tabs_key",
)


def _reasons_for_song(song: SongRecord, *, storage: StorageBackend | None) -> list[str]:
    reasons: list[str] = []
    for col in _MISSING_CHECK_COLUMNS:
        key = getattr(song, col, None)
        if not key:
            reasons.append(f"missing:{col}")
            continue
        if storage is not None and not storage.file_exists(key):
            reasons.append(f"missing_file:{col}")
    return reasons


def _log_unrecoverable(*, song_name: str, artist: str, title: str, reason: str) -> None:
    """Append a line to the unrecoverable songs log at the repo root."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(_UNRECOVERABLE_LOG, "a") as f:
        f.write(f"{ts}\t{song_name}\t{artist}\t{title}\t{reason}\n")


def _collect_storage_prefixes(song: SongRecord) -> list[str]:
    """Return unique storage prefixes (song_name dirs) for a song."""
    if song.song_name:
        return [song.song_name]
    return []


class AdminService:
    def __init__(self, session: AsyncSession, storage: StorageBackend) -> None:
        self._session = session
        self._song_dao = SongDAO(session)
        self._storage = storage

    async def list_required_songs(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
        check_storage: bool = True,
        max_scan: int | None = None,
    ) -> AdminRequiredSongsResponse:
        """Return songs that appear to require admin healing."""
        if max_scan is None:
            max_scan = max(500, limit * 20)

        items: list[AdminRequiredSong] = []
        scanned = 0
        current_offset = offset

        while scanned < max_scan and len(items) < limit:
            batch_size = min(200, max_scan - scanned)
            songs = await self._song_dao.list_ordered_for_scan(
                offset=current_offset,
                limit=batch_size,
                missing_key_columns=list(_MISSING_CHECK_COLUMNS) if not check_storage else None,
            )
            if not songs:
                return AdminRequiredSongsResponse(
                    items=items, scanned=scanned, next_offset=None,
                )

            songs_iterated = 0
            for song in songs:
                songs_iterated += 1
                scanned += 1
                reasons = _reasons_for_song(
                    song, storage=self._storage if check_storage else None
                )
                if reasons:
                    items.append(
                        AdminRequiredSong(
                            song_id=song.id, song_name=song.song_name, reasons=reasons,
                        )
                    )
                    if len(items) >= limit:
                        break
            current_offset += songs_iterated

        return AdminRequiredSongsResponse(
            items=items, scanned=scanned, next_offset=current_offset,
        )

    async def heal_song(
        self,
        song_id: uuid.UUID,
        song_service: SongService,
        job_service: JobService,
        processing: ProcessingService,
    ) -> AdminSongResponse:
        """Attempt to heal a song: fix audio/thumbnail, reprocess, enqueue lyrics/tabs."""
        warnings: list[str] = []
        audio_thumb_fixed, audio_heal_error, audio_heal_exception = await self._try_heal_audio(
            song_id, song_service, warnings,
        )

        # If audio is still missing after the heal attempt, handle unrecoverable case.
        song = await self._song_dao.get_by_id(song_id)
        if song:
            unrecoverable_response = await self._handle_unrecoverable_song(
                song_id, song, audio_heal_error, audio_heal_exception, warnings,
            )
            if unrecoverable_response:
                return unrecoverable_response

        reprocess_job_id = await self._try_reprocess(song_id, job_service, processing, warnings)
        lyrics_enqueued = await self._try_lyrics(song_id, job_service, warnings)
        tabs_enqueued = await self._try_tabs(song_id, job_service, warnings)

        return AdminSongResponse(
            song_id=song_id,
            audio_thumbnail_fixed=audio_thumb_fixed,
            reprocess_triggered=reprocess_job_id is not None,
            lyrics_enqueued=lyrics_enqueued,
            tabs_enqueued=tabs_enqueued,
            job_id=reprocess_job_id,
            warnings=warnings,
        )

    async def _try_heal_audio(
        self,
        song_id: uuid.UUID,
        song_service: SongService,
        warnings: list[str],
    ) -> tuple[bool, str | None, Exception | None]:
        """Attempt audio/thumbnail heal; return (fixed, error_msg, exception)."""
        try:
            fixed = await song_service.admin_heal_audio_and_thumbnail(
                song_id, user_sub=_SERVICE_USER_SUB, user_email=_SERVICE_USER_EMAIL,
            )
            return fixed, None, None
        except Exception as e:
            logger.warning("Admin audio/thumbnail heal failed for %s: %s", song_id, e)
            warnings.append(f"audio_thumbnail_failed:{type(e).__name__}")
            await self._song_dao.rollback()
            return False, f"{type(e).__name__}: {e}", e

    async def _handle_unrecoverable_song(
        self,
        song_id: uuid.UUID,
        song: SongRecord,
        audio_heal_error: str | None,
        audio_heal_exception: Exception | None,
        warnings: list[str],
    ) -> AdminSongResponse | None:
        """Check if a song is unrecoverable and delete it if so. Returns response or None."""
        audio_exists = bool(song.audio_key) and self._storage.file_exists(song.audio_key)
        if audio_exists:
            return None

        reason = audio_heal_error or "audio missing after heal attempt"

        if isinstance(audio_heal_exception, YoutubeAuthenticationRequiredError):
            logger.info(
                "Keeping song %s (%s) because YouTube auth is required: %s",
                song_id, song.song_name, reason,
            )
            warnings.append(f"auth_required: {reason}")
            return AdminSongResponse(
                song_id=song_id, audio_thumbnail_fixed=False, warnings=warnings,
            )

        _log_unrecoverable(
            song_name=song.song_name or "?",
            artist=song.artist or "?",
            title=song.title or "?",
            reason=reason,
        )
        await self._song_dao.delete_by_id(song.id)
        logger.info("Deleted unrecoverable song %s (%s) — %s", song_id, song.song_name, reason)
        return AdminSongResponse(
            song_id=song_id, deleted=True, warnings=[f"unrecoverable: {reason}"],
        )

    async def _try_reprocess(
        self,
        song_id: uuid.UUID,
        job_service: JobService,
        processing: ProcessingService,
        warnings: list[str],
    ) -> uuid.UUID | None:
        try:
            return await job_service.trigger_reprocess(
                user_sub=_SERVICE_USER_SUB,
                user_email=_SERVICE_USER_EMAIL,
                song_id=song_id,
                processing=processing,
            )
        except Exception as e:
            logger.warning("Admin reprocess check failed for %s: %s", song_id, e)
            warnings.append(f"reprocess_failed:{type(e).__name__}")
            await self._song_dao.rollback()
            return None

    async def _try_lyrics(
        self, song_id: uuid.UUID, job_service: JobService, warnings: list[str],
    ) -> bool:
        try:
            return await job_service.trigger_lyrics_transcription_if_missing(song_id)
        except Exception as e:
            logger.warning("Admin lyrics check failed for %s: %s", song_id, e)
            warnings.append(f"lyrics_failed:{type(e).__name__}")
            await self._song_dao.rollback()
            return False

    async def _try_tabs(
        self, song_id: uuid.UUID, job_service: JobService, warnings: list[str],
    ) -> bool:
        try:
            return await job_service.trigger_tabs_generation_if_missing(song_id, force=True)
        except Exception as e:
            logger.warning("Admin tabs check failed for %s: %s", song_id, e)
            warnings.append(f"tabs_failed:{type(e).__name__}")
            await self._song_dao.rollback()
            return False

    async def download_complete(
        self,
        song_id: uuid.UUID,
        job_service: JobService,
        processing: ProcessingService,
    ) -> AdminDownloadCompleteResponse:
        """Handle homeserver download completion: clear flag and trigger processing."""
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))
        if not song.audio_key or not self._storage.file_exists(song.audio_key):
            raise NotFoundError("Audio file", str(song_id))

        await self._song_dao.update_by_id(song_id, download_requested_at=None)

        job = await job_service.create_and_process_job(
            user_sub=_SERVICE_USER_SUB,
            user_email=_SERVICE_USER_EMAIL,
            song_id=song_id,
            descriptions=["vocals", "guitar", "guitar_removed"],
            processing=processing,
        )
        logger.info(
            "Homeserver download complete for song %s — triggered job %s", song_id, job.id,
        )
        return AdminDownloadCompleteResponse(job_id=str(job.id))

    async def drop_song(
        self,
        song_id: uuid.UUID,
        skip_storage: bool = False,
    ) -> AdminDropSongsResponse:
        """Delete a single song and optionally its storage files."""
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        storage_errors = self._delete_storage_for_songs([song], skip_storage)
        await self._song_dao.delete_by_id(song.id)
        logger.info(
            "Dropped song %s (%s) (skip_storage=%s)", song_id, song.song_name, skip_storage,
        )
        return AdminDropSongsResponse(songs_deleted=1, storage_errors=storage_errors)

    async def drop_all_songs(
        self,
        confirm: str,
        skip_storage: bool = False,
    ) -> AdminDropSongsResponse:
        """Delete ALL songs and optionally their storage files."""
        from guitar_player.exceptions import BadRequestError

        if confirm != "yes-delete-all":
            raise BadRequestError("confirm must be 'yes-delete-all'")

        songs = await self._song_dao.list_all(offset=0, limit=100_000)
        storage_errors = self._delete_storage_for_songs(songs, skip_storage)

        for song in songs:
            await self._song_dao.delete_by_id(song.id)

        count = len(songs)
        logger.info("Dropped all %d songs (skip_storage=%s)", count, skip_storage)
        return AdminDropSongsResponse(songs_deleted=count, storage_errors=storage_errors)

    def _delete_storage_for_songs(
        self, songs: list[SongRecord], skip_storage: bool,
    ) -> list[str]:
        """Delete storage files for a list of songs. Returns error messages."""
        storage_errors: list[str] = []
        if skip_storage:
            return storage_errors
        for song in songs:
            for prefix in _collect_storage_prefixes(song):
                try:
                    deleted = self._storage.delete_prefix(prefix)
                    logger.info("Deleted %d storage files under %s", deleted, prefix)
                except Exception as e:
                    logger.warning("Storage cleanup failed for %s: %s", prefix, e)
                    storage_errors.append(f"{prefix}: {e}")
        return storage_errors
