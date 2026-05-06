"""Song endpoints."""

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.auth.admin import require_admin_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.auth.subscription_guard import require_active_subscription
from guitar_player.database import safe_session
from guitar_player.dependencies import (
    get_artwork_service,
    get_db,
    get_job_service,
    get_llm_service,
    get_processing_service,
    get_recommendation_service,
    get_song_service,
    get_storage,
    get_telegram_service,
    get_youtube_service,
)
from guitar_player.schemas.admin import AdminDropSongsResponse
from guitar_player.schemas.job import ActiveJobInfo
from guitar_player.schemas.song import (
    ChordVersionVoteRequest,
    ChordVersionVoteResponse,
    DownloadRequest,
    EnrichedSearchResponse,
    FeedbackRating,
    GenreListResponse,
    PaginatedSongsResponse,
    PlaybackSourceResponse,
    RecommendationsResponse,
    SaveUserChordsRequest,
    SaveUserChordsResponse,
    SearchRequest,
    SelectSongRequest,
    SongDetailResponse,
    SongFeedbackRequest,
    SongResponse,
    SongSection,
)
from guitar_player.services.recommendation_service import RecommendationService
from guitar_player.services.analytics_helpers import (
    analytics_identity_from_user,
    track_event,
)
from guitar_player.services.job_service import JobService
from guitar_player.services.artwork_service import ArtworkService
from guitar_player.services.llm_service import LlmService
from guitar_player.services.processing_service import ProcessingService
from guitar_player.services.song_service import SongService
from guitar_player.services.telegram_service import TelegramService
from guitar_player.services.youtube_service import YoutubeService
from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/songs", tags=["songs"])

_STEM_KEY_MAP: dict[str, str] = {
    "audio": "audio_key",
    "thumbnail": "thumbnail_key",
    "vocals": "vocals_key",
    "guitar": "guitar_key",
    "drums": "drums_key",
    "bass": "bass_key",
    "piano": "piano_key",
    "other": "other_key",
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


def _parse_playback_stems(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip() and part.strip() != "full_mix"]


async def _get_stream_storage_key(
    song_id: uuid.UUID,
    col_name: str,
    storage: StorageBackend,
    youtube: YoutubeService,
    llm: LlmService,
    artwork: ArtworkService,
) -> str | None:
    """Resolve a song storage key without keeping a request DB session open."""
    async with safe_session() as session:
        song_service = SongService(session, storage, youtube, llm, artwork)
        return await song_service.get_file_key(song_id, col_name)


async def _clear_stream_storage_key(
    song_id: uuid.UUID,
    col_name: str,
    storage: StorageBackend,
    youtube: YoutubeService,
    llm: LlmService,
    artwork: ArtworkService,
) -> None:
    """Clear a stale song storage key and commit immediately."""
    async with safe_session() as session:
        song_service = SongService(session, storage, youtube, llm, artwork)
        await song_service.clear_file_key(song_id, col_name)
        await session.commit()


async def _trigger_stream_reprocess(
    song_id: uuid.UUID,
    user: CurrentUser,
    processing: ProcessingService,
    storage: StorageBackend,
) -> uuid.UUID | None:
    """Trigger stem healing without tying DB sessions to the file response."""
    async with safe_session() as session:
        job_service = JobService(session, storage)
        job_id = await job_service.trigger_reprocess(
            user_sub=user.sub,
            user_email=user.email,
            song_id=song_id,
            processing=processing,
        )
        await session.commit()
        return job_id


# Stems eligible for admin reprocessing (not audio or thumbnail)
_REPROCESSABLE_STEMS = {
    "vocals",
    "guitar",
    "drums",
    "bass",
    "piano",
    "other",
    "guitar_removed",
    "vocals_guitar",
}

# All stem types used in regeneration
_ALL_STEM_NAMES = (
    "vocals", "guitar", "guitar_removed", "vocals_guitar",
    "drums", "bass", "piano", "other",
)


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
    query: str | None = Query(None),
    genre: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> PaginatedSongsResponse:
    return await song_service.list_songs(query, genre, offset, limit)


# --- Static path endpoints BEFORE /{song_id} to avoid FastAPI treating them as UUIDs ---


@router.get("/top", response_model=PaginatedSongsResponse)
async def top_songs(
    genre: str | None = Query(None),
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


@router.post("/{song_id}/play", status_code=status.HTTP_204_NO_CONTENT)
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
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{song_id}/strum-patterns/ai", response_model=list[SongSection])
async def generate_ai_strum_patterns(
    song_id: uuid.UUID,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> list[SongSection]:
    """Generate AI strum patterns on-demand for a song."""
    return await song_service.generate_ai_strum_patterns(song_id)


@router.post("/{song_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
async def submit_feedback(
    song_id: uuid.UUID,
    body: SongFeedbackRequest,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
    telegram: TelegramService = Depends(get_telegram_service),
) -> Response:
    """Submit thumbs-up/down feedback for a song. Fire-and-forget to Telegram."""
    email = await song_service.resolve_user_email(user.sub, user.email)
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
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{song_id}/chords", response_model=SaveUserChordsResponse)
async def save_user_chords(
    song_id: uuid.UUID,
    body: SaveUserChordsRequest,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> SaveUserChordsResponse:
    """Save user-edited chords as a new chord variant."""
    return await song_service.save_user_chords(song_id, body, user.email)


@router.delete("/{song_id}/chords", response_model=SongDetailResponse)
async def delete_user_chords(
    song_id: uuid.UUID,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> SongDetailResponse:
    """Delete the chord version created by the current user."""
    return await song_service.delete_user_chords(song_id, user.email)


@router.post("/{song_id}/chord-votes", response_model=ChordVersionVoteResponse)
async def vote_chord_version(
    song_id: uuid.UUID,
    body: ChordVersionVoteRequest,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> ChordVersionVoteResponse:
    """Submit or update a vote on a user-edited chord version."""
    return await song_service.vote_chord_version(
        song_id, body.version_key, user.sub, body.vote,
    )


# --- Dynamic /{song_id} endpoints ---


@router.get("/{song_id}/playback-source", response_model=PlaybackSourceResponse)
async def get_playback_source(
    song_id: uuid.UUID,
    stems: str | None = Query(
        None,
        description="Comma-separated stem names. Omit or use full_mix for the original audio.",
    ),
    _user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
) -> PlaybackSourceResponse:
    """Return a single playable source URL for the requested playback selection."""
    url = await song_service.resolve_playback_source(song_id, _parse_playback_stems(stems))
    return PlaybackSourceResponse(url=url)


@router.get("/{song_id}/stream")
async def stream_song_file(
    song_id: uuid.UUID,
    stem: str = Query(
        ...,
        description="File type: audio, thumbnail, vocals, guitar, guitar_removed, vocals_guitar",
    ),
    user: CurrentUser = Depends(require_active_subscription),
    processing: ProcessingService = Depends(get_processing_service),
    storage: StorageBackend = Depends(get_storage),
    youtube: YoutubeService = Depends(get_youtube_service),
    llm: LlmService = Depends(get_llm_service),
    artwork: ArtworkService = Depends(get_artwork_service),
) -> FileResponse:
    """Stream a song file (audio, thumbnail, or stem) for local development."""
    col_name = _STEM_KEY_MAP.get(stem)
    if not col_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown stem: {stem}",
        )

    storage_key = await _get_stream_storage_key(
        song_id, col_name, storage, youtube, llm, artwork,
    )
    file_missing = not storage_key or not storage.file_exists(storage_key)

    if file_missing and stem in _REPROCESSABLE_STEMS:
        return await _handle_missing_stem(
            song_id, stem, col_name, storage_key,
            processing, storage, user, youtube, llm, artwork,
        )

    if file_missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No {stem} file for this song",
        )

    file_path = Path(storage.resolve_service_path(storage_key))
    return FileResponse(file_path, media_type=_media_type_for(stem, file_path))


async def _handle_missing_stem(
    song_id: uuid.UUID,
    stem: str,
    col_name: str,
    storage_key: str | None,
    processing: ProcessingService,
    storage: StorageBackend,
    user: CurrentUser,
    youtube: YoutubeService,
    llm: LlmService,
    artwork: ArtworkService,
) -> FileResponse:
    """Handle a missing reprocessable stem: clear key, trigger reprocess, retry."""
    if storage_key:
        await _clear_stream_storage_key(
            song_id, col_name, storage, youtube, llm, artwork,
        )

    triggered = await _trigger_stream_reprocess(song_id, user, processing, storage)

    if not triggered:
        # Keys were fixed from existing files on disk -- retry serving
        storage_key = await _get_stream_storage_key(
            song_id, col_name, storage, youtube, llm, artwork,
        )
        if storage_key and storage.file_exists(storage_key):
            file_path = Path(storage.resolve_service_path(storage_key))
            return FileResponse(file_path, media_type=_media_type_for(stem, file_path))

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No {stem} file -- reprocessing in progress",
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"No {stem} file -- reprocessing triggered",
    )


@router.get("/{song_id}/recommendations", response_model=RecommendationsResponse)
async def get_recommendations(
    song_id: uuid.UUID,
    limit: int = Query(10, ge=1, le=30),
    user: CurrentUser = Depends(require_active_subscription),
    recommendation_service: RecommendationService = Depends(get_recommendation_service),
) -> RecommendationsResponse:
    """Return similar song recommendations for the given song."""
    return await recommendation_service.get_recommendations(song_id, limit=limit)


@router.get("/{song_id}", response_model=SongDetailResponse)
async def get_song_detail(
    song_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_active_subscription),
    song_service: SongService = Depends(get_song_service),
    job_service: JobService = Depends(get_job_service),
    processing: ProcessingService = Depends(get_processing_service),
) -> SongDetailResponse:
    """Get full song detail, with best-effort background healing."""
    background_tasks.add_task(
        _run_background_healing, song_id, user, song_service, job_service, processing
    )

    try:
        await song_service.clear_download_if_audio_ready(song_id)
    except Exception as e:
        logger.warning("clear_download check failed for %s: %s", song_id, e)

    detail = await song_service.get_song_detail(song_id)

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


async def _run_background_healing(
    song_id: uuid.UUID,
    user: CurrentUser,
    song_service: SongService,
    job_service: JobService,
    processing: ProcessingService,
) -> None:
    """Best-effort healing tasks that run on song detail access."""
    healing_tasks = [
        ("audio/thumbnail", lambda: song_service.admin_heal_audio_and_thumbnail(
            song_id, user.sub, user.email,
        )),
        ("reprocess", lambda: job_service.trigger_reprocess(
            user_sub=user.sub, user_email=user.email,
            song_id=song_id, processing=processing,
        )),
        ("lyrics", lambda: job_service.trigger_lyrics_transcription_if_missing(song_id)),
        ("tabs", lambda: job_service.trigger_tabs_generation_if_missing(song_id)),
        ("external strums", lambda: job_service.trigger_external_strums_if_missing(song_id)),
        ("web chords", lambda: job_service.trigger_web_chords_if_missing(song_id)),
        ("static chords", lambda: job_service.trigger_static_chords_if_missing(song_id)),
    ]
    for label, task_fn in healing_tasks:
        try:
            await task_fn()
        except Exception as e:
            logger.warning("Admin %s check failed for %s: %s", label, song_id, e)


class RegenerateRequest(BaseModel):
    targets: list[str]


class RegenerateResponse(BaseModel):
    enqueued: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []


@router.post("/{song_id}/regenerate", response_model=RegenerateResponse)
async def regenerate_song_components(
    song_id: uuid.UUID,
    body: RegenerateRequest,
    admin: CurrentUser = Depends(require_admin_user),
    song_service: SongService = Depends(get_song_service),
    storage: StorageBackend = Depends(get_storage),
    job_service: JobService = Depends(get_job_service),
    processing: ProcessingService = Depends(get_processing_service),
) -> RegenerateResponse:
    """Admin-only: force-regenerate selected song components."""
    valid_targets = {"lyrics", "stems", "tabs", "strums", "full"}
    targets = [t for t in body.targets if t in valid_targets]
    if not targets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No valid targets. Choose from: {sorted(valid_targets)}",
        )

    song = await song_service.get_song_record(song_id)
    enqueued: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    if "full" in targets:
        await _regenerate_full(
            song_id, song, admin, song_service, storage,
            job_service, processing, enqueued, errors,
        )
        return RegenerateResponse(enqueued=enqueued, skipped=skipped, errors=errors)

    _REGEN_HANDLERS = {
        "lyrics": _regenerate_lyrics,
        "stems": _regenerate_stems,
        "tabs": _regenerate_tabs,
        "strums": _regenerate_strums,
    }

    for target in targets:
        handler = _REGEN_HANDLERS.get(target)
        if handler:
            await handler(
                song_id, song, admin, song_service, storage,
                job_service, processing, enqueued, skipped, errors,
            )

    logger.info(
        "Admin regenerate song_id=%s user=%s enqueued=%s skipped=%s errors=%s",
        song_id, admin.email, enqueued, skipped, errors,
    )
    return RegenerateResponse(enqueued=enqueued, skipped=skipped, errors=errors)


@router.delete("/{song_id}", response_model=AdminDropSongsResponse)
async def delete_song(
    song_id: uuid.UUID,
    admin: CurrentUser = Depends(require_admin_user),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> AdminDropSongsResponse:
    """Admin-only: permanently delete a song, its DB records, and S3 files."""
    from guitar_player.services.admin_service import AdminService

    service = AdminService(session, storage)
    result = await service.drop_song(song_id)
    logger.info(
        "Admin deleted song_id=%s user=%s deleted=%d storage_errors=%s",
        song_id, admin.email, result.songs_deleted, result.storage_errors,
    )
    return result


def _delete_stem_files(
    song_service: SongService, storage: StorageBackend,
    song: object, song_name: str | None,
) -> None:
    """Delete all stem files from storage."""
    for stem in _ALL_STEM_NAMES:
        song_service.safe_delete_file(getattr(song, f"{stem}_key", None))
        if song_name:
            song_service.safe_delete_file(f"{song_name}/{stem}.mp3")


async def _regenerate_full(
    song_id: uuid.UUID, song: object,
    admin: CurrentUser, song_service: SongService,
    storage: StorageBackend, job_service: JobService,
    processing: ProcessingService,
    enqueued: list[str], errors: list[str],
) -> None:
    """Nuke all derived data and re-run the complete pipeline."""
    song_name = song.song_name
    try:
        _delete_stem_files(song_service, storage, song, song_name)
        song_service.safe_delete_file(song.chords_key)
        song_service.safe_delete_file(song.lyrics_key)
        song_service.safe_delete_file(song.tabs_key)
        song_service.safe_delete_file(song.external_strums_key)
        if song_name:
            for fname in ("chords.json", "lyrics.json", "tabs.json", "external_strums.json"):
                song_service.safe_delete_file(f"{song_name}/{fname}")

        await song_service.clear_song_keys(
            song_id,
            vocals_key=None, guitar_key=None, guitar_removed_key=None,
            vocals_guitar_key=None, chords_key=None,
            drums_key=None, bass_key=None, piano_key=None, other_key=None,
            lyrics_key=None, lyrics_failed=False, lyrics_attempted_at=None,
            tabs_key=None, tabs_failed=False, tabs_attempted_at=None,
            external_strums_key=None, external_strums_failed=False,
            external_strums_attempted_at=None, processing_job_id=None,
        )

        job_resp = await job_service.create_and_process_job(
            user_sub=admin.sub, user_email=admin.email,
            song_id=song_id, descriptions=["admin-full-regenerate"],
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


async def _regenerate_lyrics(
    song_id: uuid.UUID, song: object,
    admin: CurrentUser, song_service: SongService,
    storage: StorageBackend, job_service: JobService,
    processing: ProcessingService,
    enqueued: list[str], skipped: list[str], errors: list[str],
) -> None:
    try:
        song_service.safe_delete_file(song.lyrics_key)
        if song.song_name:
            song_service.safe_delete_file(f"{song.song_name}/lyrics.json")
        await song_service.clear_song_keys(
            song_id, lyrics_key=None, lyrics_failed=False, lyrics_attempted_at=None,
        )
        triggered = await job_service.trigger_lyrics_transcription_if_missing(song_id)
        (enqueued if triggered else skipped).append("lyrics")
    except Exception as e:
        logger.warning("Admin regenerate lyrics failed for %s: %s", song_id, e)
        errors.append(f"lyrics: {e}")


async def _regenerate_stems(
    song_id: uuid.UUID, song: object,
    admin: CurrentUser, song_service: SongService,
    storage: StorageBackend, job_service: JobService,
    processing: ProcessingService,
    enqueued: list[str], skipped: list[str], errors: list[str],
) -> None:
    try:
        _delete_stem_files(song_service, storage, song, song.song_name)
        song_service.safe_delete_file(song.chords_key)
        if song.song_name:
            song_service.safe_delete_file(f"{song.song_name}/chords.json")
        await song_service.clear_song_keys(
            song_id,
            vocals_key=None, guitar_key=None, guitar_removed_key=None,
            vocals_guitar_key=None, chords_key=None,
            drums_key=None, bass_key=None, piano_key=None, other_key=None,
        )
        job_id = await job_service.trigger_reprocess(
            user_sub=admin.sub, user_email=admin.email,
            song_id=song_id, processing=processing,
        )
        (enqueued if job_id else skipped).append("stems")
    except Exception as e:
        logger.warning("Admin regenerate stems failed for %s: %s", song_id, e)
        errors.append(f"stems: {e}")


async def _regenerate_tabs(
    song_id: uuid.UUID, song: object,
    admin: CurrentUser, song_service: SongService,
    storage: StorageBackend, job_service: JobService,
    processing: ProcessingService,
    enqueued: list[str], skipped: list[str], errors: list[str],
) -> None:
    try:
        song_service.safe_delete_file(song.tabs_key)
        if song.song_name:
            song_service.safe_delete_file(f"{song.song_name}/tabs.json")
        await song_service.clear_song_keys(
            song_id, tabs_key=None, tabs_failed=False, tabs_attempted_at=None,
        )
        triggered = await job_service.trigger_tabs_generation_if_missing(song_id, force=True)
        (enqueued if triggered else skipped).append("tabs")
    except Exception as e:
        logger.warning("Admin regenerate tabs failed for %s: %s", song_id, e)
        errors.append(f"tabs: {e}")


async def _regenerate_strums(
    song_id: uuid.UUID, song: object,
    admin: CurrentUser, song_service: SongService,
    storage: StorageBackend, job_service: JobService,
    processing: ProcessingService,
    enqueued: list[str], skipped: list[str], errors: list[str],
) -> None:
    try:
        song_service.safe_delete_file(song.external_strums_key)
        if song.song_name:
            song_service.safe_delete_file(f"{song.song_name}/external_strums.json")
        await song_service.clear_song_keys(
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
