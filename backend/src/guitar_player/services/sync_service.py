"""Local bucket sync — scans local_bucket/{artist}/{song_name}/ and upserts into DB."""

import logging
import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.job_dao import JobDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.schemas.records import UserRecord

logger = logging.getLogger(__name__)

STEM_FILE_NAMES = {
    "vocals.mp3",
    "vocals_isolated.mp3",
    "drums.mp3",
    "bass.mp3",
    "guitar.mp3",
    "guitar_isolated.mp3",
    "piano.mp3",
    "other.mp3",
    "vocals_removed.mp3",
    "guitar_removed.mp3",
    "vocals_guitar.mp3",
}

# Only stems we keep and expose in the app.
STEM_KEYS = ["vocals", "guitar", "guitar_removed", "vocals_guitar"]

SKIP_FILES = STEM_FILE_NAMES | {"chords.json", "chords.lab", ".DS_Store"}

# Simplified chord variant file prefix (chords_intermediate.json, chords_beginner.json, etc.)
_CHORD_VARIANT_PREFIX = "chords_"


def _find_original_audio(song_dir: Path) -> str | None:
    """Find the original audio file (mp3 that isn't a stem)."""
    # Prefer the canonical filename if present.
    canonical = song_dir / "audio.mp3"
    if canonical.is_file():
        return canonical.name

    candidates: list[Path] = []
    for f in song_dir.iterdir():
        if f.is_file() and f.suffix == ".mp3" and f.name not in STEM_FILE_NAMES:
            candidates.append(f)

    if not candidates:
        return None

    candidates.sort(key=lambda p: p.name)
    return candidates[0].name


def _is_chord_variant_file(name: str) -> bool:
    """Check if a filename is a simplified chord variant (e.g. chords_beginner.json)."""
    return name.startswith(_CHORD_VARIANT_PREFIX) and name.endswith(".json")


def _pretty_name(folder_name: str) -> str:
    """Convert folder name like 'knocking_on_heavens_door' to 'Knocking On Heavens Door'."""
    return folder_name.replace("_", " ").title()


async def ensure_default_user(session: AsyncSession, email: str) -> UserRecord:
    """Create the default local dev user if it doesn't exist."""
    user_dao = UserDAO(session)
    user = await user_dao.get_by_email(email)
    if user:
        return user

    user = await user_dao.create(cognito_sub=f"local-{email}", email=email)
    logger.info("Created default local user: %s", email)
    return user


async def sync_local_bucket(
    session: AsyncSession,
    base_path: str,
    default_user: UserRecord,
    *,
    remove_stale: bool = True,
) -> int:
    """Scan local_bucket/{artist}/{song_name}/ and upsert songs into DB.

    Also removes stale DB records whose directories no longer exist on disk.
    Returns the number of songs synced (new records only).
    """
    song_dao = SongDAO(session)
    job_dao = JobDAO(session)

    bucket = Path(base_path)
    if not bucket.is_dir():
        logger.warning("Local bucket not found: %s", base_path)
        return 0

    if remove_stale:
        # Remove stale DB records whose song directories are gone from disk
        all_songs = await song_dao.get_all_songs()
        stale_song_ids = []
        for song in all_songs:
            song_dir = bucket / song.song_name
            if not song_dir.is_dir():
                logger.info(
                    "Removing stale DB record: %s (directory gone)", song.song_name
                )
                stale_song_ids.append(song.id)
        if stale_song_ids:
            # Delete associated jobs first (FK constraint)
            await job_dao.delete_by_song_ids(stale_song_ids)
            await song_dao.delete_by_ids(stale_song_ids)

    synced = 0

    for artist_dir in sorted(bucket.iterdir()):
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue

        artist_folder = artist_dir.name  # e.g. "bob_dylan"

        for song_dir in sorted(artist_dir.iterdir()):
            if not song_dir.is_dir() or song_dir.name.startswith("."):
                continue

            song_folder = song_dir.name  # e.g. "knocking_on_heavens_door"
            song_name = f"{artist_folder}/{song_folder}"

            # Check if already in DB
            existing = await song_dao.get_by_song_name(song_name)

            if existing:
                # Backfill keys for files that appeared since last sync
                updates: dict = {}
                if not existing.lyrics_quick_key:
                    lq = song_dir / "lyrics_quick.json"
                    if lq.is_file():
                        updates["lyrics_quick_key"] = f"{song_name}/lyrics_quick.json"
                if not existing.lyrics_key:
                    lf = song_dir / "lyrics.json"
                    if lf.is_file():
                        updates["lyrics_key"] = f"{song_name}/lyrics.json"
                if updates:
                    await song_dao.update_by_id(existing.id, **updates)
                    logger.info("Backfilled keys for existing song: %s", song_name)
                continue

            # Find original audio
            original_audio = _find_original_audio(song_dir)
            audio_key = f"{song_name}/{original_audio}" if original_audio else None

            # Derive display names
            artist_display = _pretty_name(artist_folder)
            title = (
                original_audio.rsplit(".", 1)[0]
                if original_audio
                else _pretty_name(song_folder)
            )

            create_kwargs: dict = {
                "title": title,
                "artist": artist_display,
                "song_name": song_name,
                "audio_key": audio_key,
                "downloaded_by": default_user.id,
            }

            # Populate stem keys from existing files on disk
            for stem_name in STEM_KEYS:
                stem_file = song_dir / f"{stem_name}.mp3"
                if stem_file.is_file():
                    create_kwargs[f"{stem_name}_key"] = f"{song_name}/{stem_name}.mp3"

            # Populate chords key if chords.json exists
            chords_file = song_dir / "chords.json"
            if chords_file.is_file():
                create_kwargs["chords_key"] = f"{song_name}/chords.json"

            # Populate lyrics keys if present on disk
            lyrics_file = song_dir / "lyrics.json"
            if lyrics_file.is_file():
                create_kwargs["lyrics_key"] = f"{song_name}/lyrics.json"

            lyrics_quick_file = song_dir / "lyrics_quick.json"
            if lyrics_quick_file.is_file():
                create_kwargs["lyrics_quick_key"] = f"{song_name}/lyrics_quick.json"

            await song_dao.create(**create_kwargs)
            synced += 1
            logger.info("Synced song: %s / %s", artist_display, title)

    await song_dao.flush()
    return synced
