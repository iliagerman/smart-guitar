"""Seed the database with dummy songs for UI testing.

Usage:
    cd backend && APP_ENV=local uv run python scripts/seed_db.py
"""

import asyncio
import logging

from guitar_player.config import load_settings
from guitar_player.database import init_db, close_db
from guitar_player.services.seed_service import seed_db_catalog, seed_update_metadata
from guitar_player.services.sync_service import ensure_default_user

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_LOCAL_EMAIL = "iliagerman@gmail.com"


async def main() -> None:
    settings = load_settings()
    session_factory = init_db(settings)

    async with session_factory() as session:
        user = await ensure_default_user(session, DEFAULT_LOCAL_EMAIL)

        created = await seed_db_catalog(session, user)
        enriched = await seed_update_metadata(session, user)
        await session.commit()
        logger.info(
            "Done. Created %d seed songs, enriched %d seed songs.", created, enriched
        )

    await close_db()


if __name__ == "__main__":
    asyncio.run(main())
