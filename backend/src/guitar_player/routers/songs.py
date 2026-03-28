"""Song endpoints."""

import logging
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.admin import require_admin_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.auth.subscription_guard import require_active_subscription
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.dependencies import (
    get_db,
    get_job_service,
    get_processing_service,
    get_song_service,
    get_storage,
    get_telegram_service,
)
from guitar_player.schemas.job import ActiveJobInfo
from guitar_player.schemas.song import (
    DownloadRequest,
    EnrichedSearchResponse,
    FeedbackRating,
    GenreListResponse,
    PaginatedSongsResponse,
    SearchRequest,
    SelectSongRequest,
    SongDetailResponse,
    SongFeedbackRequest,
    SongResponse,
    SongSection,
)
from guitar_player.services.job_service import JobService
from guitar_player.services.analytics_helpers import (
    analytics_identity_from_user,
    track_event,
)
from guitar_player.services.processing_service import ProcessingService
from guitar_player.services.song_service import SongService
from guitar_player.services.telegram_service import TelegramService
from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/songs", tags=["songs"])

_STEM_KEY_MAP: dict[str, str] = {
    "audio": "audio_key",
    "thumbnail": "thumbnail_key",
    "vocals": "vocals_key",
    "guitar": "guitar_key",
}

_STEM_MEDIA_TYPE: dict[str, str] = {
    "thumbnail": "image/jpeg",
}
_DEFAULT_MEDIA_TYPE = "audio/mpeg"

_EXT_MEDIA_TYPE: dict[str, str] = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
}


def _media_type_for(stem: str, file_path: Path) -> str:
    """Return the correct MIME type based on stem type or file extension."""
    explicit = _STEM_MEDIA_TYPE.get(stem)
    if explicit:
        return explicit
    return _EXT_MEDIA_TYPE.get(file_path.suffix.lower(), _DEFAULT_MEDIA_TYPE)


# Stems eligible for admin reprocessing (not audio or thumbnail)
_REPROCESSABLE_STEMS = {
    "vocals",
    "guitar",
}


@router.post("/search", response_model=EnrichedSearchResponse)
async def search_songs(
    body: SearchRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> EnrichedSearchResponse:
    results = await song_service.search_youtube_enriched(body.query)
    identity = analytics_identity_from_user(user)
    track_event(
        background_tasks,
        event_type="search",
        event_category="songs",
        **identity,
        properties={
            "query": body.query[:200],
            "query_length": len(body.query),
            "result_count": len(results),
        },
    )
    return EnrichedSearchResponse(results=results)


@router.post("/select", response_model=SongDetailResponse)
async def select_song(
    body: SelectSongRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> SongDetailResponse:
    detail = await song_service.select_song(
        song_name=body.song_name,
        youtube_id=body.youtube_id,
        user_sub=user.sub,
        user_email=user.email,
    )
    track_event(
        background_tasks,
        event_type="song_selected",
        event_category="songs",
        **analytics_identity_from_user(user),
        song_id=detail.song.id,
        song_title=detail.song.title,
        properties={"youtube_id": body.youtube_id},
    )
    return detail


@router.post("/download", response_model=SongResponse)
async def download_song(
    body: DownloadRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> SongResponse:
    song = await song_service.download_song(body.youtube_id, user.sub, user.email)
    track_event(
        background_tasks,
        event_type="song_download_requested",
        event_category="songs",
        **analytics_identity_from_user(user),
        song_id=song.id,
        song_title=song.title,
        properties={"youtube_id": body.youtube_id},
    )
    return song


@router.get("", response_model=PaginatedSongsResponse)
async def list_songs(
    query: Optional[str] = Query(None),
    genre: Optional[str] = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> PaginatedSongsResponse:
    return await song_service.list_songs(query, genre, offset, limit)


# --- Static path endpoints BEFORE /{song_id} to avoid FastAPI treating them as UUIDs ---


@router.get("/top", response_model=PaginatedSongsResponse)
async def top_songs(
    genre: Optional[str] = Query(None),
    sort: str = Query("favorites", pattern="^(favorites|plays|recent)$"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> PaginatedSongsResponse:
    return await song_service.list_top_songs(genre, sort, offset, limit)


@router.get("/recent", response_model=PaginatedSongsResponse)
async def recent_songs(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> PaginatedSongsResponse:
    return await song_service.list_recent_songs(offset, limit)


@router.get("/genres", response_model=GenreListResponse)
async def list_genres(
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> GenreListResponse:
    genres = await song_service.list_genres()
    return GenreListResponse(genres=genres)


@router.post("/{song_id}/play", status_code=204)
async def record_play(
    song_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> Response:
    song = await song_service.get_song(song_id)
    await song_service.record_play(song_id)
    track_event(
        background_tasks,
        event_type="song_played",
        event_category="player",
        **analytics_identity_from_user(user),
        song_id=song_id,
        song_title=song.title,
    )
    return Response(status_code=204)


@router.post("/{song_id}/strum-patterns/ai", response_model=list[SongSection])
async def generate_ai_strum_patterns(
    song_id: uuid.UUID,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> list[SongSection]:
    """Generate AI strum patterns on-demand for a song."""
    return await song_service.generate_ai_strum_patterns(song_id)


@router.post("/{song_id}/feedback", status_code=204)
async def submit_feedback(
    song_id: uuid.UUID,
    body: SongFeedbackRequest,
    user: CurrentUser = Depends(require_active_subscription),
    session: AsyncSession = Depends(get_db),
    song_service: SongService = Depends(get_song_service),
    telegram: TelegramService = Depends(get_telegram_service),
) -> Response:
    """Submit thumbs-up/down feedback for a song. Fire-and-forget to Telegram."""
    email = user.email
    if not email:
        db_user = await UserDAO(session).get_by_cognito_sub(user.sub)
        if db_user:
            email = db_user.email
    song = await song_service.get_song(song_id)
    emoji = "\U0001f44d" if body.rating == FeedbackRating.thumbs_up else "\U0001f44e"
    title = song.title or song.song_name
    artist = song.artist or "Unknown"
    lines = [
        f"{emoji} <b>Song Feedback</b>",
        f"\U0001f3b5 <b>{title}</b> by {artist}",
        f"\U0001f464 {email or user.username or 'anonymous'}",
    ]
    if body.comment:
        lines.append(f"\U0001f4ac {body.comment}")
    await telegram.send_feedback("\n".join(lines))
    return Response(status_code=204)


# --- Dynamic /{song_id} endpoints ---


@router.get("/{song_id}/stream")
async def stream_song_file(
    song_id: uuid.UUID,
    stem: str = Query(
        ...,
        description="File type: audio, thumbnail, vocals, guitar, guitar_removed, vocals_guitar",
    ),
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
    job_service: JobService = Depends(get_job_service),
    processing: ProcessingService = Depends(get_processing_service),
    storage: StorageBackend = Depends(get_storage),
) -> FileResponse:
    """Stream a song file (audio, thumbnail, or stem) for local development."""
    col_name = _STEM_KEY_MAP.get(stem)
    if not col_name:
        raise HTTPException(status_code=400, detail=f"Unknown stem: {stem}")

    storage_key = await song_service.get_file_key(song_id, col_name)

    file_missing = not storage_key or not Path(storage.get_url(storage_key)).is_file()

    if file_missing and stem in _REPROCESSABLE_STEMS:
        if storage_key:
            await song_service.clear_file_key(song_id, col_name)
        triggered = await job_service.trigger_reprocess(
            user_sub=user.sub,
            user_email=user.email,
            song_id=song_id,
            processing=processing,
        )

        if not triggered:
            # Keys were fixed from existing files on disk — retry serving
            storage_key = await song_service.get_file_key(song_id, col_name)
            if storage_key and Path(storage.get_url(storage_key)).is_file():
                file_path = Path(storage.get_url(storage_key))
                return FileResponse(
                    file_path, media_type=_media_type_for(stem, file_path)
                )

            # Still missing — a reprocess job is already running
            raise HTTPException(
                status_code=404, detail=f"No {stem} file — reprocessing in progress"
            )

        raise HTTPException(
            status_code=404, detail=f"No {stem} file — reprocessing triggered"
        )

    if file_missing:
        raise HTTPException(status_code=404, detail=f"No {stem} file for this song")

    file_path = Path(storage.get_url(storage_key))
    return FileResponse(file_path, media_type=_media_type_for(stem, file_path))


@router.get("/{song_id}", response_model=SongDetailResponse)
async def get_song_detail(
    song_id: uuid.UUID,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
    job_service: JobService = Depends(get_job_service),
    processing: ProcessingService = Depends(get_processing_service),
) -> SongDetailResponse:
    # Best-effort admin healing on access.
    # 1) Ensure original audio/thumbnail exists (or fix keys / re-download if possible)
    # 2) Ensure stems/chords/lyrics are present; if missing, enqueue a background job
    try:
        await song_service.admin_heal_audio_and_thumbnail(song_id, user.sub, user.email)
    except Exception as e:
        logger.warning("Admin audio/thumbnail failed for %s: %s", song_id, e)

    try:
        await job_service.trigger_reprocess(
            user_sub=user.sub,
            user_email=user.email,
            song_id=song_id,
            processing=processing,
        )
    except Exception as e:
        logger.warning("Admin reprocess check failed for %s: %s", song_id, e)

    # If only lyrics are missing (but vocals exist), kick off a lightweight
    # lyrics transcription without requiring a full demucs+chords run.
    try:
        lyrics_triggered = await job_service.trigger_lyrics_transcription_if_missing(
            song_id
        )
        _ = lyrics_triggered
    except Exception as e:
        logger.warning("Admin lyrics check failed for %s: %s", song_id, e)

    try:
        tabs_triggered = await job_service.trigger_tabs_generation_if_missing(song_id)
        _ = tabs_triggered
    except Exception as e:
        logger.warning("Admin tabs check failed for %s: %s", song_id, e)

    try:
        await job_service.trigger_external_strums_if_missing(song_id)
    except Exception as e:
        logger.warning("External strums check failed for %s: %s", song_id, e)

    try:
        await job_service.trigger_web_chords_if_missing(song_id)
    except Exception as e:
        logger.warning("Web chords check failed for %s: %s", song_id, e)

    # Clear download_requested_at as soon as the audio file lands in S3,
    # so this response already returns download_pending=false.
    try:
        await song_service.clear_download_if_audio_ready(song_id)
    except Exception as e:
        logger.warning("clear_download check failed for %s: %s", song_id, e)

    detail = await song_service.get_song_detail(song_id)

    # Attach active job info so the frontend can resume polling without
    # creating a duplicate job on refresh/navigation.
    try:
        active = await job_service.get_active_job_for_song(song_id)
        if active:
            detail.active_job = ActiveJobInfo(
                id=active.id,
                status=active.status,
                progress=active.progress or 0,
                stage=active.stage,
            )
    except Exception as e:
        logger.warning("Failed to fetch active job for %s: %s", song_id, e)

    return detail


class RegenerateRequest(BaseModel):
    targets: list[str]


class RegenerateResponse(BaseModel):
    enqueued: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []


def _safe_delete(storage: StorageBackend, key: str | None) -> None:
    """Delete a file from storage if it exists, silently ignoring errors."""
    if not key:
        return
    try:
        if storage.file_exists(key):
            storage.delete_file(key)
    except Exception:
        pass


@router.post("/{song_id}/regenerate", response_model=RegenerateResponse)
async def regenerate_song_components(
    song_id: uuid.UUID,
    body: RegenerateRequest,
    admin: CurrentUser = Depends(require_admin_user),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
    job_service: JobService = Depends(get_job_service),
    processing: ProcessingService = Depends(get_processing_service),
) -> RegenerateResponse:
    """Admin-only: force-regenerate selected song components.

    Targets: lyrics, stems, tabs, strums, full.
    "full" wipes all derived data and re-runs the entire processing pipeline.
    """
    valid_targets = {"lyrics", "stems", "tabs", "strums", "full"}
    targets = [t for t in body.targets if t in valid_targets]
    if not targets:
        raise HTTPException(status_code=400, detail=f"No valid targets. Choose from: {sorted(valid_targets)}")

    dao = SongDAO(session)
    song = await dao.get_by_id(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    song_name = song.song_name
    enqueued: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    # "full" = nuke all derived data and re-run the complete pipeline
    if "full" in targets:
        try:
            # Delete all derived files (stems, chords, lyrics, tabs, strums)
            for stem in ("vocals", "guitar", "guitar_removed", "vocals_guitar", "drums", "bass", "piano", "other"):
                _safe_delete(storage, getattr(song, f"{stem}_key", None))
                if song_name:
                    _safe_delete(storage, f"{song_name}/{stem}.mp3")
            _safe_delete(storage, song.chords_key)
            _safe_delete(storage, song.lyrics_key)
            _safe_delete(storage, song.tabs_key)
            _safe_delete(storage, song.external_strums_key)
            if song_name:
                for fname in ("chords.json", "lyrics.json", "tabs.json", "external_strums.json"):
                    _safe_delete(storage, f"{song_name}/{fname}")

            # Clear all DB keys and failure flags
            await dao.update_by_id(
                song_id,
                vocals_key=None, guitar_key=None, guitar_removed_key=None,
                vocals_guitar_key=None, chords_key=None,
                drums_key=None, bass_key=None, piano_key=None, other_key=None,
                lyrics_key=None, lyrics_failed=False, lyrics_attempted_at=None,
                tabs_key=None, tabs_failed=False, tabs_attempted_at=None,
                external_strums_key=None, external_strums_failed=False, external_strums_attempted_at=None,
                processing_job_id=None,
            )

            # Trigger full processing pipeline
            job_resp = await job_service.create_and_process_job(
                user_sub=admin.sub,
                user_email=admin.email,
                song_id=song_id,
                descriptions=["admin-full-regenerate"],
                processing=processing,
            )
            enqueued.append("full")
            logger.info(
                "Admin full regenerate song_id=%s user=%s job_id=%s",
                song_id, admin.email, job_resp.id,
            )
        except Exception as e:
            logger.warning("Admin full regenerate failed for %s: %s", song_id, e)
            errors.append(f"full: {e}")

        return RegenerateResponse(enqueued=enqueued, skipped=skipped, errors=errors)

    if "lyrics" in targets:
        try:
            # Delete existing lyrics files so trigger doesn't skip
            _safe_delete(storage, song.lyrics_key)
            if song_name:
                _safe_delete(storage, f"{song_name}/lyrics.json")
            await dao.update_by_id(song_id, lyrics_key=None, lyrics_failed=False, lyrics_attempted_at=None)
            triggered = await job_service.trigger_lyrics_transcription_if_missing(song_id)
            (enqueued if triggered else skipped).append("lyrics")
        except Exception as e:
            logger.warning("Admin regenerate lyrics failed for %s: %s", song_id, e)
            errors.append(f"lyrics: {e}")

    if "stems" in targets:
        try:
            # Delete existing stem/chord files so trigger_reprocess re-runs
            for stem in ("vocals", "guitar", "guitar_removed", "vocals_guitar", "drums", "bass", "piano", "other"):
                _safe_delete(storage, getattr(song, f"{stem}_key", None))
                if song_name:
                    _safe_delete(storage, f"{song_name}/{stem}.mp3")
            _safe_delete(storage, song.chords_key)
            if song_name:
                _safe_delete(storage, f"{song_name}/chords.json")
            await dao.update_by_id(
                song_id,
                vocals_key=None, guitar_key=None, guitar_removed_key=None,
                vocals_guitar_key=None, chords_key=None,
                drums_key=None, bass_key=None, piano_key=None, other_key=None,
            )
            job_id = await job_service.trigger_reprocess(
                user_sub=admin.sub,
                user_email=admin.email,
                song_id=song_id,
                processing=processing,
            )
            (enqueued if job_id else skipped).append("stems")
        except Exception as e:
            logger.warning("Admin regenerate stems failed for %s: %s", song_id, e)
            errors.append(f"stems: {e}")

    if "tabs" in targets:
        try:
            _safe_delete(storage, song.tabs_key)
            if song_name:
                _safe_delete(storage, f"{song_name}/tabs.json")
            await dao.update_by_id(song_id, tabs_key=None, tabs_failed=False, tabs_attempted_at=None)
            triggered = await job_service.trigger_tabs_generation_if_missing(song_id, force=True)
            (enqueued if triggered else skipped).append("tabs")
        except Exception as e:
            logger.warning("Admin regenerate tabs failed for %s: %s", song_id, e)
            errors.append(f"tabs: {e}")

    if "strums" in targets:
        try:
            _safe_delete(storage, song.external_strums_key)
            if song_name:
                _safe_delete(storage, f"{song_name}/external_strums.json")
            await dao.update_by_id(
                song_id,
                external_strums_key=None,
                external_strums_failed=False,
                external_strums_attempted_at=None,
            )
            triggered = await job_service.trigger_external_strums_if_missing(song_id, force=True)
            (enqueued if triggered else skipped).append("strums")
        except Exception as e:
            logger.warning("Admin regenerate strums failed for %s: %s", song_id, e)
            errors.append(f"strums: {e}")

    logger.info(
        "Admin regenerate song_id=%s user=%s enqueued=%s skipped=%s errors=%s",
        song_id, admin.email, enqueued, skipped, errors,
    )
    return RegenerateResponse(enqueued=enqueued, skipped=skipped, errors=errors)
