"""Mark muted DDUUDU strums as chucks in stored songsterr_data.json.

Usage:
    cd backend && APP_ENV=prod uv run python scripts/backfill_strum_chucks.py
"""

import asyncio
import logging
import os
from typing import Any

from sqlalchemy import select

from guitar_player.config import load_settings
from guitar_player.database import close_db, init_db
from guitar_player.models.song import Song
from guitar_player.storage import StorageBackend, create_storage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DDUUDU = ["down", "down", "up", "up", "down", "up"]


def _mentions_chuck(notes: str) -> bool:
    normalized = notes.lower().replace("-", " ").replace("'", "")
    has_muted_second_down = "second down" in normalized and (
        "chuck" in normalized or "muted" in normalized or "percuss" in normalized
    )
    has_dduudu = "dduudu" in normalized or "d d u u d u" in normalized
    return has_muted_second_down and has_dduudu


def _patch_pattern(pattern: Any) -> bool:
    if pattern == DDUUDU:
        pattern[1] = "chuck"
        return True
    return False


def _patch_songsterr_data(data: dict[str, Any]) -> bool:
    if not _mentions_chuck(str(data.get("strum_notes") or "")):
        return False

    changed = False
    for section in data.get("sections") or []:
        changed = _patch_pattern(section.get("strum_pattern")) or changed
        changed = _patch_pattern(section.get("llm_pattern")) or changed
    return changed


def _patch_key(storage: StorageBackend, key: str) -> bool:
    data = storage.read_json(key)
    if not isinstance(data, dict) or not _patch_songsterr_data(data):
        return False
    storage.write_json(key, data)
    return True


async def _backfill_from_db(storage: StorageBackend) -> tuple[int, int]:
    session_factory = init_db(load_settings())
    scanned = 0
    updated = 0
    async with session_factory() as session:
        result = await session.execute(
            select(Song.title, Song.artist, Song.external_strums_key).where(
                Song.external_strums_key.isnot(None),
            ),
        )
        for title, artist, key in result.all():
            scanned += 1
            if not storage.file_exists(key) or not _patch_key(storage, key):
                continue
            updated += 1
            logger.info("Updated %s — %s (%s)", artist, title, key)
    await close_db()
    return scanned, updated


def _backfill_from_storage(storage: StorageBackend) -> tuple[int, int]:
    keys = [key for key in storage.list_files("") if key.endswith("/songsterr_data.json")]
    updated = 0
    for key in keys:
        if _patch_key(storage, key):
            updated += 1
            logger.info("Updated %s", key)
    return len(keys), updated


async def main() -> None:
    settings = load_settings()
    storage = create_storage(settings)
    storage.init()

    if os.environ.get("BACKFILL_STRUM_SCAN_STORAGE") == "1":
        scanned, updated = _backfill_from_storage(storage)
    else:
        scanned, updated = await _backfill_from_db(storage)

    logger.info("Done. Scanned %d songs, updated %d.", scanned, updated)


if __name__ == "__main__":
    asyncio.run(main())
