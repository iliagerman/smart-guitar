"""Vocals+guitar stitch Lambda.

Payload:
  {
    "song_name": "...",
    "vocals_key": ".../vocals.mp3",
    "guitar_key": ".../guitar.mp3",
    "request_id": "<uuid>"
  }

Idempotent: if {song_name}/vocals_guitar.mp3 exists, returns SKIPPED.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from guitar_player.app_state import get_storage
from guitar_player.lambdas.runtime import init_runtime
from guitar_player.request_context import request_id_var, user_id_var

logger = logging.getLogger(__name__)


async def _run(song_name: str, vocals_key: str, guitar_key: str) -> dict[str, Any]:
    storage = get_storage()

    out_key = f"{song_name}/vocals_guitar.mp3"
    if storage.file_exists(out_key):
        return {"ok": True, "status": "SKIPPED", "output_key": out_key}

    from guitar_player.services.audio_merge import merge_vocals_guitar_stem

    result = await merge_vocals_guitar_stem(storage, song_name, vocals_key, guitar_key)
    if not result:
        return {"ok": False, "status": "FAILED", "error": "merge_failed"}

    return {"ok": True, "status": "COMPLETED", "output_key": result}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    init_runtime(service_name="vocals-guitar-stitch")

    # Propagate correlation ID from the calling service.
    rid = (event or {}).get("request_id") or str(uuid.uuid4())
    request_id_var.set(rid)

    uid = (event or {}).get("user_id", "")
    if uid:
        user_id_var.set(uid)

    song_name = (event or {}).get("song_name")
    vocals_key = (event or {}).get("vocals_key")
    guitar_key = (event or {}).get("guitar_key")

    if not song_name or not vocals_key or not guitar_key:
        logger.error("Bad event", extra={"event_type": "bad_event", "event": event})
        return {"ok": False, "error": "bad_event"}

    logger.info(
        "Stitch invoked",
        extra={
            "event_type": "stitch_invoke",
            "song_name": song_name,
            "vocals_key": vocals_key,
            "guitar_key": guitar_key,
        },
    )

    try:
        return asyncio.run(_run(str(song_name), str(vocals_key), str(guitar_key)))
    except Exception:
        logger.exception(
            "Stitch failed for %s",
            song_name,
            extra={"event_type": "stitch_error", "song_name": song_name},
        )
        return {"ok": False, "status": "FAILED", "error": "stitch_exception"}
