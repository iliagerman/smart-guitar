"""S3/local manifest used by the frontend to track job progress.

The frontend polls a presigned URL (or a backend proxy endpoint in local dev)
for a single object: job_status.json.

Key format (job-scoped):
  {song_name}/jobs/{job_id}/job_status.json

This file is intentionally simple and permissive: it should be safe to evolve
without breaking older clients.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)


def job_status_manifest_key(song_name: str, job_id: uuid.UUID) -> str:
    return f"{song_name}/jobs/{job_id}/job_status.json"


# Best-effort throttling to avoid writing to storage too frequently.
# (Applies within one process / one Lambda container.)
_last_write_ts: dict[uuid.UUID, float] = {}
_last_payload_hash: dict[uuid.UUID, int] = {}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_job_status_manifest(
    storage: StorageBackend,
    *,
    song_name: str,
    job_id: uuid.UUID,
    song_id: uuid.UUID | None = None,
    status: str,
    stage: str | None,
    progress: int | None,
    error_message: str | None = None,
    extra: dict[str, Any] | None = None,
    min_interval_s: float = 3.0,
) -> str:
    """Write (overwrite) job_status.json and return its storage key.

    This function is safe to call often; it throttles writes by time and by
    payload hash.
    """

    key = job_status_manifest_key(song_name, job_id)

    now_ts = time.monotonic()
    last_ts = _last_write_ts.get(job_id)

    payload: dict[str, Any] = {
        "schema_version": 1,
        "job_id": str(job_id),
        "song_id": str(song_id) if song_id else None,
        "song_name": song_name,
        "status": status,
        "stage": stage,
        "progress": progress,
        "updated_at": _utcnow_iso(),
        "error_message": error_message,
    }
    if extra:
        payload.update(extra)

    payload_hash = hash(json.dumps(payload, sort_keys=True, ensure_ascii=False))
    if last_ts is not None and (now_ts - last_ts) < min_interval_s:
        # Still allow an immediate write if the payload actually changed.
        if _last_payload_hash.get(job_id) == payload_hash:
            return key

    # Write via a temp file so we can reuse StorageBackend.upload_file.
    tmp_dir = tempfile.mkdtemp(prefix="job_manifest_")
    tmp_path = os.path.join(tmp_dir, "job_status.json")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)

        storage.upload_file(tmp_path, key)
        _last_write_ts[job_id] = now_ts
        _last_payload_hash[job_id] = payload_hash
        return key
    finally:
        try:
            import shutil

            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            logger.debug("Failed to cleanup temp dir for manifest", exc_info=True)
