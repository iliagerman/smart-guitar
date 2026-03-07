"""FastAPI application wrapping basic-pitch tab transcription.

Provides /health and /transcribe-tabs endpoints. Storage backend (local or S3)
is selected via config, initialized on startup.

Internal pipeline:
    guitar.mp3 → [audio cleaning] → [basic-pitch] → [post-processing] → [tab conversion] → [strum detection] → tabs.json
"""

import logging
import os
import shutil
import sys
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from mangum import Mangum
from pythonjsonlogger.json import JsonFormatter

from tabs_generator.audio_cleaner import clean_guitar_audio
from tabs_generator.beat_detector import detect_beats
from tabs_generator.config import get_settings
from tabs_generator.note_processor import post_process_notes
from tabs_generator.schemas import (
    RhythmInfo,
    StrumEvent,
    StrumEventResponse,
    TabNote,
    TranscribeTabsRequest,
    TranscribeTabsResponse,
)
from tabs_generator.request_context import (
    RequestContextFilter,
    RequestContextMiddleware,
)
from tabs_generator.storage import StorageBackend, create_storage
from tabs_generator.strum_detector import ChordInfo, detect_strums
from tabs_generator.tab_converter import (
    TUNING_NAMES,
    assign_fret_positions,
    write_tabs_json,
)
from tabs_generator.transcriber import transcribe_notes

logger = logging.getLogger(__name__)

_storage: StorageBackend


def _setup_logging(level: str = "INFO", service_name: str = "tabs-generator") -> None:
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
    logger.info(
        "API started: env=%s, storage=%s",
        settings.environment,
        settings.storage.backend,
    )

    yield


app = FastAPI(title="Tabs Generator API", lifespan=lifespan)
app.add_middleware(RequestContextMiddleware)


@app.get("/health")
def health():
    return {"status": "ok", "service": "tabs_generator-api"}


@app.post("/transcribe-tabs", response_model=TranscribeTabsResponse)
def transcribe_tabs(request: TranscribeTabsRequest):
    settings = get_settings()
    temp_dir = settings.processing.temp_dir
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(temp_dir, job_id)
    output_dir = os.path.join(job_dir, "output")

    os.makedirs(output_dir, exist_ok=True)

    try:
        # Check file exists
        if not _storage.file_exists(request.input_path):
            raise HTTPException(
                status_code=404, detail=f"Input file not found: {request.input_path}"
            )

        # Get local path (no-op for local storage, download for S3)
        local_input = _storage.resolve_input(request.input_path)

        logger.info(
            "Starting tab transcription",
            extra={
                "job_id": job_id,
                "input_path": request.input_path,
                "event_type": "transcription_start",
            },
        )

        # Step 1: Clean guitar audio (bandpass filter + noise gate)
        audio_cfg = settings.audio_cleaning
        if audio_cfg.enabled:
            cleaned_path = os.path.join(job_dir, "cleaned_guitar.wav")
            local_input = clean_guitar_audio(
                local_input,
                cleaned_path,
                low_cut=audio_cfg.low_cut_hz,
                high_cut=audio_cfg.high_cut_hz,
                noise_gate_db=audio_cfg.noise_gate_db,
            )

        # Step 2: Run basic-pitch note detection
        tabs_cfg = settings.tabs
        raw_notes = transcribe_notes(
            local_input,
            output_dir,
            onset_threshold=tabs_cfg.onset_threshold,
            frame_threshold=tabs_cfg.frame_threshold,
            min_confidence=tabs_cfg.min_confidence,
        )

        # Step 3: Post-process detected notes (filter artifacts, merge fragments)
        pp_cfg = settings.post_processing
        if pp_cfg.enabled:
            raw_notes = post_process_notes(
                raw_notes,
                min_duration=pp_cfg.min_duration,
                min_confidence=pp_cfg.min_confidence,
                merge_gap=pp_cfg.merge_gap,
                midi_min=pp_cfg.midi_min,
                midi_max=pp_cfg.midi_max,
                max_voices=pp_cfg.max_polyphony,
            )

        # Step 4: Assign string/fret positions
        notes = assign_fret_positions(
            raw_notes,
            tuning=tabs_cfg.tuning,
            max_fret=tabs_cfg.max_fret,
        )

        # Step 5: Detect strumming patterns (beat-aligned + onset-based)
        strum_cfg = settings.strum_detection
        strum_events: list[StrumEvent] = []
        beat_times: list[float] | None = None
        bpm: float | None = None
        if strum_cfg.enabled:
            # 5a: Read chords from storage (chords.json next to the input file)
            chord_infos: list[ChordInfo] | None = None
            chords_path = _storage.resolve_sibling(request.input_path, "chords.json")
            if chords_path:
                try:
                    raw_chords = _storage.read_json(chords_path)
                    chord_infos = [
                        ChordInfo(
                            start_time=c["start_time"],
                            end_time=c["end_time"],
                            chord=c["chord"],
                        )
                        for c in raw_chords
                    ]
                    logger.info("Loaded %d chords from storage", len(chord_infos))
                except Exception:
                    logger.warning(
                        "Failed to read chords.json, falling back to onset-only",
                        exc_info=True,
                    )

            # 5b: Detect beats from the guitar audio
            try:
                bpm, beat_times = detect_beats(local_input)
            except Exception:
                logger.warning(
                    "Beat detection failed, continuing without beat grid", exc_info=True
                )

            # 5c: Generate strumming patterns
            notes, strum_events = detect_strums(
                notes,
                min_onset_spread_ms=strum_cfg.min_onset_spread_ms,
                full_confidence_spread_ms=strum_cfg.full_confidence_spread_ms,
                min_strum_confidence=strum_cfg.min_strum_confidence,
                min_chord_size=strum_cfg.min_chord_size,
                chords=chord_infos,
                beat_times=beat_times,
                bpm=bpm or 120.0,
            )

        # Step 6: Write tabs.json (notes + strum events)
        rhythm = None
        if bpm is not None and beat_times:
            rhythm = {
                "bpm": round(float(bpm), 3),
                "beat_times": [round(float(t), 6) for t in beat_times],
            }

        write_tabs_json(
            notes,
            output_dir,
            strum_events=strum_events or None,
            rhythm=rhythm,
        )

        # Store outputs alongside the input file (same song directory)
        output_path = _storage.store_outputs(output_dir, request.input_path)

        # Build response
        tab_notes = [
            TabNote(
                start_time=n.start_time,
                end_time=n.end_time,
                string=n.string,
                fret=n.fret,
                midi_pitch=n.midi_pitch,
                confidence=n.confidence,
                strum_id=n.strum_id,
            )
            for n in notes
        ]

        strum_responses = [
            StrumEventResponse(
                id=s.id,
                start_time=s.start_time,
                end_time=s.end_time,
                direction=s.direction,
                confidence=s.confidence,
                num_strings=s.num_strings,
                onset_spread_ms=s.onset_spread_ms,
            )
            for s in strum_events
        ]

        rhythm_resp = None
        if rhythm:
            rhythm_resp = RhythmInfo(**rhythm)

        return TranscribeTabsResponse(
            status="done",
            output_path=output_path,
            tuning=TUNING_NAMES,
            notes=tab_notes,
            strums=strum_responses,
            rhythm=rhythm_resp,
            input_path=request.input_path,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "Tab transcription failed",
            extra={"job_id": job_id, "event_type": "transcription_failed"},
        )
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)
            logger.info("Cleaned up temp dir: %s", job_dir)


handler = Mangum(app)
