"""FastAPI application wrapping WhisperX transcription.

Provides /health, /transcribe and /fetch-and-align endpoints.
Storage backend (local or S3) is selected via config, initialized on startup.
"""

import asyncio
import logging
import os
import re
import shutil
import sys
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from mangum import Mangum
from pythonjsonlogger.json import JsonFormatter

from lyrics_generator.config import get_settings
from lyrics_generator.detect_language import detect_language_from_lyrics, detect_language_from_text
from lyrics_generator.lyrics_fetcher import fetch_lyrics
from lyrics_generator.lrc_parser import parse_lrc
from lyrics_generator.onset_aligner import (
    align_plain_lyrics,
    load_audio,
    refine_segments_with_onsets,
)
from lyrics_generator.openai_transcriber import transcribe_openai, write_lyrics_json
from lyrics_generator.schemas import (
    FetchAndAlignRequest,
    FetchAndAlignResponse,
    Segment,
    TranscribeRequest,
    TranscribeResponse,
    WordTimestamp,
)
from lyrics_generator.request_context import RequestContextFilter, RequestContextMiddleware
from lyrics_generator.storage import StorageBackend, create_storage
from lyrics_generator.transcriber import _get_transcription_model, transcribe

logger = logging.getLogger(__name__)

_storage: StorageBackend


def _setup_logging(level: str = "INFO", service_name: str = "lyrics-generator") -> None:
    """Configure JSON structured logging for CloudWatch."""
    handler = logging.StreamHandler(sys.stdout)
    formatter = JsonFormatter(
        fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"asctime": "timestamp", "levelname": "level", "name": "logger"},
        static_fields={"service": service_name},
    )
    handler.setFormatter(formatter)
    handler.addFilter(RequestContextFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Force uvicorn loggers to propagate through root (JSON formatter + request context)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers.clear()
        uv_logger.propagate = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _storage
    settings = get_settings()

    _setup_logging(level=settings.app.log_level)

    _storage = create_storage(settings)
    _storage.init()

    # Pre-load WhisperX transcription model at startup to avoid first-request latency
    _get_transcription_model(settings.whisper.model_name, settings.whisper.compute_type)

    logger.info(
        "API started: env=%s, storage=%s, whisper_model=%s",
        settings.environment,
        settings.storage.backend,
        settings.whisper.model_name,
    )

    yield


app = FastAPI(title="Lyrics Generator API", lifespan=lifespan)
app.add_middleware(RequestContextMiddleware)


def _compact_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _render_initial_prompt(
    *, template: str | None, title: str | None, artist: str | None
) -> str | None:
    """Render a prompt template with optional {title}/{artist} placeholders.

    If metadata is provided but the template doesn't include placeholders, we append
    a short context line to help Whisper on lyrics.
    """

    t = (title or "").strip() or None
    a = (artist or "").strip() or None

    if not template and not (t or a):
        return None

    base = (
        template
        or "These are song lyrics. Prefer verbatim words over paraphrasing. Keep contractions."
    ).strip()

    # Replace known placeholders without throwing on unknown braces.
    rendered = base.replace("{title}", t or "").replace("{artist}", a or "")
    rendered = _compact_ws(rendered)

    # If we have metadata and it wasn't included, append it.
    if (t or a) and ("{title}" not in base and "{artist}" not in base):
        meta_bits: list[str] = []
        if t:
            meta_bits.append(f"Song: {t}")
        if a:
            meta_bits.append(f"Artist: {a}")
        rendered = _compact_ws(f"{rendered} {'; '.join(meta_bits)}")

    return rendered or None


def _to_segments(results: list) -> list[Segment]:
    """Convert SegmentInfo list to Segment response models."""
    return [
        Segment(
            start=s.start,
            end=s.end,
            text=s.text,
            words=[WordTimestamp(word=w.word, start=w.start, end=w.end) for w in s.words],
        )
        for s in results
    ]


@app.get("/health")
def health():
    settings = get_settings()
    return {
        "status": "ok",
        "service": "lyrics_generator-api",
        "model": settings.whisper.model_name,
    }


# ---------------------------------------------------------------------------
# Core transcription helpers
# ---------------------------------------------------------------------------


async def _transcribe_with_fallback(
    *,
    local_input: str,
    output_dir: str,
    job_id: str,
    whisper_cfg,
    openai_api_key: str | None,
    openai_model: str | None,
    language: str | None,
    title: str | None,
    artist: str | None,
    source_override: str | None = None,
) -> tuple[list, str]:
    """Run transcription: local WhisperX first, OpenAI as fallback.

    Returns:
        (segments, source) where source is "whisper", "openai_whisper", etc.
    """
    results = None
    source = source_override or "whisper"

    # PRIMARY: always try local WhisperX first
    try:
        logger.info("Using local WhisperX for job %s (language=%s)", job_id, language)
        results = await asyncio.to_thread(
            transcribe, local_input, output_dir, whisper_config=whisper_cfg,
        )
        if not source_override:
            source = "whisper"
    except Exception as e:
        logger.warning("Local WhisperX failed for job %s: %s", job_id, e)
        results = None

    # FALLBACK: try OpenAI only if local WhisperX failed AND key is available
    if results is None and openai_api_key:
        try:
            logger.info("Falling back to OpenAI Whisper for job %s (language=%s)", job_id, language)
            results = await transcribe_openai(
                local_input,
                api_key=openai_api_key,
                model=openai_model or "whisper-1",
                language=language,
                title=title,
                artist=artist,
            )
            source = "openai_whisper"
        except Exception as e:
            logger.error("OpenAI Whisper also failed for job %s: %s", job_id, e)
            raise RuntimeError(f"All transcription methods failed for job {job_id}") from e

    if results is None:
        raise RuntimeError(f"Transcription failed for job {job_id}")

    # Refine word timestamps with audio onset detection.
    # WhisperX's wav2vec2 alignment provides ~50ms word boundaries;
    # onset detection adds guitar-strum-aware refinement on top.
    try:
        audio = await asyncio.to_thread(load_audio, local_input)
        results = await asyncio.to_thread(
            refine_segments_with_onsets, results, audio,
            trust_existing_words=True,
        )
        del audio
    except Exception as e:
        logger.warning("Onset alignment failed for job %s, using raw timestamps: %s", job_id, e)

    write_lyrics_json(results, os.path.join(output_dir, "lyrics.json"), source=source)

    return results, source


async def _produce_fast_lyrics(
    *,
    lyrics_result,
    local_input: str,
    input_path: str,
    temp_dir: str,
    duration: float | None,
    storage: StorageBackend,
    job_id: str,
) -> None:
    """Produce fast-aligned lyrics from fetched lyrics and store immediately.

    Runs in parallel with Whisper transcription.  Stores lyrics_quick.json
    to storage as soon as alignment completes (typically a few seconds),
    so the backend can detect it and show lyrics while Whisper is still
    running.

    Uses a separate temp dir to avoid race conditions with the main
    output_dir used by Whisper.
    """
    try:
        audio = await asyncio.to_thread(load_audio, local_input)
        total_duration = len(audio) / 16000.0  # _SR = 16000
        src = lyrics_result.source  # "lrclib" or "genius"

        if lyrics_result.has_synced:
            segments = parse_lrc(lyrics_result.synced_lyrics, total_duration=duration or total_duration)
            segments = await asyncio.to_thread(
                refine_segments_with_onsets, segments, audio,
                trust_existing_words=False,
            )
            del audio
            source = f"{src}_quick_synced"
        elif lyrics_result.plain_lyrics:
            lines = [l.strip() for l in lyrics_result.plain_lyrics.splitlines() if l.strip()]
            if not lines:
                del audio
                logger.info("Fast lyrics: empty plain lyrics for job %s", job_id)
                return
            segments = await asyncio.to_thread(
                align_plain_lyrics, lines, audio, duration or total_duration,
            )
            del audio
            source = f"{src}_quick_plain"
        else:
            del audio
            return

        if not segments:
            logger.info("Fast lyrics: no segments produced for job %s", job_id)
            return

        # Write to a separate temp dir and store immediately
        quick_dir = os.path.join(temp_dir, f"{job_id}_quick")
        os.makedirs(quick_dir, exist_ok=True)
        try:
            write_lyrics_json(segments, os.path.join(quick_dir, "lyrics_quick.json"), source=source)
            storage.store_outputs(quick_dir, input_path)
            logger.info("Fast lyrics stored for job %s (source=%s, %d segments)", job_id, source, len(segments))
        finally:
            shutil.rmtree(quick_dir, ignore_errors=True)

    except Exception as e:
        # Non-fatal: fast lyrics are best-effort
        logger.warning("Fast lyrics failed for job %s (non-fatal): %s", job_id, e)


async def _run_transcription_pipeline(
    *,
    local_input: str,
    output_dir: str,
    job_id: str,
    settings,
    title: str | None,
    artist: str | None,
    album: str | None = None,
    duration: float | None = None,
    language: str | None,
    prompt: str | None,
    openai_api_key: str | None,
    openai_model: str | None,
    fallback_to_transcription: bool = True,
    input_path: str | None = None,
    fast_only: bool = False,
) -> tuple[list, str]:
    """Unified transcription pipeline.

    1. Fetch lyrics (LRCLIB first, Genius fallback) — use as WhisperX prompt
    2. If lyrics found, launch fast-track alignment in parallel (stores lyrics_quick.json)
    3. Run local WhisperX (primary) with lyrics-enhanced prompt
    4. Fall back to OpenAI (secondary) if WhisperX fails

    When *fast_only* is True, only steps 1-2 are executed (Whisper is skipped).
    This is used when full lyrics already exist but lyrics_quick.json is missing.
    """
    lyrics_result = None

    # Step 1: Fetch lyrics from configured sources (LRCLIB, then Genius)
    if title and artist:
        try:
            lyrics_result = await fetch_lyrics(
                artist=artist, title=title, album=album, duration=duration,
                genius_access_token=settings.genius.access_token,
            )
        except Exception as e:
            logger.warning("Lyrics fetch failed for job %s: %s", job_id, e)

    # Step 2: Launch fast-track lyrics in parallel if any source returned lyrics.
    # This stores lyrics_quick.json immediately (within seconds) so the backend
    # can detect it and show lyrics while Whisper is still running.
    fast_task: asyncio.Task | None = None
    if lyrics_result and input_path:
        if fast_only:
            # fast_only mode: run fast lyrics synchronously and return immediately.
            # Whisper is skipped — only lyrics_quick.json is produced.
            logger.info("fast_only mode: producing quick lyrics only for job %s", job_id)
            await _produce_fast_lyrics(
                lyrics_result=lyrics_result,
                local_input=local_input,
                input_path=input_path,
                temp_dir=settings.processing.temp_dir,
                duration=duration,
                storage=_storage,
                job_id=job_id,
            )
            return [], "fast_only"
        fast_task = asyncio.create_task(
            _produce_fast_lyrics(
                lyrics_result=lyrics_result,
                local_input=local_input,
                input_path=input_path,
                temp_dir=settings.processing.temp_dir,
                duration=duration,
                storage=_storage,
                job_id=job_id,
            )
        )
    elif fast_only:
        # fast_only requested but no lyrics found online — cannot produce quick lyrics.
        raise HTTPException(
            status_code=404,
            detail=f"fast_only: no lyrics found for artist={artist!r} title={title!r}",
        )

    # Step 3: Extract lyrics text for use as WhisperX prompt
    # Synced lyrics have timestamps stripped; plain lyrics used directly.
    lyrics_prompt_text = None
    lyrics_source = lyrics_result.source if lyrics_result else None
    if lyrics_result and lyrics_result.has_synced:
        # Strip LRC timestamps to get plain text for prompt
        lines = []
        for line in lyrics_result.synced_lyrics.splitlines():
            cleaned = re.sub(r"\[\d{2}:\d{2}[.\d]*\]\s*", "", line).strip()
            if cleaned:
                lines.append(cleaned)
        lyrics_prompt_text = "\n".join(lines) if lines else None
        logger.info("Using synced lyrics from %s as WhisperX prompt for job %s", lyrics_source, job_id)
    elif lyrics_result and lyrics_result.plain_lyrics:
        lyrics_prompt_text = lyrics_result.plain_lyrics
        logger.info("Using plain lyrics from %s as WhisperX prompt for job %s", lyrics_source, job_id)

    # If no lyrics found and fallback is disabled, fail
    if not lyrics_result and not fallback_to_transcription and title and artist:
        if fast_task:
            fast_task.cancel()
        raise HTTPException(
            status_code=404,
            detail=f"No lyrics found for artist={artist!r} title={title!r}",
        )

    # Step 4: Build whisper config with best available prompt
    whisper_cfg = settings.whisper.model_copy(deep=True)

    if prompt:
        whisper_cfg.initial_prompt = prompt
    elif lyrics_prompt_text:
        whisper_cfg.initial_prompt = lyrics_prompt_text
    else:
        whisper_cfg.initial_prompt = _render_initial_prompt(
            template=whisper_cfg.initial_prompt,
            title=title, artist=artist,
        )

    # Language resolution (priority: explicit > lyrics-detect > script-detect > None)
    if language:
        whisper_cfg.language = language
    elif not whisper_cfg.language:
        if lyrics_prompt_text:
            whisper_cfg.language = detect_language_from_lyrics(lyrics_prompt_text)
        if not whisper_cfg.language:
            whisper_cfg.language = detect_language_from_text(title=title, artist=artist)

    logger.info(
        "Transcription config: job=%s language=%r lyrics_prompt=%s initial_prompt=%r "
        "title=%r artist=%r openai=%s",
        job_id,
        whisper_cfg.language,
        bool(lyrics_prompt_text),
        whisper_cfg.initial_prompt,
        title,
        artist,
        bool(openai_api_key),
    )

    # Determine source label based on whether fetched lyrics were used as prompt
    source_override = None
    if lyrics_prompt_text and lyrics_source:
        if lyrics_result and lyrics_result.has_synced:
            source_override = f"{lyrics_source}_synced+whisper"
        else:
            source_override = f"{lyrics_source}_plain+whisper"

    # Step 5: Transcribe (local WhisperX primary, OpenAI fallback)
    results, source = await _transcribe_with_fallback(
        local_input=local_input,
        output_dir=output_dir,
        job_id=job_id,
        whisper_cfg=whisper_cfg,
        openai_api_key=openai_api_key,
        openai_model=openai_model,
        language=whisper_cfg.language,
        title=title,
        artist=artist,
        source_override=source_override,
    )

    # Await fast task to handle any exceptions (it should already be done)
    if fast_task is not None:
        try:
            await fast_task
        except Exception:
            pass  # Already logged inside _produce_fast_lyrics

    return results, source


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_endpoint(request: TranscribeRequest):
    settings = get_settings()
    temp_dir = settings.processing.temp_dir
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(temp_dir, job_id)
    output_dir = os.path.join(job_dir, "output")

    os.makedirs(output_dir, exist_ok=True)

    try:
        if not _storage.file_exists(request.input_path):
            raise HTTPException(
                status_code=404, detail=f"Input file not found: {request.input_path}"
            )

        local_input = _storage.resolve_input(request.input_path)

        logger.info(
            "Starting transcription",
            extra={"job_id": job_id, "input_path": request.input_path, "event_type": "transcription_start"},
        )

        results, source = await _run_transcription_pipeline(
            local_input=local_input,
            output_dir=output_dir,
            job_id=job_id,
            settings=settings,
            title=request.title,
            artist=request.artist,
            album=request.album,
            duration=request.duration,
            language=request.language,
            prompt=request.prompt,
            openai_api_key=request.openai_api_key,
            openai_model=request.openai_model,
            fallback_to_transcription=True,
            input_path=request.input_path,
        )

        output_path = _storage.store_outputs(output_dir, request.input_path)

        return TranscribeResponse(
            status="done",
            output_path=output_path,
            segments=_to_segments(results),
            input_path=request.input_path,
            source=source,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Transcription failed", extra={"job_id": job_id, "event_type": "transcription_failed"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)
            logger.info("Cleaned up temp dir: %s", job_dir)


@app.post("/fetch-and-align", response_model=FetchAndAlignResponse)
async def fetch_and_align_endpoint(request: FetchAndAlignRequest):
    """Fetch lyrics and use them as prompt for WhisperX transcription.

    Strategy:
    1. Fetch lyrics from LRCLIB (synced or plain) -> use as WhisperX prompt.
    2. Run local WhisperX transcription + wav2vec2 alignment (primary).
    3. If WhisperX fails -> OpenAI fallback.
    """
    settings = get_settings()
    temp_dir = settings.processing.temp_dir
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(temp_dir, job_id)
    output_dir = os.path.join(job_dir, "output")

    os.makedirs(output_dir, exist_ok=True)

    try:
        if not _storage.file_exists(request.input_path):
            raise HTTPException(
                status_code=404, detail=f"Input file not found: {request.input_path}"
            )

        logger.info(
            "fetch-and-align: job=%s artist=%r title=%r openai=%s fast_only=%s",
            job_id, request.artist, request.title, bool(request.openai_api_key), request.fast_only,
        )

        local_input = _storage.resolve_input(request.input_path)

        results, source = await _run_transcription_pipeline(
            local_input=local_input,
            output_dir=output_dir,
            job_id=job_id,
            settings=settings,
            title=request.title,
            artist=request.artist,
            album=request.album,
            duration=request.duration,
            language=request.language,
            prompt=request.prompt,
            openai_api_key=request.openai_api_key,
            openai_model=request.openai_model,
            fallback_to_transcription=request.fallback_to_transcription,
            input_path=request.input_path,
            fast_only=request.fast_only,
        )

        # In fast_only mode, Whisper didn't run so output_dir is empty.
        output_path = "" if request.fast_only else _storage.store_outputs(output_dir, request.input_path)

        return FetchAndAlignResponse(
            status="done",
            output_path=output_path,
            segments=_to_segments(results),
            input_path=request.input_path,
            source=source,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("fetch-and-align failed", extra={"job_id": job_id})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)


handler = Mangum(app)
