"""Seed service — populates the DB with dummy songs for UI testing.

Flow:
    1) seed_db_catalog()              — creates Song rows in the DB (idempotent, by song_name)
    2) seed_update_metadata()         — enriches genre/play_count/duration and adds favorites
    3) seed_discover_storage_keys()   — scans storage for existing files and populates DB keys

Seed sources:
    - backend/src/guitar_player/services/seed_songs.json (primary, curated)
    - songs_list/all_songs.json (optional, merged in; no duplicates)
"""

from __future__ import annotations

import json
import logging
import random
import re
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.song_dao import SongDAO
from guitar_player.models.favorite import Favorite
from guitar_player.models.song import Song
from guitar_player.models.user import User

if TYPE_CHECKING:
    from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)


def _find_repo_file(relative_path: Path) -> Path | None:
    """Find a repo file by walking up from this module."""

    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / relative_path
        if candidate.is_file():
            return candidate
    return None


def _seed_song_key(entry: dict[str, Any]) -> str:
    """Stable de-dupe key for seed songs."""

    song_name = str(entry.get("song_name") or "").strip().replace("\\", "/")
    song_name = re.sub(r"/+", "/", song_name)
    return song_name.casefold()


def _dedupe_seed_songs(
    songs: list[dict[str, Any]], *, source: str
) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    dupes = 0

    for entry in songs:
        key = _seed_song_key(entry)
        if not key:
            continue
        if key in seen:
            dupes += 1
            continue
        seen.add(key)
        out.append(entry)

    if dupes:
        logger.warning(
            "Seed songs: dropped %d duplicate entries from %s", dupes, source
        )
    return out


def _normalize_song_dict(item: Any) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None

    title = str(item.get("title") or "").strip()
    artist = str(item.get("artist") or "").strip()
    genre = str(item.get("genre") or "other").strip() or "other"
    song_name = str(item.get("song_name") or "").strip()

    if not (title and artist and song_name):
        return None

    return {"title": title, "artist": artist, "genre": genre, "song_name": song_name}


def _load_seed_songs_json() -> list[dict[str, str]]:
    """Load curated seed songs from seed_songs.json."""

    # Prefer colocated resource.
    colocated = Path(__file__).with_name("seed_songs.json")
    path = colocated if colocated.is_file() else None

    # Fallback: repo-relative lookup.
    if not path:
        rel = Path("backend") / "src" / "guitar_player" / "services" / "seed_songs.json"
        path = _find_repo_file(rel)

    if not path:
        logger.error("Seed songs: seed_songs.json not found; SEED_SONGS will be empty")
        return []

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception(
            "Seed songs: failed to read %s; SEED_SONGS will be empty", path
        )
        return []

    if not isinstance(raw, list):
        logger.error(
            "Seed songs: %s is not a JSON list; SEED_SONGS will be empty", path
        )
        return []

    out: list[dict[str, str]] = []
    skipped = 0
    for item in raw:
        norm = _normalize_song_dict(item)
        if not norm:
            skipped += 1
            continue
        out.append(norm)

    if skipped:
        logger.info("Seed songs: skipped %d invalid items from %s", skipped, path)
    return out


def _load_all_songs_json() -> list[dict[str, str]]:
    """Load songs from songs_list/all_songs.json (if present)."""

    rel = Path("songs_list") / "all_songs.json"
    path = _find_repo_file(rel)
    if not path:
        logger.info("Seed songs: %s not found; skipping merge", rel)
        return []

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Seed songs: failed to read %s; skipping merge", path)
        return []

    if not isinstance(raw, list):
        logger.warning("Seed songs: %s is not a JSON list; skipping merge", path)
        return []

    out: list[dict[str, str]] = []
    skipped = 0
    for item in raw:
        norm = _normalize_song_dict(item)
        if not norm:
            skipped += 1
            continue
        out.append(norm)

    if skipped:
        logger.info("Seed songs: skipped %d invalid items from %s", skipped, path)
    return out


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

_BASE_SEED_SONGS = _load_seed_songs_json()
_EXTRA_SEED_SONGS = _load_all_songs_json()

# Merge without duplicates. Curated seed_songs.json wins on conflict.
SEED_SONGS: list[dict[str, Any]] = _dedupe_seed_songs(
    _BASE_SEED_SONGS, source="seed_songs.json"
)

_seed_seen = {_seed_song_key(s) for s in SEED_SONGS}
_extra_deduped = _dedupe_seed_songs(_EXTRA_SEED_SONGS, source="all_songs.json")
_skipped_merge = 0
for _entry in _extra_deduped:
    _key = _seed_song_key(_entry)
    if not _key or _key in _seed_seen:
        _skipped_merge += 1
        continue
    SEED_SONGS.append(_entry)
    _seed_seen.add(_key)

if _skipped_merge:
    logger.info(
        "Seed songs: skipped %d entries from all_songs.json due to duplicates",
        _skipped_merge,
    )

# Plausible duration range in seconds (2:30 – 7:00)
_MIN_DURATION = 150
_MAX_DURATION = 420


def seed_local_bucket_dirs(base_path: str) -> int:
    """(Deprecated) Create local_bucket directories for each seed song.

    This project now seeds **DB-only** (no MP3 creation). We keep this helper
    for backwards-compatibility, but it only creates directories.
    """

    bucket = Path(base_path)
    bucket.mkdir(parents=True, exist_ok=True)
    created = 0

    for entry in SEED_SONGS:
        song_dir = bucket / entry["song_name"]

        if song_dir.is_dir():
            continue

        song_dir.mkdir(parents=True, exist_ok=True)
        created += 1

    if created:
        logger.info("Created %d seed song directories in %s", created, base_path)
    return created


async def seed_db_catalog(
    session: AsyncSession,
    default_user: User,
    *,
    dry_run: bool = False,
) -> AsyncGenerator[str | int, None]:
    """Create the predefined seed song catalog directly in the DB.

    Idempotent by song_name. Does not touch storage.
    Yields progress strings, then yields the final created count (int).
    When *dry_run* is True, reports what would be created without writing.
    """

    prefix = "[DRY RUN] " if dry_run else ""

    dao = SongDAO(session)
    created = 0
    total = len(SEED_SONGS)

    msg = f"{prefix}seed_db_catalog: starting — {total} songs to process"
    logger.info(msg)
    yield msg

    for i, entry in enumerate(SEED_SONGS, 1):
        existing = await dao.get_by_song_name(entry["song_name"])
        if not existing:
            if dry_run:
                msg = f"{prefix}would create: {entry['song_name']}"
                logger.info(msg)
                yield msg
            else:
                await dao.create(
                    youtube_id=None,
                    title=entry["title"],
                    artist=entry["artist"],
                    duration_seconds=None,
                    song_name=entry["song_name"],
                    downloaded_by=default_user.id,
                )
            created += 1

        if i % 50 == 0 or i == 1:
            msg = (
                f"{prefix}seed_db_catalog: {i}/{total} ({created} "
                f"{'would create' if dry_run else 'created'} so far)"
            )
            logger.info(msg)
            yield msg

    if created and not dry_run:
        await session.flush()

    msg = (
        f"{prefix}seed_db_catalog: done — {created}/{total} songs "
        f"{'would be created' if dry_run else 'created'}"
    )
    logger.info(msg)
    yield msg
    yield created


async def seed_update_metadata(
    session: AsyncSession,
    default_user: User,
    *,
    dry_run: bool = False,
) -> AsyncGenerator[str | int, None]:
    """Update genre, play_count, duration on seed songs and create favorites.

    Runs AFTER seed_db_catalog() (or any other mechanism that created Song rows).
    Only touches records whose song_name matches a seed entry AND whose
    genre is still NULL (i.e. not yet enriched).  Idempotent.
    Yields progress strings, then yields the final updated count (int).
    When *dry_run* is True, reports what would change without writing.
    """

    prefix = "[DRY RUN] " if dry_run else ""
    rng = random.Random(42)

    updated = 0
    fav_count = 0
    total = len(SEED_SONGS)

    msg = f"{prefix}seed_update_metadata: starting — {total} songs to process"
    logger.info(msg)
    yield msg

    for i, entry in enumerate(SEED_SONGS, 1):
        stmt = select(Song).where(Song.song_name == entry["song_name"])
        result = await session.execute(stmt)
        song = result.scalar_one_or_none()
        if not song:
            if i % 50 == 0 or i == 1:
                msg = f"{prefix}seed_update_metadata: {i}/{total} (song not found, skipping)"
                logger.info(msg)
                yield msg
            continue

        # Check what would change
        changes: list[str] = []
        if song.genre is None:
            changes.append(f"genre=>{entry['genre']}")
            if not dry_run:
                song.genre = entry["genre"]
        if song.play_count == 0:
            new_pc = rng.randint(0, 500)
            changes.append(f"play_count=>{new_pc}")
            if not dry_run:
                song.play_count = new_pc
        else:
            rng.randint(0, 500)  # advance rng to keep deterministic
        if song.duration_seconds is None:
            new_dur = rng.randint(_MIN_DURATION, _MAX_DURATION)
            changes.append(f"duration=>{new_dur}")
            if not dry_run:
                song.duration_seconds = new_dur
        else:
            rng.randint(_MIN_DURATION, _MAX_DURATION)  # advance rng
        if song.title != entry["title"]:
            changes.append(f"title: '{song.title}' => '{entry['title']}'")
            if not dry_run:
                song.title = entry["title"]
        if song.artist != entry["artist"]:
            changes.append(f"artist: '{song.artist}' => '{entry['artist']}'")
            if not dry_run:
                song.artist = entry["artist"]

        if changes:
            updated += 1
            if dry_run:
                msg = f"{prefix}would update {entry['song_name']}: {', '.join(changes)}"
                logger.info(msg)
                yield msg

        # Create favorite (~40 % chance, deterministic via rng)
        if rng.random() < 0.4:
            fav_exists_stmt = (
                select(func.count())
                .select_from(Favorite)
                .where(
                    Favorite.user_id == default_user.id,
                    Favorite.song_id == song.id,
                )
            )
            exists = (await session.execute(fav_exists_stmt)).scalar_one()
            if not exists:
                if dry_run:
                    msg = f"{prefix}would create favorite: {entry['song_name']}"
                    logger.info(msg)
                    yield msg
                else:
                    session.add(Favorite(user_id=default_user.id, song_id=song.id))
                fav_count += 1

        if i % 50 == 0 or i == 1:
            verb = "would update" if dry_run else "updated"
            fav_verb = "would favorite" if dry_run else "favorites"
            msg = (
                f"{prefix}seed_update_metadata: {i}/{total} ({updated} {verb}, "
                f"{fav_count} {fav_verb} so far)"
            )
            logger.info(msg)
            yield msg

    if (updated or fav_count) and not dry_run:
        await session.flush()

    verb = "would update" if dry_run else "updated"
    fav_verb = "would create" if dry_run else "created"
    msg = f"{prefix}seed_update_metadata: done — {updated} {verb}, {fav_count} favorites {fav_verb}"
    logger.info(msg)
    yield msg
    yield updated


# Map of filename -> Song model attribute for known file types.
_FILENAME_TO_KEY: dict[str, str] = {
    "audio.mp3": "audio_key",
    "vocals.mp3": "vocals_key",
    "drums.mp3": "drums_key",
    "bass.mp3": "bass_key",
    "guitar.mp3": "guitar_key",
    "piano.mp3": "piano_key",
    "other.mp3": "other_key",
    "guitar_removed.mp3": "guitar_removed_key",
    "vocals_guitar.mp3": "vocals_guitar_key",
    "chords.json": "chords_key",
    "lyrics.json": "lyrics_key",
    "lyrics_quick.json": "lyrics_quick_key",
    "tabs.json": "tabs_key",
}


async def seed_discover_storage_keys(
    session: AsyncSession,
    storage: "StorageBackend",
    *,
    dry_run: bool = False,
) -> AsyncGenerator[str | int, None]:
    """Scan storage for each song and populate missing DB keys.

    For every Song with a song_name, lists the files in storage under that
    prefix and sets audio_key, thumbnail_key, stem keys, etc. from what exists.
    Also extracts youtube_id from thumbnail filenames like '{youtube_id}.jpg'.

    Idempotent: only fills in keys that are currently NULL.
    Yields progress strings, then yields the final updated count (int).
    """
    prefix = "[DRY RUN] " if dry_run else ""

    stmt = select(Song).where(Song.song_name.isnot(None))
    result = await session.execute(stmt)
    songs: list[Song] = list(result.scalars().all())
    total = len(songs)
    updated = 0

    # Pre-load all existing youtube_ids to avoid unique constraint violations.
    yt_stmt = select(Song.youtube_id).where(Song.youtube_id.isnot(None))
    yt_result = await session.execute(yt_stmt)
    used_youtube_ids: set[str] = {row[0] for row in yt_result.all()}

    msg = f"{prefix}seed_discover_storage_keys: starting — {total} songs to scan"
    logger.info(msg)
    yield msg

    for i, song in enumerate(songs, 1):
        try:
            files = set(storage.list_files(song.song_name))
        except Exception as e:
            logger.warning("Failed to list files for %s: %s", song.song_name, e)
            continue

        if not files:
            continue

        changes: list[str] = []

        # Discover known filenames (audio, stems, chords, lyrics, tabs).
        for filename, attr in _FILENAME_TO_KEY.items():
            key = f"{song.song_name}/{filename}"
            if key in files and not getattr(song, attr, None):
                changes.append(f"{attr}={filename}")
                if not dry_run:
                    setattr(song, attr, key)

        # Discover thumbnail from any .jpg/.jpeg file.
        if not song.thumbnail_key:
            for f in sorted(files):
                if f.lower().endswith((".jpg", ".jpeg")):
                    changes.append(f"thumbnail_key={f.rsplit('/', 1)[-1]}")
                    if not dry_run:
                        song.thumbnail_key = f
                    # Extract youtube_id from filename (skip if already taken).
                    if not song.youtube_id:
                        stem = f.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                        if stem not in ("thumbnail", "cover"):
                            candidate = stem
                            while candidate in used_youtube_ids:
                                candidate += "_"
                            changes.append(f"youtube_id={candidate}")
                            if not dry_run:
                                song.youtube_id = candidate
                            used_youtube_ids.add(candidate)
                    break

        if changes:
            updated += 1
            if dry_run:
                msg = f"{prefix}would update {song.song_name}: {', '.join(changes)}"
                logger.info(msg)
                yield msg
            else:
                # Use a savepoint so a single unique-constraint conflict
                # doesn't roll back the entire batch.
                try:
                    async with session.begin_nested():
                        await session.flush()
                except IntegrityError as exc:
                    logger.warning(
                        "IntegrityError updating %s (skipped): %s",
                        song.song_name, exc,
                    )
                    updated -= 1

        if i % 10 == 0 or i == 1:
            verb = "would update" if dry_run else "updated"
            msg = f"{prefix}seed_discover_storage_keys: {i}/{total} ({updated} {verb} so far)"
            logger.info(msg)
            yield msg

    verb = "would update" if dry_run else "updated"
    msg = f"{prefix}seed_discover_storage_keys: done — {updated} {verb}"
    logger.info(msg)
    yield msg
    yield updated
