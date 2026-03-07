"""Admin service endpoints.

These endpoints are intended for operational automation (a runner script),
not for end-user usage. They use a dedicated shared-secret auth mechanism.
"""

import logging
import time
import uuid
from collections.abc import Callable, Coroutine
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import json

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.admin import require_admin_token
from guitar_player.config import Settings, get_settings
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.database import safe_session
from guitar_player.dependencies import (
    get_db,
    get_job_service,
    get_processing_service,
    get_song_service,
    get_storage,
)
from guitar_player.exceptions import YoutubeAuthenticationRequiredError
from guitar_player.models.song import Song
from guitar_player.schemas.admin import (
    AdminDropSongsResponse,
    AdminRequiredSongsResponse,
    AdminSeedPopulateResponse,
    AdminSongResponse,
    SanityCheckResult,
    SanityCheckStatus,
    SanityRequest,
    SanityResponse,
)
from guitar_player.schemas.job import JobResponse
from guitar_player.services.job_service import JobService
from guitar_player.services.processing_service import ProcessingService
from guitar_player.services.seed_service import (
    seed_db_catalog,
    seed_discover_storage_keys,
    seed_update_metadata,
)
from guitar_player.services.admin_service import AdminService
from guitar_player.services.song_service import SongService
from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

_SERVICE_USER_SUB = "admin-service"
_SERVICE_USER_EMAIL = "admin-service@local.test"


@router.get("/required", response_model=AdminRequiredSongsResponse)
async def list_admin_required_songs(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    check_storage: bool = Query(True),
    max_scan: int = Query(
        0,
        ge=0,
        le=10_000,
        description="Max songs to scan from the DB starting at offset (0=default).",
    ),
    _: None = Depends(require_admin_token),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> AdminRequiredSongsResponse:
    service = AdminService(session, storage)
    return await service.list_required_songs(
        offset=offset,
        limit=limit,
        check_storage=check_storage,
        max_scan=None if max_scan == 0 else max_scan,
    )


_UNRECOVERABLE_LOG = Path(__file__).resolve().parents[4] / "unrecoverable_songs.log"


def _log_unrecoverable(*, song_name: str, artist: str, title: str, reason: str) -> None:
    """Append a line to the unrecoverable songs log at the repo root."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(_UNRECOVERABLE_LOG, "a") as f:
        f.write(f"{ts}\t{song_name}\t{artist}\t{title}\t{reason}\n")


@router.post("/songs/{song_id}/heal", response_model=AdminSongResponse)
async def admin_heal_song(
    song_id: uuid.UUID,
    _: None = Depends(require_admin_token),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
    song_service: SongService = Depends(get_song_service),
    job_service: JobService = Depends(get_job_service),
    processing: ProcessingService = Depends(get_processing_service),
) -> AdminSongResponse:
    warnings: list[str] = []

    audio_thumb_fixed = False
    audio_heal_error: str | None = None
    audio_heal_exception: Exception | None = None
    try:
        audio_thumb_fixed = await song_service.admin_heal_audio_and_thumbnail(
            song_id,
            user_sub=_SERVICE_USER_SUB,
            user_email=_SERVICE_USER_EMAIL,
        )
    except Exception as e:
        logger.warning("Admin (service) audio/thumbnail failed for %s: %s", song_id, e)
        warnings.append(f"audio_thumbnail_failed:{type(e).__name__}")
        audio_heal_error = f"{type(e).__name__}: {e}"
        audio_heal_exception = e
        await session.rollback()

    # If audio is still missing after the heal attempt, the song is
    # unrecoverable — log it and delete from DB.
    dao = SongDAO(session)
    song = await dao.get_by_id(song_id)
    if song:
        audio_exists = bool(song.audio_key) and storage.file_exists(song.audio_key)
        if not audio_exists:
            reason = audio_heal_error or "audio missing after heal attempt"
            if isinstance(audio_heal_exception, YoutubeAuthenticationRequiredError):
                logger.info(
                    "Keeping song %s (%s) because YouTube auth is required: %s",
                    song_id,
                    song.song_name,
                    reason,
                )
                warnings.append(f"auth_required: {reason}")
                return AdminSongResponse(
                    song_id=song_id,
                    audio_thumbnail_fixed=False,
                    warnings=warnings,
                )
            _log_unrecoverable(
                song_name=song.song_name or "?",
                artist=song.artist or "?",
                title=song.title or "?",
                reason=reason,
            )
            await dao.delete(song)
            logger.info(
                "Deleted unrecoverable song %s (%s) — %s",
                song_id,
                song.song_name,
                reason,
            )
            return AdminSongResponse(
                song_id=song_id,
                deleted=True,
                warnings=[f"unrecoverable: {reason}"],
            )

    reprocess_job_id: uuid.UUID | None = None
    try:
        reprocess_job_id = await job_service.trigger_reprocess(
            user_sub=_SERVICE_USER_SUB,
            user_email=_SERVICE_USER_EMAIL,
            song_id=song_id,
            processing=processing,
        )
    except Exception as e:
        logger.warning("Admin (service) reprocess check failed for %s: %s", song_id, e)
        warnings.append(f"reprocess_failed:{type(e).__name__}")
        await session.rollback()

    lyrics_enqueued = False
    try:
        lyrics_enqueued = await job_service.trigger_lyrics_transcription_if_missing(
            song_id
        )
    except Exception as e:
        logger.warning("Admin (service) lyrics check failed for %s: %s", song_id, e)
        warnings.append(f"lyrics_failed:{type(e).__name__}")
        await session.rollback()

    return AdminSongResponse(
        song_id=song_id,
        audio_thumbnail_fixed=audio_thumb_fixed,
        reprocess_triggered=reprocess_job_id is not None,
        lyrics_enqueued=lyrics_enqueued,
        job_id=reprocess_job_id,
        warnings=warnings,
    )


@router.post("/songs/{song_id}/download-complete")
async def admin_download_complete(
    song_id: uuid.UUID,
    _: None = Depends(require_admin_token),
    session: AsyncSession = Depends(get_db),
    processing: ProcessingService = Depends(get_processing_service),
    job_service: JobService = Depends(get_job_service),
    storage: StorageBackend = Depends(get_storage),
) -> dict:
    """Called by homeserver after uploading audio to S3. Triggers processing."""
    dao = SongDAO(session)
    song = await dao.get_by_id(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if not song.audio_key or not storage.file_exists(song.audio_key):
        raise HTTPException(status_code=404, detail="Audio file not found on S3")

    # Clear pending download flag
    song.download_requested_at = None
    await session.flush()

    # Auto-trigger processing (stem separation, chords, lyrics)
    job = await job_service.create_and_process_job(
        user_sub=_SERVICE_USER_SUB,
        user_email=_SERVICE_USER_EMAIL,
        song_id=song_id,
        descriptions=["vocals", "guitar", "guitar_removed"],
        processing=processing,
    )
    logger.info(
        "Homeserver download complete for song %s — triggered job %s",
        song_id,
        job.id,
    )
    return {"ok": True, "job_id": str(job.id)}


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def admin_get_job(
    job_id: uuid.UUID,
    _: None = Depends(require_admin_token),
    job_service: JobService = Depends(get_job_service),
) -> JobResponse:
    """Get job status by ID (admin-authed, used by the admin runner to poll)."""
    return await job_service.get_job(job_id)


@router.post("/seed/populate")
async def populate_seed_songs(
    _: None = Depends(require_admin_token),
    dry_run: bool = False,
    storage: StorageBackend = Depends(get_storage),
) -> StreamingResponse:
    """Populate the predefined seed song catalog into the DB.

    This endpoint is idempotent:
    - DB songs are created if missing (by song_name)
    - metadata enrichment runs only when fields are missing
    - storage keys (audio, thumbnail, stems, etc.) are discovered from existing files

    Pass ``?dry_run=true`` to report what would change without writing.

    Streams NDJSON progress lines, with the final line being the result.
    """
    prefix = "[DRY RUN] " if dry_run else ""

    async def _generate():  # noqa: ANN202
        # StreamingResponse runs after dependency cleanup, so we manage
        # our own session to ensure writes are committed.
        async with safe_session() as session:
            try:
                logger.info(
                    "POST /admin/seed/populate — starting seed (dry_run=%s)", dry_run
                )
                yield json.dumps({"progress": f"{prefix}starting seed"}) + "\n"

                # Use a dedicated service user for attribution.
                user = await UserDAO(session).get_or_create(
                    _SERVICE_USER_SUB,
                    _SERVICE_USER_EMAIL,
                )

                # Step 1: create catalog entries (async generator yields progress + final int).
                yield (
                    json.dumps(
                        {"progress": f"{prefix}step 1/3 — creating catalog entries"}
                    )
                    + "\n"
                )
                songs_created = 0
                async for item in seed_db_catalog(session, user, dry_run=dry_run):
                    if isinstance(item, int):
                        songs_created = item
                    else:
                        yield json.dumps({"progress": item}) + "\n"

                # Step 2: update metadata & favorites.
                yield (
                    json.dumps(
                        {
                            "progress": f"{prefix}step 2/3 — updating metadata & favorites"
                        }
                    )
                    + "\n"
                )
                metadata_updated = 0
                async for item in seed_update_metadata(session, user, dry_run=dry_run):
                    if isinstance(item, int):
                        metadata_updated = item
                    else:
                        yield json.dumps({"progress": item}) + "\n"

                # Step 3: discover storage keys from existing files.
                yield (
                    json.dumps(
                        {"progress": f"{prefix}step 3/3 — discovering storage keys"}
                    )
                    + "\n"
                )
                storage_keys_updated = 0
                async for item in seed_discover_storage_keys(
                    session, storage, dry_run=dry_run
                ):
                    if isinstance(item, int):
                        storage_keys_updated = item
                    else:
                        yield json.dumps({"progress": item}) + "\n"

                if not dry_run:
                    await session.commit()

                result = AdminSeedPopulateResponse(
                    songs_created=songs_created,
                    metadata_updated=metadata_updated,
                    storage_keys_updated=storage_keys_updated,
                )
                logger.info(
                    "%sseed/populate: complete — %d created, %d metadata updated, %d storage keys updated",
                    prefix,
                    songs_created,
                    metadata_updated,
                    storage_keys_updated,
                )
                yield json.dumps({"result": result.model_dump()}) + "\n"
            except Exception:
                await session.rollback()
                raise

    return StreamingResponse(_generate(), media_type="application/x-ndjson")


# ---------------------------------------------------------------------------
# Drop songs
# ---------------------------------------------------------------------------


def _collect_storage_prefixes(song: Song) -> list[str]:
    """Return unique storage prefixes (song_name dirs) for a song."""
    if song.song_name:
        return [song.song_name]
    return []


@router.delete("/songs/{song_id}", response_model=AdminDropSongsResponse)
async def admin_drop_song(
    song_id: uuid.UUID,
    skip_storage: bool = Query(
        False, description="Skip storage file deletion (DB only)."
    ),
    _: None = Depends(require_admin_token),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> AdminDropSongsResponse:
    """Delete a single song and optionally its storage files."""
    dao = SongDAO(session)
    song = await dao.get_by_id(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    storage_errors: list[str] = []
    if not skip_storage:
        for prefix in _collect_storage_prefixes(song):
            try:
                deleted = storage.delete_prefix(prefix)
                logger.info("Deleted %d storage files under %s", deleted, prefix)
            except Exception as e:
                logger.warning("Storage cleanup failed for %s: %s", prefix, e)
                storage_errors.append(f"{prefix}: {e}")

    await dao.delete(song)
    logger.info(
        "Dropped song %s (%s) (skip_storage=%s)", song_id, song.song_name, skip_storage
    )

    return AdminDropSongsResponse(songs_deleted=1, storage_errors=storage_errors)


@router.delete("/songs", response_model=AdminDropSongsResponse)
async def admin_drop_all_songs(
    confirm: str = Query(..., description="Must be 'yes-delete-all' to proceed."),
    skip_storage: bool = Query(
        False, description="Skip storage file deletion (DB only)."
    ),
    _: None = Depends(require_admin_token),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> AdminDropSongsResponse:
    """Delete ALL songs and optionally their storage files. Requires confirm=yes-delete-all."""
    if confirm != "yes-delete-all":
        raise HTTPException(
            status_code=400,
            detail="confirm must be 'yes-delete-all'",
        )

    dao = SongDAO(session)
    songs = await dao.list_all(offset=0, limit=100_000)

    storage_errors: list[str] = []
    if not skip_storage:
        for song in songs:
            for prefix in _collect_storage_prefixes(song):
                try:
                    storage.delete_prefix(prefix)
                except Exception as e:
                    logger.warning("Storage cleanup failed for %s: %s", prefix, e)
                    storage_errors.append(f"{prefix}: {e}")

    for song in songs:
        await dao.delete(song)

    count = len(songs)
    logger.info("Dropped all %d songs (skip_storage=%s)", count, skip_storage)

    return AdminDropSongsResponse(songs_deleted=count, storage_errors=storage_errors)


# ---------------------------------------------------------------------------
# Sanity check
# ---------------------------------------------------------------------------

_HEALTH_TIMEOUT = 5.0


async def _run_check(
    name: str,
    coro_fn: Callable[[], Coroutine[Any, Any, None]],
    *,
    skip_if: str | None = None,
) -> SanityCheckResult:
    """Execute a single sanity check, capturing timing and errors."""
    if skip_if:
        return SanityCheckResult(
            name=name, status=SanityCheckStatus.SKIPPED, error=skip_if
        )
    t0 = time.monotonic()
    try:
        await coro_fn()
        elapsed = (time.monotonic() - t0) * 1000
        return SanityCheckResult(
            name=name, status=SanityCheckStatus.PASSED, duration_ms=round(elapsed, 1)
        )
    except Exception as exc:
        elapsed = (time.monotonic() - t0) * 1000
        return SanityCheckResult(
            name=name,
            status=SanityCheckStatus.FAILED,
            duration_ms=round(elapsed, 1),
            error=f"{type(exc).__name__}: {exc}",
        )


@router.post("/sanity", response_model=SanityResponse)
async def admin_sanity_check(
    body: SanityRequest = Body(default=SanityRequest()),
    _: None = Depends(require_admin_token),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
    processing: ProcessingService = Depends(get_processing_service),
    settings: Settings = Depends(get_settings),
) -> SanityResponse:
    """Run a full pipeline sanity check and return per-step results."""
    checks: list[SanityCheckResult] = []
    t_start = time.monotonic()

    db_ok = False
    storage_ok = False
    song: Song | None = None
    audio_path: str | None = None
    vocals_path: str | None = None
    guitar_path: str | None = None

    # 1. DB connectivity ---------------------------------------------------
    async def _check_db() -> None:
        nonlocal db_ok
        await session.execute(text("SELECT 1"))
        db_ok = True

    checks.append(await _run_check("db_connectivity", _check_db))

    # 2. Storage connectivity ----------------------------------------------
    async def _check_storage() -> None:
        nonlocal storage_ok
        storage.file_exists("__sanity_probe__")
        storage_ok = True

    checks.append(await _run_check("storage_connectivity", _check_storage))

    # 3-6. Service health checks -------------------------------------------
    health_targets = {
        "health_demucs": f"http://{settings.services.inference_demucs}/health",
        "health_chords": f"http://{settings.services.chords_generator}/health",
        "health_lyrics": f"http://{settings.services.lyrics_generator}/health",
    }
    health_ok: dict[str, bool] = {}

    for svc_name, url in health_targets.items():

        async def _check_health(_url: str = url) -> None:
            async with httpx.AsyncClient(timeout=_HEALTH_TIMEOUT) as client:
                resp = await client.get(_url)
                resp.raise_for_status()

        result = await _run_check(svc_name, _check_health)
        health_ok[svc_name] = result.status == SanityCheckStatus.PASSED
        checks.append(result)

    # 7. Song lookup -------------------------------------------------------
    async def _check_song_lookup() -> None:
        nonlocal song
        if body.song_id:
            song = await session.get(Song, body.song_id)
            if not song:
                raise ValueError(f"Song {body.song_id} not found")
            if not song.audio_key:
                raise ValueError(f"Song {body.song_id} has no audio_key")
        else:
            stmt = (
                select(Song)
                .where(Song.audio_key.isnot(None))
                .order_by(Song.created_at.asc())
                .limit(1)
            )
            row = await session.execute(stmt)
            song = row.scalar_one_or_none()
            if not song:
                raise ValueError("No song with audio_key found in DB")

    checks.append(
        await _run_check(
            "song_lookup",
            _check_song_lookup,
            skip_if="Skipped: db_connectivity failed" if not db_ok else None,
        )
    )
    song_ok = song is not None

    # 8. Audio exists in storage -------------------------------------------
    async def _check_audio_exists() -> None:
        nonlocal audio_path
        assert song is not None
        if not storage.file_exists(song.audio_key):
            raise FileNotFoundError(
                f"audio_key '{song.audio_key}' not found in storage"
            )
        audio_path = storage.get_url(song.audio_key)

    skip_audio = None
    if not storage_ok:
        skip_audio = "Skipped: storage_connectivity failed"
    elif not song_ok:
        skip_audio = "Skipped: song_lookup failed"
    checks.append(
        await _run_check("audio_exists", _check_audio_exists, skip_if=skip_audio)
    )
    audio_ok = audio_path is not None

    # 9. Stem separation ---------------------------------------------------
    async def _check_stem_separation() -> None:
        nonlocal vocals_path, guitar_path
        assert audio_path is not None
        result = await processing.separate_stems(audio_path)
        for stem in result.stems:
            if stem.name == "vocals":
                vocals_path = stem.path
            elif stem.name == "guitar":
                guitar_path = stem.path

    skip_stems = None
    if not health_ok.get("health_demucs"):
        skip_stems = "Skipped: health_demucs failed"
    elif not audio_ok:
        skip_stems = "Skipped: audio_exists failed"
    checks.append(
        await _run_check("stem_separation", _check_stem_separation, skip_if=skip_stems)
    )

    # Fallback: use existing stems on disk if separation was skipped/failed
    if (
        vocals_path is None
        and song
        and song.vocals_key
        and storage.file_exists(song.vocals_key)
    ):
        vocals_path = storage.get_url(song.vocals_key)
    if (
        guitar_path is None
        and song
        and song.guitar_key
        and storage.file_exists(song.guitar_key)
    ):
        guitar_path = storage.get_url(song.guitar_key)

    # Also try the conventional stem keys if separation produced files
    if vocals_path is None and song:
        key = f"{song.song_name}/vocals.mp3"
        if storage.file_exists(key):
            vocals_path = storage.get_url(key)
    if guitar_path is None and song:
        key = f"{song.song_name}/guitar.mp3"
        if storage.file_exists(key):
            guitar_path = storage.get_url(key)

    # 10. Chord recognition ------------------------------------------------
    async def _check_chords() -> None:
        assert audio_path is not None
        await processing.recognize_chords(audio_path)

    skip_chords = None
    if not health_ok.get("health_chords"):
        skip_chords = "Skipped: health_chords failed"
    elif not audio_ok:
        skip_chords = "Skipped: audio_exists failed"
    checks.append(
        await _run_check("chord_recognition", _check_chords, skip_if=skip_chords)
    )

    # 11. Lyrics transcription ---------------------------------------------
    async def _check_lyrics() -> None:
        assert vocals_path is not None
        await processing.transcribe_lyrics(
            vocals_path,
            title=song.title if song else None,
            artist=song.artist if song else None,
        )

    skip_lyrics = None
    if not health_ok.get("health_lyrics"):
        skip_lyrics = "Skipped: health_lyrics failed"
    elif vocals_path is None:
        skip_lyrics = "Skipped: no vocals stem available"
    checks.append(
        await _run_check("lyrics_transcription", _check_lyrics, skip_if=skip_lyrics)
    )

    # Aggregate ------------------------------------------------------------
    total_ms = round((time.monotonic() - t_start) * 1000, 1)
    any_failed = any(c.status == SanityCheckStatus.FAILED for c in checks)
    overall = SanityCheckStatus.FAILED if any_failed else SanityCheckStatus.PASSED

    return SanityResponse(
        overall=overall,
        song_id=song.id if song else None,
        song_name=song.song_name if song else None,
        checks=checks,
        total_duration_ms=total_ms,
    )
