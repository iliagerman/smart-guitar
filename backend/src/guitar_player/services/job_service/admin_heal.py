"""Startup admin healing: scan all songs and repair missing artifacts."""

import asyncio
import logging
import os
import tempfile
import uuid

import httpx

from guitar_player.app_state import get_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.database import safe_session
from guitar_player.request_context import user_id_var
from guitar_player.schemas.records import SongRecord
from guitar_player.services.processing_service import ProcessingService
from guitar_player.services.youtube_service import YoutubeService
from guitar_player.storage import StorageBackend

from .background_tasks import track_task
from .constants import STEM_LIKE_AUDIO_FILENAMES, THUMB_CANDIDATES
from .core import JobService

logger = logging.getLogger(__name__)


async def admin_heal_audio_and_thumbnail_on_startup(
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
    """
    fixed = 0

    audio_ok = bool(song.audio_key) and storage.file_exists(song.audio_key)
    thumb_ok = bool(song.thumbnail_key) and storage.file_exists(song.thumbnail_key)

    if audio_ok and thumb_ok:
        return 0

    changes: dict = {}

    if song.song_name:
        fixed, audio_ok, thumb_ok = _fix_from_existing_files(
            song, storage, changes, audio_ok, thumb_ok,
        )

    if (not audio_ok or not thumb_ok) and song.youtube_id and allow_youtube_downloads:
        yt_fixed = await _redownload_from_youtube(
            song, storage, changes, audio_ok, thumb_ok,
            user_sub, user_email, user_dao, youtube,
        )
        fixed += yt_fixed

    if changes:
        await song_dao.update_by_id(song.id, **changes)

    return fixed


def _fix_from_existing_files(
    song: SongRecord, storage: StorageBackend, changes: dict,
    audio_ok: bool, thumb_ok: bool,
) -> tuple[int, bool, bool]:
    """Try to fix audio/thumbnail from existing files in storage."""
    fixed = 0
    try:
        files = set(storage.list_files(song.song_name))

        if not audio_ok:
            audio_candidates = [
                f"{song.song_name}/audio.mp3",
                f"{song.song_name}/full_mix.mp3",
                f"{song.song_name}/mix.mp3",
            ]
            for f in files:
                if f.endswith(".mp3") and f.rsplit("/", 1)[-1] not in STEM_LIKE_AUDIO_FILENAMES:
                    audio_candidates.append(f)

            for key in audio_candidates:
                if key in files and storage.file_exists(key):
                    changes["audio_key"] = key
                    audio_ok = True
                    fixed += 1
                    break

        if not thumb_ok:
            thumb_candidates = [
                f"{song.song_name}/{fname}" for fname in THUMB_CANDIDATES
            ]
            if song.youtube_id:
                thumb_candidates.insert(0, f"{song.song_name}/{song.youtube_id}.jpg")

            for key in thumb_candidates:
                if key in files and storage.file_exists(key):
                    changes["thumbnail_key"] = key
                    thumb_ok = True
                    fixed += 1
                    break
    except Exception as e:
        logger.warning(
            "Startup admin: failed to list files for %s: %s", song.song_name, e,
        )

    return fixed, audio_ok, thumb_ok


async def _redownload_from_youtube(
    song: SongRecord, storage: StorageBackend, changes: dict,
    audio_ok: bool, thumb_ok: bool,
    user_sub: str, user_email: str, user_dao: UserDAO,
    youtube: YoutubeService,
) -> int:
    """Re-download missing audio/thumbnail from YouTube."""
    fixed = 0
    tmp_dir = tempfile.mkdtemp(prefix="startup_admin_")
    try:
        user = await user_dao.get_or_create(user_sub, user_email)

        if not audio_ok:
            local_mp3, _raw_name, _meta = await youtube.download(
                song.youtube_id, tmp_dir
            )
            audio_filename = os.path.basename(local_mp3)
            audio_key = f"{song.song_name}/{audio_filename}"
            storage.upload_file(local_mp3, audio_key)
            changes["audio_key"] = audio_key
            fixed += 1

        if not thumb_ok:
            thumb_path = await youtube.download_thumbnail(song.youtube_id, tmp_dir)
            thumb_key = f"{song.song_name}/{song.youtube_id}.jpg"
            storage.upload_file(thumb_path, thumb_key)
            changes["thumbnail_key"] = thumb_key
            fixed += 1

        if fixed and not song.downloaded_by:
            changes["downloaded_by"] = user.id
    finally:
        try:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass

    return fixed


async def _processing_services_healthy(
    settings, *, timeout_s: float = 2.0,
) -> tuple[bool, str | None]:
    """Best-effort connectivity check for the processing microservices."""
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
    url: str, *, timeout_s: float = 2.0,
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
    user_id_var.set(user_sub)
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
            "Startup admin: processing services not ready: %s. "
            "Will only repair DB keys from existing storage.",
            services_reason,
        )

    tabs_service_ok, tabs_service_reason = await _service_healthy(
        f"http://{settings.services.tabs_generator}/health"
    )
    if not tabs_service_ok:
        logger.warning(
            "Startup admin: tabs service not ready: %s. Will skip tabs healing.",
            tabs_service_reason,
        )

    allow_youtube_downloads = (
        settings.environment in {"local", "dev", "test"}
        and settings.storage.backend == "local"
    )

    from guitar_player.services.youtube_service import YouTubeServiceConfig  # circular import

    youtube = YoutubeService(
        YouTubeServiceConfig(
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
    )

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
            jobs_triggered, keys_fixed = await _heal_single_song(
                song_id, storage, user_sub, user_email,
                youtube, processing, services_ok, tabs_service_ok,
                allow_youtube_downloads, jobs_triggered, keys_fixed,
            )
        except Exception as e:
            logger.warning(
                "Startup admin: song %s (%s) failed: %s", song_name, song_id, e,
            )
        await asyncio.sleep(0.5)

    logger.info(
        "Startup admin complete: %d songs checked, %d jobs triggered, %d keys fixed",
        len(candidates), jobs_triggered, keys_fixed,
    )


async def _heal_single_song(
    song_id: uuid.UUID,
    storage: StorageBackend,
    user_sub: str,
    user_email: str,
    youtube: YoutubeService,
    processing: ProcessingService,
    services_ok: bool,
    tabs_service_ok: bool,
    allow_youtube_downloads: bool,
    jobs_triggered: int,
    keys_fixed: int,
) -> tuple[int, int]:
    """Heal a single song during startup admin scan."""
    async with safe_session() as session:
        song_dao = SongDAO(session)
        user_dao = UserDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return jobs_triggered, keys_fixed

        fixed_here = await admin_heal_audio_and_thumbnail_on_startup(
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

        song = await song_dao.get_by_id(song_id)
        if not song:
            return jobs_triggered, keys_fixed
        audio_ok = bool(song.audio_key) and storage.file_exists(song.audio_key)

        job_svc = JobService(session, storage)

        triggered = False
        if audio_ok and services_ok:
            triggered = await job_svc.trigger_reprocess(
                user_sub=user_sub,
                user_email=user_email,
                song_id=song_id,
                processing=processing,
            )
        if triggered:
            jobs_triggered += 1

        if not triggered:
            await job_svc.trigger_lyrics_transcription_if_missing(song_id)

        if tabs_service_ok:
            await job_svc.trigger_tabs_generation_if_missing(song_id)

        await song_dao.commit()

    return jobs_triggered, keys_fixed


def start_startup_admin_heal(user_sub: str, user_email: str) -> None:
    """Launch the post-startup admin healing scan as a background task."""
    task = asyncio.create_task(_startup_admin_heal(user_sub, user_email))
    track_task(task)
