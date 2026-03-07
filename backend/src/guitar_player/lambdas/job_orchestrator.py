"""Job orchestrator Lambda.

Invoked asynchronously (InvocationType=Event) by the backend.

Payload:
  { "job_id": "<uuid>", "request_id": "<uuid>" }

This Lambda reuses the existing pipeline implemented in
`guitar_player.services.job_service._process_job`.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from guitar_player.lambdas.runtime import init_runtime
from guitar_player.request_context import request_id_var, user_id_var

logger = logging.getLogger(__name__)


async def _run(job_id: uuid.UUID) -> None:
    from guitar_player.services.job_service import _process_job

    await _process_job(job_id)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    init_runtime(service_name="job-orchestrator")

    # Propagate correlation ID from the calling service.
    rid = (event or {}).get("request_id") or str(uuid.uuid4())
    request_id_var.set(rid)

    uid = (event or {}).get("user_id", "")
    if uid:
        user_id_var.set(uid)

    raw = (event or {}).get("job_id")
    if not raw:
        logger.error(
            "Missing job_id", extra={"event_type": "bad_event", "event": event}
        )
        return {"ok": False, "error": "missing_job_id"}

    try:
        job_id = uuid.UUID(str(raw))
    except Exception:
        logger.error("Invalid job_id", extra={"event_type": "bad_event", "job_id": raw})
        return {"ok": False, "error": "invalid_job_id"}

    logger.info(
        "Orchestrator invoked",
        extra={"event_type": "orchestrator_invoke", "job_id": str(job_id)},
    )

    try:
        asyncio.run(_run(job_id))
    except Exception:
        logger.exception(
            "Orchestrator failed for job %s",
            job_id,
            extra={"event_type": "orchestrator_error", "job_id": str(job_id)},
        )
        return {"ok": False, "error": "orchestrator_failed", "job_id": str(job_id)}

    return {"ok": True, "job_id": str(job_id)}
