"""Scheduled stale-job sweeper Lambda.

Triggered by EventBridge on a short interval.

1. Marks any PENDING/PROCESSING jobs with updated_at older than 16 minutes as FAILED.
   Also writes job_status.json so clients polling S3 stop.

2. Handles stale homeserver downloads: if download_requested_at is older than 2 minutes
   and audio is still missing on S3, downloads via IP Royal proxy as fallback.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from guitar_player.app_state import get_storage
from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import safe_session
from guitar_player.lambdas.runtime import init_runtime
from guitar_player.request_context import request_id_var

logger = logging.getLogger(__name__)

_STALE_DOWNLOAD_AFTER_SECONDS = 120  # 2 minutes


async def _sweep_once(*, limit: int) -> int:
    storage = get_storage()

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=16)

    async with safe_session() as session:
        job_dao = JobDAO(session)
        song_dao = SongDAO(session)

        stale_jobs = await job_dao.list_stale_active_jobs(
            updated_before=cutoff, limit=limit
        )
        if not stale_jobs:
            return 0

        failed = 0
        for job in stale_jobs:
            song = await song_dao.get_by_id(job.song_id)
            await job_dao.update_status(job, "FAILED", error_message="Job timed out")
            # Release processing lock if this job owns it.
            if song and song.processing_job_id == job.id:
                song.processing_job_id = None
            failed += 1

            if song and song.song_name:
                try:
                    from guitar_player.job_status_manifest import (
                        write_job_status_manifest,
                    )

                    write_job_status_manifest(
                        storage,
                        song_name=song.song_name,
                        job_id=job.id,
                        song_id=song.id,
                        status="FAILED",
                        stage="failed",
                        progress=job.progress,
                        error_message="Job timed out",
                        min_interval_s=0.0,
                        extra={"reason": "stale_job_sweeper"},
                    )
                except Exception:
                    logger.debug(
                        "Failed to write manifest for stale job %s",
                        job.id,
                        exc_info=True,
                    )

        await session.commit()
        return failed


async def _rescue_stale_downloads() -> int:
    """Download audio via IP Royal proxy for songs stuck in download_requested_at > 2 min."""
    from guitar_player.config import get_settings
    from guitar_player.services.audio_normalize import transcode_audio_to_mp3_cbr192
    from guitar_player.services.job_service import JobService
    from guitar_player.services.processing_service import ProcessingService
    from guitar_player.services.youtube_service import YoutubeService

    settings = get_settings()
    storage = get_storage()
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_STALE_DOWNLOAD_AFTER_SECONDS)

    rescued = 0
    async with safe_session() as session:
        song_dao = SongDAO(session)
        songs = await song_dao.list_stale_downloads(requested_before=cutoff, limit=5)
        if not songs:
            return 0

        youtube = YoutubeService(
            proxy=settings.youtube.proxy,
            cookies_file=settings.youtube.cookies_file,
            use_cookies_for_public_videos=settings.youtube.use_cookies_for_public_videos,
            po_token_provider_enabled=settings.youtube.po_token_provider_enabled,
            po_token_provider_base_url=settings.youtube.po_token_provider_base_url,
            po_token_provider_disable_innertube=settings.youtube.po_token_provider_disable_innertube,
        )

        for song in songs:
            if not song.youtube_id or not song.audio_key:
                song.download_requested_at = None
                continue

            # Skip if audio already appeared (homeserver was just slow)
            if storage.file_exists(song.audio_key):
                logger.info(
                    "Stale download rescue: audio already exists for %s — clearing flag",
                    song.song_name,
                )
                song.download_requested_at = None
                rescued += 1
                continue

            logger.warning(
                "Stale download rescue: downloading via proxy for %s (yt=%s)",
                song.song_name,
                song.youtube_id,
            )
            tmp_dir = tempfile.mkdtemp(prefix="rescue_dl_")
            try:
                local_audio, _title, _meta = await youtube.download(
                    song.youtube_id, tmp_dir, skip_preflight=True
                )
                local_mp3 = os.path.join(tmp_dir, "audio.mp3")
                transcode_audio_to_mp3_cbr192(local_audio, local_mp3)
                storage.upload_file(local_mp3, song.audio_key)

                song.download_requested_at = None
                await session.flush()

                # Trigger processing
                processing = ProcessingService(settings)
                job_svc = JobService(session, storage)
                await job_svc.create_and_process_job(
                    user_sub="admin-service",
                    user_email="admin-service@local.test",
                    song_id=song.id,
                    descriptions=["vocals", "guitar", "guitar_removed"],
                    processing=processing,
                )
                rescued += 1
                logger.info(
                    "Stale download rescue: completed for %s", song.song_name
                )
            except Exception:
                logger.exception(
                    "Stale download rescue: failed for %s (yt=%s)",
                    song.song_name,
                    song.youtube_id,
                )
                # Clear flag to prevent infinite retries — the DLQ / admin can handle it
                song.download_requested_at = None
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)

        await session.commit()
    return rescued


async def _run() -> dict[str, Any]:
    total_failed = 0
    # Safety bounds: don't run forever.
    max_batches = 10
    batch_size = 200

    for _ in range(max_batches):
        n = await _sweep_once(limit=batch_size)
        total_failed += n
        if n == 0:
            break

    # Rescue stale homeserver downloads
    total_rescued = 0
    try:
        total_rescued = await _rescue_stale_downloads()
    except Exception:
        logger.exception("Stale download rescue failed")

    return {"ok": True, "failed": total_failed, "downloads_rescued": total_rescued}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    init_runtime(service_name="stale-job-sweeper")

    # EventBridge-triggered: generate a fresh correlation ID per invocation.
    request_id_var.set(str(uuid.uuid4()))

    try:
        return asyncio.run(_run())
    except Exception:
        logger.exception(
            "Stale job sweeper failed",
            extra={"event_type": "sweeper_error"},
        )
        return {"ok": False, "error": "sweeper_exception"}
