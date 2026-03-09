"""Song endpoints."""

import logging
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.schemas import CurrentUser
from guitar_player.auth.subscription_guard import require_active_subscription
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
)
from guitar_player.services.job_service import JobService
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
    "guitar_removed": "guitar_removed_key",
    "vocals_guitar": "vocals_guitar_key",
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
    "guitar_removed",
    "vocals_guitar",
}


@router.post("/search", response_model=EnrichedSearchResponse)
async def search_songs(
    body: SearchRequest,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> EnrichedSearchResponse:
    results = await song_service.search_youtube_enriched(body.query)
    return EnrichedSearchResponse(results=results)


@router.post("/select", response_model=SongDetailResponse)
async def select_song(
    body: SelectSongRequest,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> SongDetailResponse:
    return await song_service.select_song(
        song_name=body.song_name,
        youtube_id=body.youtube_id,
        user_sub=user.sub,
        user_email=user.email,
    )


@router.post("/download", response_model=SongResponse)
async def download_song(
    body: DownloadRequest,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> SongResponse:
    return await song_service.download_song(body.youtube_id, user.sub, user.email)


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
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> Response:
    await song_service.record_play(song_id)
    return Response(status_code=204)


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

    # Tabs generation disabled — skip trigger.
    # try:
    #     tabs_triggered = await job_service.trigger_tabs_generation_if_missing(song_id)
    #     _ = tabs_triggered
    # except Exception as e:
    #     logger.warning("Admin tabs check failed for %s: %s", song_id, e)

    # If vocals+guitar merge is missing (but both source stems exist),
    # kick off a lightweight merge without requiring a full reprocess.
    try:
        await job_service.trigger_vocals_guitar_merge_if_missing(song_id)
    except Exception as e:
        logger.warning("Admin vocals+guitar merge check failed for %s: %s", song_id, e)

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
