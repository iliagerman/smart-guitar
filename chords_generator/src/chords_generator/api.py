"""FastAPI application wrapping autochord chord recognition.

Provides /health and /recognize endpoints. Storage backend (local or S3)
is selected via config, initialized on startup.
"""

import json
import logging
import os
import shutil
import sys
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from mangum import Mangum
from pythonjsonlogger.json import JsonFormatter

from chords_generator.bass_detect import detect_bass_for_chords
from chords_generator.beat_align import detect_beats, snap_chords_to_beats
from chords_generator.config import get_settings
from chords_generator.observability import instrument_runtime_observer
from chords_generator.recognizer import recognize_chords
from chords_generator.request_context import RequestContextFilter, RequestContextMiddleware
from chords_generator.simplifier import generate_simplified_options, write_simplified_outputs
from chords_generator.schemas import (
    ChordInfo,
    ChordResult,
    DetectBassRequest,
    DetectBassResponse,
    EnhanceRequest,
    EnhanceResponse,
    RecognizeRequest,
    RecognizeResponse,
)
from chords_generator.storage import StorageBackend, create_storage

logger = logging.getLogger(__name__)

_storage: StorageBackend


def _setup_logging(level: str = "INFO", service_name: str = "chords-generator") -> None:
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


app = FastAPI(title="Chords Generator API", lifespan=lifespan)
instrument_runtime_observer(app, service_name="chords-generator")
app.add_middleware(RequestContextMiddleware)


@app.get("/health")
def health():
    return {"status": "ok", "service": "chords_generator-api"}


@app.post("/recognize", response_model=RecognizeResponse)
def recognize(request: RecognizeRequest):
    settings = get_settings()
    temp_dir = settings.processing.temp_dir
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(temp_dir, job_id)
    output_dir = os.path.join(job_dir, "output")

    os.makedirs(output_dir, exist_ok=True)

    try:
        # Check file exists
        if not _storage.file_exists(request.input_path):
            raise HTTPException(status_code=404, detail=f"Input file not found: {request.input_path}")

        # Get local path (no-op for local storage, download for S3)
        local_input = _storage.resolve_input(request.input_path)

        # Run chord recognition
        logger.info("Starting chord recognition", extra={"job_id": job_id, "input_path": request.input_path, "event_type": "recognition_start"})
        results = recognize_chords(local_input, output_dir)

        # Store outputs alongside the input file (same song directory)
        output_path = _storage.store_outputs(output_dir, request.input_path)

        # Build chord list from recognition results
        chords = [
            ChordInfo(start_time=r.start_time, end_time=r.end_time, chord=r.chord)
            for r in results
        ]

        return RecognizeResponse(
            status="done",
            output_path=output_path,
            chords=chords,
            input_path=request.input_path,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Chord recognition failed", extra={"job_id": job_id, "event_type": "recognition_failed"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)
            logger.info("Cleaned up temp dir: %s", job_dir)


@app.post("/detect-bass", response_model=DetectBassResponse)
def detect_bass(request: DetectBassRequest):
    """Annotate an existing chords.json with slash bass notes from the bass stem.

    Reads the chords file and bass stem, estimates the sounding bass note per
    chord, writes the annotated chords.json back in place, and returns it.
    """
    settings = get_settings()
    job_dir = os.path.join(settings.processing.temp_dir, str(uuid.uuid4()))
    os.makedirs(job_dir, exist_ok=True)
    try:
        if not _storage.file_exists(request.bass_path):
            raise HTTPException(status_code=404, detail=f"Bass stem not found: {request.bass_path}")
        if not _storage.file_exists(request.chords_path):
            raise HTTPException(status_code=404, detail=f"Chords not found: {request.chords_path}")

        local_bass = _storage.resolve_input(request.bass_path)
        local_chords = _storage.resolve_input(request.chords_path)
        with open(local_chords) as f:
            raw = json.load(f)

        chord_results = [
            ChordResult(
                start_time=c["start_time"], end_time=c["end_time"],
                chord=c["chord"], bass=c.get("bass"),
            )
            for c in raw
        ]
        annotated = detect_bass_for_chords(local_bass, chord_results)

        out_path = os.path.join(job_dir, "chords.json")
        with open(out_path, "w") as f:
            json.dump(
                [
                    {
                        "start_time": c.start_time, "end_time": c.end_time,
                        "chord": c.chord, "bass": c.bass,
                    }
                    for c in annotated
                ],
                f, indent=2,
            )
        _storage.store_outputs(job_dir, request.chords_path)

        chords = [
            ChordInfo(start_time=c.start_time, end_time=c.end_time, chord=c.chord, bass=c.bass)
            for c in annotated
        ]
        logger.info(
            "Bass detection done: %d chords (%d with slash bass)",
            len(chords), sum(1 for c in chords if c.bass),
            extra={"event_type": "detect_bass_done", "chords_path": request.chords_path},
        )
        return DetectBassResponse(chords=chords, chords_path=request.chords_path)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Bass detection failed", extra={"event_type": "detect_bass_failed"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)


@app.post("/enhance", response_model=EnhanceResponse)
def enhance(request: EnhanceRequest):
    """Enhance an existing chords.json in place: snap chord changes to the
    detected beat grid and (if a bass stem is given) add slash bass notes.

    Operates on the already-recognized chords — it does NOT re-run autochord or
    demucs — so it's a cheap way to back-fill beat alignment + slash bass.
    """
    settings = get_settings()
    job_dir = os.path.join(settings.processing.temp_dir, str(uuid.uuid4()))
    os.makedirs(job_dir, exist_ok=True)
    try:
        if not _storage.file_exists(request.chords_path):
            raise HTTPException(status_code=404, detail=f"Chords not found: {request.chords_path}")
        if not _storage.file_exists(request.audio_path):
            raise HTTPException(status_code=404, detail=f"Audio not found: {request.audio_path}")

        local_chords = _storage.resolve_input(request.chords_path)
        with open(local_chords) as f:
            raw = json.load(f)
        chord_results = [
            ChordResult(
                start_time=c["start_time"], end_time=c["end_time"],
                chord=c["chord"], bass=c.get("bass"),
            )
            for c in raw
        ]

        # Beat-align the existing chords.
        local_audio = _storage.resolve_input(request.audio_path)
        beats, bpm = detect_beats(local_audio)
        if beats:
            chord_results = snap_chords_to_beats(chord_results, beats)

        # Slash bass (optional — needs the separated bass stem).
        bass_count = 0
        if request.bass_path and _storage.file_exists(request.bass_path):
            local_bass = _storage.resolve_input(request.bass_path)
            chord_results = detect_bass_for_chords(local_bass, chord_results)
            bass_count = sum(1 for c in chord_results if c.bass)

        out_path = os.path.join(job_dir, "chords.json")
        with open(out_path, "w") as f:
            json.dump(
                [
                    {
                        "start_time": c.start_time, "end_time": c.end_time,
                        "chord": c.chord, "bass": c.bass,
                    }
                    for c in chord_results
                ],
                f, indent=2,
            )

        # Regenerate the simplified difficulty variants from the enhanced
        # chords, so beginner/capo sheets carry the same beat-aligned timing.
        options = generate_simplified_options(chord_results)
        write_simplified_outputs(options, job_dir)

        _storage.store_outputs(job_dir, request.chords_path)

        chords = [
            ChordInfo(start_time=c.start_time, end_time=c.end_time, chord=c.chord, bass=c.bass)
            for c in chord_results
        ]
        logger.info(
            "Enhance done: %d chords, %d beats, %d slash-bass, %d variants",
            len(chords), len(beats), bass_count, len(options["options"]),
            extra={"event_type": "enhance_done", "chords_path": request.chords_path},
        )
        return EnhanceResponse(
            chords=chords, chords_path=request.chords_path,
            beats_detected=len(beats), bass_count=bass_count,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Enhance failed", extra={"event_type": "enhance_failed"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)


handler = Mangum(app)
