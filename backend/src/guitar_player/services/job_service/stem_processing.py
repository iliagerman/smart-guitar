"""Core job processing pipeline: stem separation, chord recognition, and orchestration."""

import asyncio
import json
import logging
import time
import uuid

import httpx

from guitar_player.app_state import get_storage
from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import safe_session
from guitar_player.request_context import request_id_var, user_id_var
from guitar_player.services.processing_service import (
    ChordRecognitionResult,
    ProcessingService,
    SeparationResult,
    StemInfo,
)

from .constants import DEFAULT_REQUESTED_OUTPUTS, STEM_EXT, STEM_NAME_MAP
from .helpers import find_stem, stem_candidates, to_demucs_requested_outputs

logger = logging.getLogger(__name__)


async def set_progress(job_id: uuid.UUID, progress: int, stage: str) -> None:
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
            logger.debug("Failed to write job status manifest", exc_info=True)


async def fail_job(job_id: uuid.UUID, message: str) -> None:
    """Mark a job as FAILED and release the processing lock."""
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


async def complete_job(job_id: uuid.UUID, results: list[dict]) -> None:
    """Mark a job as COMPLETED and release the processing lock."""
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


async def _tick_until_done(
    t: asyncio.Task,
    start: int,
    end: int,
    stage: str,
    job_id: uuid.UUID,
) -> None:
    """Asymptotic progress approximation to keep the UI alive."""
    progress = float(start)
    tick_count = 0
    while not t.done():
        clamped = min(end, int(progress))
        await set_progress(job_id, clamped, stage)
        remaining = end - progress
        increment = max(0.2, remaining * 0.06)
        progress = min(end, progress + increment)
        tick_count += 1
        if tick_count % 15 == 0:
            logger.info(
                "Job %s still in stage '%s': progress=%d",
                job_id, stage, clamped,
                extra={
                    "event_type": "job_heartbeat",
                    "job_id": str(job_id),
                    "stage": stage,
                    "progress": clamped,
                },
            )
        await asyncio.sleep(2)


async def _do_lyrics(
    processing: ProcessingService,
    storage,
    song_name: str,
    song_title: str | None,
    song_artist: str | None,
    job_id: uuid.UUID,
    settings,
) -> None:
    """Transcribe lyrics from the vocals stem (non-fatal)."""
    vocals_stem_key = find_stem(storage, song_name, "vocals")
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
            "Sub-task finished: lyrics (%.1fs)", elapsed_s,
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
            "Sub-task failed: lyrics (non-fatal, %.1fs): %s", elapsed_s, e,
            extra={
                "event_type": "subtask_failed",
                "job_id": str(job_id),
                "subtask": "lyrics",
                "elapsed_s": round(elapsed_s, 1),
                "error": str(e),
            },
        )


async def _do_merge(
    storage,
    song_name: str,
    job_id: uuid.UUID,
    settings,
) -> None:
    """Merge vocals + guitar into a combined stem (non-fatal)."""
    t0 = time.monotonic()
    try:
        vocals_merge_key = find_stem(storage, song_name, "vocals")
        guitar_merge_key = find_stem(storage, song_name, "guitar")
        if not (vocals_merge_key and guitar_merge_key):
            logger.info(
                "Skipping merge: missing source stems",
                extra={
                    "event_type": "subtask_skip",
                    "job_id": str(job_id),
                    "subtask": "merge",
                    "reason": "stems_missing",
                },
            )
            return

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
            await _invoke_lambda_stitch(
                settings, stitch_fn, song_name, vocals_merge_key, guitar_merge_key
            )
        else:
            from guitar_player.services.audio_merge import merge_vocals_guitar_stem

            await merge_vocals_guitar_stem(
                storage, song_name, vocals_merge_key, guitar_merge_key
            )

        elapsed_s = time.monotonic() - t0
        logger.info(
            "Sub-task finished: merge (%.1fs)", elapsed_s,
            extra={
                "event_type": "subtask_done",
                "job_id": str(job_id),
                "subtask": "merge",
                "elapsed_s": round(elapsed_s, 1),
            },
        )
    except Exception as e:
        elapsed_s = time.monotonic() - t0
        logger.warning(
            "Sub-task failed: merge (non-fatal, %.1fs): %s", elapsed_s, e,
            extra={
                "event_type": "subtask_failed",
                "job_id": str(job_id),
                "subtask": "merge",
                "elapsed_s": round(elapsed_s, 1),
                "error": str(e),
            },
        )


async def _invoke_lambda_stitch(
    settings, function_name: str, song_name: str,
    vocals_key: str, guitar_key: str,
) -> None:
    """Invoke the vocals+guitar stitch Lambda synchronously."""
    import boto3

    payload: dict = {
        "song_name": song_name,
        "vocals_key": vocals_key,
        "guitar_key": guitar_key,
    }
    rid = request_id_var.get()
    if rid:
        payload["request_id"] = rid
    uid = user_id_var.get()
    if uid:
        payload["user_id"] = uid

    def _invoke() -> None:
        client = boto3.client("lambda", region_name=settings.aws.region)
        client.invoke(
            FunctionName=function_name,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload).encode("utf-8"),
        )

    await asyncio.to_thread(_invoke)


async def _do_tabs(
    processing: ProcessingService,
    storage,
    song_name: str,
    job_id: uuid.UUID,
) -> None:
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

        guitar_tabs_key = find_stem(storage, song_name, "guitar")
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
            "Sub-task finished: tabs (%.1fs)", elapsed_s,
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
            "Sub-task failed: tabs (non-fatal, %.1fs): %s", elapsed_s, e,
            extra={
                "event_type": "subtask_failed",
                "job_id": str(job_id),
                "subtask": "tabs",
                "elapsed_s": round(elapsed_s, 1),
                "error": str(e),
            },
        )


async def _check_quick_lyrics(
    storage, song_name: str, song_id: uuid.UUID, job_id: uuid.UUID,
) -> None:
    """Poll for lyrics_quick.json appearing during lyrics transcription."""
    quick_key = f"{song_name}/lyrics_quick.json"
    for _ in range(60):
        await asyncio.sleep(2)
        if not storage.file_exists(quick_key):
            continue
        try:
            async with safe_session() as sess:
                s_dao = SongDAO(sess)
                s = await s_dao.get_by_id(song_id)
                if s and not s.lyrics_quick_key:
                    await s_dao.update_by_id(song_id, lyrics_quick_key=quick_key)
                    await s_dao.commit()
        except Exception as e:
            logger.debug("Failed to persist lyrics_quick_key: %s", e)
        await set_progress(job_id, 80, "quick_lyrics_ready")
        logger.info(
            "Quick lyrics detected for job %s", job_id,
            extra={
                "event_type": "subtask_done",
                "job_id": str(job_id),
                "subtask": "quick_lyrics",
            },
        )
        return


async def _persist_results(
    job_id: uuid.UUID,
    separation_result: SeparationResult,
    chords_result: ChordRecognitionResult,
    song_name: str,
    storage,
) -> None:
    """Persist song stem keys + chords key and mark job completed."""
    from .lyrics_chords import cleanup_lyrics_preamble

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

                ext = _Path(stem_info.path).suffix or STEM_EXT
                song_changes[f"{canonical}_key"] = (
                    f"{song_name}/{stem_info.name}{ext}"
                )

        if chords_result.output_path:
            song_changes["chords_key"] = f"{song_name}/chords.json"

        lyrics_key = f"{song_name}/lyrics.json"
        if storage.file_exists(lyrics_key):
            await cleanup_lyrics_preamble(storage, lyrics_key)
            song_changes["lyrics_key"] = lyrics_key
            song_changes["lyrics_failed"] = False
        else:
            song_changes["lyrics_failed"] = True

        lyrics_quick_key = f"{song_name}/lyrics_quick.json"
        if storage.file_exists(lyrics_quick_key):
            song_changes["lyrics_quick_key"] = lyrics_quick_key

        tabs_key = f"{song_name}/tabs.json"
        if storage.file_exists(tabs_key):
            song_changes["tabs_key"] = tabs_key
            song_changes["tabs_failed"] = False

        vg_key = find_stem(storage, song_name, "vocals_guitar")
        if vg_key:
            song_changes["vocals_guitar_key"] = vg_key

        if song_changes:
            await song_dao.update_by_id(song.id, **song_changes)

        job_results = [
            {"description": stem_info.name, "target_key": stem_info.path}
            for stem_info in separation_result.stems
        ]

        await job_dao.update_status(job.id, "COMPLETED", results=job_results)
        await job_dao.commit()


async def process_job(job_id: uuid.UUID) -> None:
    """Run stem separation + chord recognition and update the DB as we go."""
    try:
        storage = get_storage()
    except Exception:
        return

    from guitar_player.config import get_settings

    settings = get_settings()
    processing = ProcessingService(settings)

    await set_progress(job_id, 1, "starting")

    # Resolve job + song in a short-lived session.
    async with safe_session() as session:
        job_dao = JobDAO(session)
        song_dao = SongDAO(session)

        job = await job_dao.get_by_id(job_id)
        if not job:
            return

        raw_descriptions: list[str] = DEFAULT_REQUESTED_OUTPUTS
        if job.descriptions:
            raw_descriptions = [str(x) for x in job.descriptions]
        demucs_requested_outputs = to_demucs_requested_outputs(raw_descriptions)

        # Ensure vocals isolation for lyrics transcription.
        if "vocals_isolated" not in demucs_requested_outputs:
            demucs_requested_outputs.append("vocals_isolated")

        song = await song_dao.get_by_id(job.song_id)
        if not song:
            await job_dao.update_status(
                job.id, "FAILED", error_message="Song not found"
            )
            await job_dao.commit()
            return

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
        song_id = song.id

    job_start_time = time.monotonic()
    logger.info(
        "Processing job",
        extra={
            "job_id": str(job_id),
            "audio_path": audio_path,
            "event_type": "job_start",
        },
    )

    # Idempotency: skip expensive work if core artifacts already exist.
    await set_progress(job_id, 10, "separating")

    sep_result, chords_result = await _run_separation_and_chords(
        processing, storage, audio_path, song_name, job_id,
        demucs_requested_outputs, job_start_time,
    )
    if sep_result is None:
        return  # Job was failed inside the helper.

    # Run lyrics/merge/tabs in parallel (all non-fatal).
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
    await set_progress(job_id, 78, "transcribing")

    async def _all_subtasks() -> None:
        await asyncio.gather(
            _do_lyrics(
                processing, storage, song_name, song_title, song_artist,
                job_id, settings,
            ),
            _do_merge(storage, song_name, job_id, settings),
            _do_tabs(processing, storage, song_name, job_id),
            _check_quick_lyrics(storage, song_name, song_id, job_id),
        )

    gather_task = asyncio.create_task(_all_subtasks())
    ltt_tick = asyncio.create_task(
        _tick_until_done(gather_task, start=79, end=89, stage="transcribing", job_id=job_id)
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
    await set_progress(job_id, 90, "saving_results")

    await _persist_results(job_id, sep_result, chords_result, song_name, storage)

    logger.info(
        "Job completed",
        extra={
            "job_id": str(job_id),
            "event_type": "job_completed",
            "total_elapsed_s": round(time.monotonic() - job_start_time, 1),
        },
    )


async def _run_separation_and_chords(
    processing: ProcessingService,
    storage,
    audio_path: str,
    song_name: str,
    job_id: uuid.UUID,
    demucs_requested_outputs: list[str],
    job_start_time: float,
) -> tuple[SeparationResult | None, ChordRecognitionResult | None]:
    """Run stem separation and chord recognition, returning results or None on failure."""
    from guitar_player.config import get_settings
    settings = get_settings()

    def _find_existing_key(candidates: list[str]) -> str | None:
        return next((k for k in candidates if storage.file_exists(k)), None)

    vocals_key_existing = _find_existing_key(
        stem_candidates(song_name, "vocals", "vocals_isolated")
    )
    guitar_key_existing = _find_existing_key(
        stem_candidates(song_name, "guitar", "guitar_isolated")
    )
    chords_key_existing = _find_existing_key([f"{song_name}/chords.json"])

    stems_already_ok = bool(vocals_key_existing and guitar_key_existing)
    chords_already_ok = bool(chords_key_existing)

    # Build separation task.
    if stems_already_ok:
        logger.info(
            "Skipping demucs separation: stems already present",
            extra={"event_type": "job_skip", "job_id": str(job_id), "reason": "stems_cached"},
        )
        sep_task = asyncio.create_task(_cached_separation(storage, song_name))
    else:
        sep_task = asyncio.create_task(
            processing.separate_stems(
                audio_path, requested_outputs=demucs_requested_outputs or None,
            )
        )

    # Build chords task.
    if chords_already_ok:
        logger.info(
            "Skipping chord recognition: chords already present",
            extra={"event_type": "job_skip", "job_id": str(job_id), "reason": "chords_cached"},
        )
        chords_task = asyncio.create_task(_cached_chords(song_name))
    else:
        chords_task = asyncio.create_task(processing.recognize_chords(audio_path))

    tick_task = asyncio.create_task(
        _tick_until_done(sep_task, start=12, end=70, stage="separating", job_id=job_id)
    )

    try:
        separation_result = await sep_task
    except Exception as e:
        tick_task.cancel()
        if not chords_task.done():
            chords_task.cancel()
        try:
            await chords_task
        except Exception:
            pass
        await fail_job(job_id, str(e))
        return None, None
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
    await set_progress(job_id, 75, "recognizing_chords")

    try:
        chords_result = await chords_task
    except httpx.ConnectError as e:
        await fail_job(
            job_id,
            f"Chords service unavailable ({settings.services.chords_generator}): {e}",
        )
        return None, None
    except httpx.HTTPError as e:
        await fail_job(
            job_id,
            f"Chords service request failed ({settings.services.chords_generator}): {e}",
        )
        return None, None
    except Exception as e:
        await fail_job(job_id, str(e))
        return None, None

    return separation_result, chords_result


async def _cached_separation(storage, song_name: str) -> SeparationResult:
    """Report existing stems as if they were produced by Demucs."""
    stem_names = ["guitar", "vocals", "guitar_removed"]
    stems: list[StemInfo] = []
    for name in stem_names:
        key = find_stem(storage, song_name, name)
        if key:
            stems.append(StemInfo(name=name, path=key))
    return SeparationResult(stems=stems, output_path=f"{song_name}/")


async def _cached_chords(song_name: str) -> ChordRecognitionResult:
    return ChordRecognitionResult(chords=[], output_path=f"{song_name}/chords.json")
