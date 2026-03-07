"""Backfill genre for existing songs that have genre=NULL.

Queries all songs where genre IS NULL, calls the LLM service to classify
the genre from the song title, and updates the DB in batches.

Usage:
    cd backend && APP_ENV=local uv run python scripts/backfill_genres.py
"""

import asyncio
import logging

from guitar_player.config import load_settings
from guitar_player.database import init_db, close_db
from guitar_player.services.llm_service import LlmService

from sqlalchemy import select, update
from guitar_player.models.song import Song

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BATCH_SIZE = 20


async def main() -> None:
    settings = load_settings()
    session_factory = init_db(settings)
    llm = LlmService(settings)

    async with session_factory() as session:
        # Find all songs without a genre
        stmt = select(Song).where(Song.genre.is_(None))
        result = await session.execute(stmt)
        songs = result.scalars().all()

        logger.info("Found %d songs without genre", len(songs))

        updated = 0
        for i, song in enumerate(songs):
            try:
                parsed = await llm.parse_song_name(song.title)
                genre = parsed.genre

                stmt = (
                    update(Song)
                    .where(Song.id == song.id)
                    .values(genre=genre)
                )
                await session.execute(stmt)
                updated += 1
                logger.info(
                    "[%d/%d] %s -> %s", i + 1, len(songs), song.title, genre
                )
            except Exception as e:
                logger.warning(
                    "[%d/%d] Failed to classify %s: %s",
                    i + 1, len(songs), song.title, e,
                )

            # Commit in batches
            if updated % BATCH_SIZE == 0 and updated > 0:
                await session.commit()
                logger.info("Committed batch (%d total)", updated)

        # Final commit
        if updated % BATCH_SIZE != 0:
            await session.commit()

        logger.info("Done. Updated %d/%d songs.", updated, len(songs))

    await close_db()


if __name__ == "__main__":
    asyncio.run(main())
