"""FastAPI application wrapping Demucs audio separation.

Provides /health and /separate endpoints. Storage backend (local or S3)
is selected via config, initialized on startup.
"""

import logging
import os
import shutil
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from mangum import Mangum
from pythonjsonlogger.json import JsonFormatter

from inference_demucs.config import get_settings
from inference_demucs.request_context import RequestContextFilter, RequestContextMiddleware
from inference_demucs.schemas import SeparateRequest, SeparateResponse, StemInfo
from inference_demucs.separator import produce_test_outputs
from inference_demucs.storage import LocalStorage, StorageBackend, create_storage

logger = logging.getLogger(__name__)

# Maps requested output names to the actual filenames produced by the separator.
_OUTPUT_TO_FILENAME: dict[str, str] = {
    "guitar_isolated": "guitar.mp3",
    "vocals_isolated": "vocals.mp3",
    "guitar_removed": "guitar_removed.mp3",
    "vocals_removed": "vocals_removed.mp3",
}

_storage: StorageBackend


def _setup_logging(level: str = "INFO", service_name: str = "inference-demucs") -> None:
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


app = FastAPI(title="Inference Demucs API", lifespan=lifespan)
app.add_middleware(RequestContextMiddleware)


@app.get("/health")
def health():
    settings = get_settings()
    return {"status": "ok", "model": settings.demucs.model_name}


@app.post("/separate", response_model=SeparateResponse)
def separate(request: SeparateRequest):
    settings = get_settings()
    temp_dir = settings.processing.temp_dir
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(temp_dir, job_id)
    output_dir = os.path.join(job_dir, "output")

    # Track extra temp paths that should be deleted on completion.
    # (job_dir is handled separately below)
    extra_cleanup_dirs: list[str] = []

    os.makedirs(output_dir, exist_ok=True)

    try:
        # Check file exists
        if not _storage.file_exists(request.input_path):
            raise HTTPException(
                status_code=404, detail=f"Input file not found: {request.input_path}"
            )

        input_parent = Path(request.input_path).parent
        output_name = str(Path(input_parent.parent.name) / input_parent.name)
        requested = (
            set(request.requested_outputs)
            if request.requested_outputs
            else set(_OUTPUT_TO_FILENAME)
        )

        # We always preserve the 6 raw stems (vocals/drums/bass/guitar/piano/other).
        # Additionally, we may create derived mixes depending on requested outputs.
        raw_stem_filenames = {
            "vocals.mp3",
            "drums.mp3",
            "bass.mp3",
            "guitar.mp3",
            "piano.mp3",
            "other.mp3",
        }
        required_filenames = set(raw_stem_filenames)
        for output_name_key in requested:
            filename = _OUTPUT_TO_FILENAME.get(output_name_key)
            if filename:
                required_filenames.add(filename)

        # Check if output files already exist in storage
        existing_stems: list[StemInfo] = []
        for filename in sorted(required_filenames):
            candidate = str(input_parent / filename)
            if _storage.file_exists(candidate):
                existing_stems.append(
                    StemInfo(name=Path(filename).stem, path=candidate)
                )

        if len(existing_stems) == len(required_filenames):
            logger.info(
                "All outputs already exist for job=%s, skipping separation", job_id
            )
            return SeparateResponse(
                status="done",
                output_path=str(input_parent),
                stems=existing_stems,
                input_path=request.input_path,
            )

        # Resolve input to a local temp path.
        #
        # Rationale:
        # - In local dev, work off a temp copy so we don't touch files in-place
        #   under local_bucket while Demucs is running.
        # - In S3 mode, ensure we also clean up the downloaded temp dir.
        if isinstance(_storage, LocalStorage):
            input_dir = os.path.join(job_dir, "input")
            os.makedirs(input_dir, exist_ok=True)
            local_input = os.path.join(input_dir, os.path.basename(request.input_path))
            shutil.copy2(request.input_path, local_input)
        else:
            local_input = _storage.resolve_input(request.input_path)
            # S3Storage.resolve_input currently creates a temp directory under the
            # configured temp_dir. Clean it up alongside the job directory.
            try:
                parent = str(Path(local_input).parent)
                if parent.startswith(str(Path(temp_dir))) and Path(
                    parent
                ).name.startswith("input_"):
                    extra_cleanup_dirs.append(parent)
            except Exception:
                # Best-effort only; never fail the request because cleanup detection failed.
                pass

        # Run separation
        logger.info("Starting separation", extra={"job_id": job_id, "input_path": request.input_path, "event_type": "separation_start"})
        produce_test_outputs(local_input, output_dir, requested_outputs=requested)

        # Store outputs alongside the input: bucket/artist/song_name/
        output_path = _storage.store_outputs(output_dir, output_name)

        # Build stem list from files we expect to exist.
        stems: list[StemInfo] = []
        for filename in sorted(required_filenames):
            candidate = os.path.join(output_path, filename)
            if _storage.file_exists(candidate):
                stems.append(StemInfo(name=Path(filename).stem, path=candidate))

        return SeparateResponse(
            status="done",
            output_path=output_path,
            stems=stems,
            input_path=request.input_path,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Separation failed", extra={"job_id": job_id, "event_type": "separation_failed"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if settings.processing.cleanup_temp:
            # Clean per-job temp folder first.
            if os.path.exists(job_dir):
                shutil.rmtree(job_dir, ignore_errors=True)
                logger.info("Cleaned up temp dir: %s", job_dir)

            # Clean any additional temp dirs created by storage backends.
            for d in dict.fromkeys(extra_cleanup_dirs):
                if os.path.exists(d):
                    shutil.rmtree(d, ignore_errors=True)
                    logger.info("Cleaned up temp dir: %s", d)


# Lambda handler
handler = Mangum(app)
