"""Job endpoints."""

import logging
import uuid

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from guitar_player.auth.dependencies import get_current_user
from guitar_player.auth.schemas import CurrentUser
from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.dependencies import get_job_service, get_processing_service
from guitar_player.database import safe_session
from guitar_player.dependencies import get_storage
from guitar_player.schemas.job import CreateJobRequest, JobResponse
from guitar_player.services.job_service import JobService
from guitar_player.services.processing_service import ProcessingService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("", response_model=JobResponse)
async def create_job(
    body: CreateJobRequest,
    user: CurrentUser = Depends(get_current_user),
    job_service: JobService = Depends(get_job_service),
    processing: ProcessingService = Depends(get_processing_service),
) -> JobResponse:
    return await job_service.create_and_process_job(
        user_sub=user.sub,
        user_email=user.email,
        song_id=body.song_id,
        descriptions=body.descriptions,
        mode=body.mode,
        processing=processing,
    )


def _job_status_manifest_key(song_name: str, job_id: uuid.UUID) -> str:
    # Job-scoped manifest to avoid races when a user retries a song.
    return f"{song_name}/jobs/{job_id}/job_status.json"


@router.get("/{job_id}/status-url")
async def get_job_status_url(
    job_id: uuid.UUID,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
) -> JSONResponse:
    """Return a URL the client can poll for artifact-based progress.

    In prod (S3 backend), this is a presigned S3 GET URL to job_status.json.
    In local dev (LocalStorage), this is a backend URL that serves the manifest.
    """

    storage = get_storage()

    async with safe_session() as session:
        user_dao = UserDAO(session)
        job_dao = JobDAO(session)

        db_user = await user_dao.get_by_cognito_sub(user.sub)
        job = await job_dao.get_by_id(job_id)
        if not db_user or not job or job.user_id != db_user.id:
            # Hide whether the job exists.
            return JSONResponse(status_code=404, content={"detail": "Job not found"})

        # Resolve song_name (manifest lives under song prefix).
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(job.song_id)
        if not song or not song.song_name:
            return JSONResponse(status_code=404, content={"detail": "Song not found"})

        key = _job_status_manifest_key(song.song_name, job_id)

    # S3Storage.get_url returns a presigned S3 URL; LocalStorage.get_url returns a file path
    # which is not reachable from the browser. For local, return a backend URL instead.
    storage_url = storage.get_url(key)
    if storage_url.startswith("/") or storage_url.startswith("file:"):
        url = str(request.url_for("get_job_status_manifest", job_id=str(job_id)))
    else:
        url = storage_url

    return JSONResponse(
        status_code=200,
        content={
            "job_id": str(job_id),
            "manifest_key": key,
            "url": url,
        },
    )


@router.get("/{job_id}/status-manifest", name="get_job_status_manifest")
async def get_job_status_manifest(
    job_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
) -> JSONResponse:
    """Serve the current job_status.json manifest from storage.

    This endpoint exists primarily for local dev (LocalStorage). In prod, clients
    should use the presigned S3 URL returned by /status-url.
    """

    storage = get_storage()

    async with safe_session() as session:
        user_dao = UserDAO(session)
        job_dao = JobDAO(session)

        db_user = await user_dao.get_by_cognito_sub(user.sub)
        job = await job_dao.get_by_id(job_id)
        if not db_user or not job or job.user_id != db_user.id:
            return JSONResponse(status_code=404, content={"detail": "Job not found"})

        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(job.song_id)
        if not song or not song.song_name:
            return JSONResponse(status_code=404, content={"detail": "Song not found"})

        key = _job_status_manifest_key(song.song_name, job_id)

    try:
        data = storage.read_json(key)
    except FileNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "Manifest not found"})
    except Exception as e:
        logger.warning("Failed to read status manifest for %s: %s", job_id, e)
        return JSONResponse(
            status_code=500, content={"detail": "Failed to read manifest"}
        )

    # Ensure valid JSON response.
    return JSONResponse(status_code=200, content=data)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    job_service: JobService = Depends(get_job_service),
) -> JobResponse:
    return await job_service.get_job(job_id)


@router.get("", response_model=list[JobResponse])
async def list_jobs(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    job_service: JobService = Depends(get_job_service),
) -> list[JobResponse]:
    return await job_service.list_user_jobs(user.sub, offset, limit)
