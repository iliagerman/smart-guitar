"""FastAPI application wrapping autochord chord recognition.

Provides /health and /recognize endpoints. Storage backend (local or S3)
is selected via config, initialized on startup.
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

from chords_generator.config import get_settings
from chords_generator.recognizer import recognize_chords
from chords_generator.request_context import RequestContextFilter, RequestContextMiddleware
from chords_generator.schemas import ChordInfo, RecognizeRequest, RecognizeResponse
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


handler = Mangum(app)
