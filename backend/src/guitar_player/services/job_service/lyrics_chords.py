"""Lyrics transcription and Gemini chord detection background tasks."""

import asyncio
import logging
import os
import tempfile
import time
import uuid

from guitar_player.app_state import get_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import safe_session
from guitar_player.services.processing_service import ProcessingService
from guitar_player.storage import StorageBackend

from .constants import LYRICS_CLEANUP_TIMEOUT_S
from .helpers import stem_candidates

logger = logging.getLogger(__name__)


async def cleanup_lyrics_preamble(
    storage: StorageBackend,
    lyrics_key: str,
) -> None:
    """Remove non-lyrics preamble segments from a stored lyrics.json using LLM.

    Non-fatal: logs a warning on failure.
    """
    from guitar_player.config import get_settings
    from guitar_player.services.llm_service import LlmService

    try:
        raw = storage.read_json(lyrics_key)
        if not isinstance(raw, dict):
            return
        segments = raw.get("segments", [])
        if len(segments) < 2:
            return

        texts = [s.get("text", "") for s in segments[:15]]

        settings = get_settings()

        if not settings.aws.use_iam_role and not settings.aws.access_key:
            logger.debug(
                "Lyrics preamble cleanup skipped for %s: no AWS credentials",
                lyrics_key,
            )
            return

        llm = LlmService(settings)
        first_index = await asyncio.wait_for(
            llm.cleanup_lyrics_preamble(texts),
            timeout=LYRICS_CLEANUP_TIMEOUT_S,
        )

        if first_index <= 0:
            return

        logger.info(
            "Removing %d non-lyrics preamble segment(s) from %s",
            first_index, lyrics_key,
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


async def _persist_lyrics_results(
    storage: StorageBackend,
    song_id: uuid.UUID,
    song_name: str,
) -> None:
    """Persist lyrics_key and lyrics_quick_key if the files are now present."""
    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return
        changes: dict = {}
        lyrics_key = f"{song_name}/lyrics.json"
        lyrics_present = storage.file_exists(lyrics_key)
        if lyrics_present and not song.lyrics_key:
            await cleanup_lyrics_preamble(storage, lyrics_key)
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
        # Clear failure flag and attempt timestamp on success.
        if lyrics_present or lyrics_corrected_present or lyrics_quick_present:
            if song.lyrics_failed:
                changes["lyrics_failed"] = False
            if song.lyrics_attempted_at is not None:
                changes["lyrics_attempted_at"] = None

        if changes:
            await song_dao.update_by_id(song_id, **changes)
            await song_dao.commit()


async def transcribe_lyrics_only(
    song_id: uuid.UUID, *, quick_only: bool = False
) -> None:
    """Transcribe lyrics for an existing song if vocals are available.

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

        if lyrics_exists and quick_exists:
            await song_dao.flush()
            return

        vocals_candidates = [
            getattr(song, "vocals_key", None),
            *stem_candidates(song.song_name, "vocals", "vocals_isolated"),
        ]
        vocals_key = next(
            (k for k in vocals_candidates if k and storage.file_exists(k)), None
        )
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
        song_id, quick_only, vocals_key,
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
        transcribe_task = asyncio.create_task(
            _fast_with_fallback(
                transcribe_coro, processing, service_path,
                song_title, song_artist, settings, song_id,
            )
        )
    else:
        transcribe_task = asyncio.create_task(transcribe_coro)

    quick_key = f"{song_name}/lyrics_quick.json"
    quick_task: asyncio.Task | None = None
    if not quick_only:
        quick_task = asyncio.create_task(
            _poll_and_persist_quick(storage, song_id, quick_key)
        )

    try:
        await transcribe_task
        elapsed_s = time.monotonic() - t0
        logger.info(
            "Lyrics-only transcription finished (%.1fs) song_id=%s quick_only=%s",
            elapsed_s, song_id, quick_only,
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
            elapsed_s, e, song_id, quick_only,
            extra={
                "event_type": "background_task_failed",
                "task": "lyrics_only",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
                "error": str(e),
                "quick_only": quick_only,
            },
        )
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
                    "Failed to persist lyrics_failed for %s", song_id, exc_info=True,
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

    await _persist_lyrics_results(storage, song_id, song_name)


async def _fast_with_fallback(
    transcribe_coro,
    processing: ProcessingService,
    service_path: str,
    song_title: str | None,
    song_artist: str | None,
    settings,
    song_id: uuid.UUID,
):
    """Try fast_only transcription, falling back to full on failure."""
    try:
        return await transcribe_coro
    except Exception as e:
        logger.info(
            "fast_only failed for song_id=%s (%s), falling back to full transcription",
            song_id, e,
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


async def _poll_and_persist_quick(
    storage, song_id: uuid.UUID, quick_key: str,
) -> None:
    """Poll for quick lyrics file and persist to DB when found."""
    for _ in range(90):
        await asyncio.sleep(2)
        if not storage.file_exists(quick_key):
            continue
        try:
            async with safe_session() as session:
                s_dao = SongDAO(session)
                s = await s_dao.get_by_id(song_id)
                if s and not s.lyrics_quick_key:
                    await s_dao.update_by_id(song_id, lyrics_quick_key=quick_key)
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
                "Failed to persist lyrics_quick_key for %s", song_id, exc_info=True,
            )
        return


async def fetch_gemini_chords(song_id: uuid.UUID) -> None:
    """Detect chords via Gemini 2.5 Pro, merge with autochord timing, and store."""
    try:
        storage = get_storage()
    except Exception:
        logger.warning("Web chords: storage init failed for %s", song_id, exc_info=True)
        return

    from guitar_player.config import get_settings

    settings = get_settings()
    gemini_api_key = settings.gemini.api_key
    if not gemini_api_key:
        logger.warning("Gemini API key not configured, skipping web chords for %s", song_id)
        async with safe_session() as session:
            song_dao = SongDAO(session)
            await song_dao.update_by_id(song_id, web_chords_failed=True)
            await song_dao.commit()
        return

    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name or not song.audio_key:
            logger.warning("Web chords: song %s missing name or audio_key, skipping", song_id)
            return
        song_name = song.song_name
        audio_key = song.audio_key
        audio_duration = float(song.duration_seconds or 300)

    t0 = time.monotonic()
    tmp_audio: str | None = None
    try:
        from guitar_player.services.gemini_chord_service import detect_chords
        from guitar_player.services.chord_merger import build_chord_meta, clean_chords

        resolved = storage.resolve_service_path(audio_key)
        if os.path.isfile(resolved):
            audio_path = resolved
        else:
            tmp_dir = tempfile.mkdtemp()
            tmp_audio = os.path.join(tmp_dir, os.path.basename(audio_key))
            storage.download_to_local(audio_key, tmp_audio)
            audio_path = tmp_audio

        tutorial_context = _load_tutorial_context(storage, song_name)

        gemini_result = await detect_chords(audio_path, gemini_api_key, tutorial_context)
        if not gemini_result or not gemini_result.chords:
            logger.warning("Gemini returned no chords for %s", song_id)
            async with safe_session() as session:
                song_dao = SongDAO(session)
                await song_dao.update_by_id(song_id, web_chords_failed=True)
                await song_dao.commit()
            return

        gemini_dicts = [
            {"start_time": c.start_time, "end_time": c.end_time, "chord": c.chord}
            for c in gemini_result.chords
        ]

        merged = clean_chords(gemini_dicts, audio_duration)

        web_chords_key = f"{song_name}/chords_web.json"
        storage.write_json(web_chords_key, merged)

        meta = build_chord_meta(
            capo=gemini_result.capo,
            key=gemini_result.key,
            bpm=gemini_result.bpm,
            tuning=gemini_result.tuning,
            time_signature=gemini_result.time_signature,
            notes=gemini_result.notes,
        )
        storage.write_json(f"{song_name}/chord_meta.json", meta.model_dump(exclude_none=True))

        async with safe_session() as session:
            song_dao = SongDAO(session)
            await song_dao.update_by_id(
                song_id,
                web_chords_key=web_chords_key,
                web_chords_failed=False,
                web_chords_attempted_at=None,
            )
            await song_dao.commit()

        elapsed = time.monotonic() - t0
        logger.info(
            "Gemini chords: stored %d entries for %s (%.1fs)",
            len(merged), song_name, elapsed,
        )

    except Exception as exc:
        elapsed = time.monotonic() - t0
        logger.warning(
            "Gemini chords fetch failed (%.1fs): %s song_id=%s",
            elapsed, exc, song_id,
        )
        try:
            async with safe_session() as session:
                song_dao = SongDAO(session)
                await song_dao.update_by_id(song_id, web_chords_failed=True)
                await song_dao.commit()
        except Exception:
            logger.debug(
                "Failed to persist web_chords_failed for %s", song_id, exc_info=True,
            )
    finally:
        if tmp_audio:
            try:
                os.unlink(tmp_audio)
                os.rmdir(os.path.dirname(tmp_audio))
            except OSError:
                pass


def _load_tutorial_context(
    storage: StorageBackend, song_name: str,
) -> str | None:
    """Load tutorial context from songsterr_data and Tavily cache."""
    tutorial_context: str | None = None

    songsterr_key = f"{song_name}/songsterr_data.json"
    if storage.file_exists(songsterr_key):
        try:
            songsterr = storage.read_json(songsterr_key)
            parts: list[str] = []
            if songsterr.get("strum_notes"):
                parts.append(f"Playing notes: {songsterr['strum_notes']}")
            if songsterr.get("lyrics_text"):
                parts.append(f"Lyrics: {songsterr['lyrics_text'][:2000]}")
            if parts:
                tutorial_context = "\n\n".join(parts)
        except Exception:
            pass

    tavily_key = f"{song_name}/tavily_content.json"
    if storage.file_exists(tavily_key):
        try:
            tavily_data = storage.read_json(tavily_key)
            if isinstance(tavily_data, dict) and tavily_data.get("content"):
                tavily_text = tavily_data["content"]
                if tutorial_context:
                    tutorial_context += f"\n\n{tavily_text[:4000]}"
                else:
                    tutorial_context = tavily_text[:6000]
        except Exception:
            pass

    return tutorial_context
