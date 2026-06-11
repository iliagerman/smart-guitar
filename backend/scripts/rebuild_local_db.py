"""Wipe the local database and rebuild the song catalog from local_bucket.

Steps:
  1. Drop all tables, run alembic migrations from scratch.
  2. Create the default local user.
  3. Discover every song directory in the bucket (old and new layouts),
     resolve title/artist/genre (seed catalog > matched online metadata >
     prettified folder names), and create Song rows.
  4. Run storage-key discovery to populate all artifact keys.
  5. Compute duration_seconds for each song via ffprobe.

Usage:
    cd backend && APP_ENV=local uv run python scripts/rebuild_local_db.py [--yes]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine

from guitar_player.config import load_settings
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.models import Base
from guitar_player.services.bucket_catalog import discover_song_dirs, resolve_metadata
from guitar_player.services.seed_service import seed_discover_storage_keys
from guitar_player.services.sync_service import ensure_default_user
from guitar_player.storage import create_storage

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("rebuild_local_db")

DEFAULT_LOCAL_EMAIL = "iliagerman@gmail.com"
SEED_SONGS_PATH = (
    Path(__file__).resolve().parent.parent
    / "src" / "guitar_player" / "services" / "seed_songs.json"
)


def wipe_and_migrate(db_url: str) -> None:
    """Drop all tables (incl. alembic_version) and re-run migrations."""
    sync_url = db_url.replace("+aiosqlite", "").replace("+asyncpg", "")
    engine = create_engine(sync_url)
    logger.info("Dropping all tables on %s", sync_url.split("@")[-1])
    Base.metadata.drop_all(engine)
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
    engine.dispose()

    logger.info("Running alembic upgrade head")
    subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=Path(__file__).resolve().parent.parent,
        check=True,
    )


def probe_duration(audio_path: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(audio_path)],
            capture_output=True, text=True, timeout=30, check=True,
        )
        return round(float(out.stdout.strip()), 1)
    except Exception:
        return None


async def rebuild(yes: bool) -> None:
    settings = load_settings()
    db_url = settings.db.url
    if not db_url:
        logger.error("No db.url configured for this APP_ENV")
        sys.exit(1)

    base_path = Path(settings.storage.base_path or "../local_bucket").resolve()
    if not base_path.is_dir():
        logger.error("Bucket directory not found: %s", base_path)
        sys.exit(1)

    if not yes:
        answer = input(
            f"This will WIPE the database at {db_url.split('@')[-1]} "
            f"and rebuild from {base_path}. Type 'yes' to continue: "
        )
        if answer.strip().lower() != "yes":
            logger.info("Aborted")
            return

    wipe_and_migrate(db_url)

    with open(SEED_SONGS_PATH) as f:
        seed_index = {s["song_name"]: s for s in json.load(f)}
    logger.info("Loaded %d seed catalog entries", len(seed_index))

    discovered = discover_song_dirs(base_path)
    logger.info("Discovered %d song directories in %s", len(discovered), base_path)

    factory = init_db(settings)
    storage = create_storage(settings)
    storage.init()

    async with factory() as session:
        await ensure_default_user(session, DEFAULT_LOCAL_EMAIL)
        await session.commit()

    created = 0
    used_youtube_ids: set[str] = set()
    async with factory() as session:
        dao = SongDAO(session)
        for d in discovered:
            title, artist, genre = resolve_metadata(base_path, d.song_name, seed_index)
            ytid = d.youtube_id if d.youtube_id not in used_youtube_ids else None
            if ytid:
                used_youtube_ids.add(ytid)
            await dao.create(
                title=title,
                artist=artist,
                genre=genre,
                song_name=d.song_name,
                youtube_id=ytid,
                audio_key=f"{d.song_name}/audio.mp3",
            )
            created += 1
            if created % 200 == 0:
                await session.commit()
                logger.info("Created %d/%d songs", created, len(discovered))
        await session.commit()
    logger.info("Created %d song rows", created)

    async with factory() as session:
        async for progress in seed_discover_storage_keys(session, storage):
            if isinstance(progress, str):
                logger.info(progress)
        await session.commit()

    # Durations via ffprobe (concurrent, bounded).
    sem = asyncio.Semaphore(8)

    async def fill_duration(song_id, song_name: str) -> None:
        audio = base_path / song_name / "audio.mp3"
        if not audio.is_file():
            return
        async with sem:
            duration = await asyncio.to_thread(probe_duration, audio)
        if duration:
            async with factory() as s:
                await SongDAO(s).update_by_id(song_id, duration_seconds=duration)
                await s.commit()

    async with factory() as session:
        songs = await SongDAO(session).get_all_songs()
    await asyncio.gather(*(fill_duration(s.id, s.song_name) for s in songs if s.song_name))
    logger.info("Durations filled for %d songs", len(songs))

    await close_db()
    logger.info("Rebuild complete: %d songs cataloged", created)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()
    asyncio.run(rebuild(args.yes))


if __name__ == "__main__":
    main()
