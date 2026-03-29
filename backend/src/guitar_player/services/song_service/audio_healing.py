"""Audio/thumbnail healing -- best-effort repair for missing files."""

import logging
import os
import shutil
import tempfile
import uuid

from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.exceptions import NotFoundError
from guitar_player.schemas.records import SongRecord
from guitar_player.services.audio_normalize import (
    ensure_canonical_audio_mp3,
    transcode_audio_to_mp3_cbr192,
)
from guitar_player.services.youtube_service import YoutubeService
from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)


async def heal_audio_and_thumbnail(
    song_id: uuid.UUID,
    user_sub: str,
    user_email: str,
    song_dao: SongDAO,
    user_dao: UserDAO,
    storage: StorageBackend,
    youtube: YoutubeService,
) -> bool:
    """Best-effort repair for missing original audio/thumbnail.

    Tries to fix DB keys from common filenames first, then re-downloads
    if still missing and youtube_id is available.
    Returns True if the DB record was updated.
    """
    song = await song_dao.get_by_id(song_id)
    if not song:
        raise NotFoundError("Song", str(song_id))

    audio_ok = bool(song.audio_key) and storage.file_exists(song.audio_key)
    thumb_ok = bool(song.thumbnail_key) and storage.file_exists(song.thumbnail_key)

    updated = False
    pending_updates: dict[str, str | None] = {}

    # Canonicalize audio even when present
    if audio_ok and song.song_name and song.audio_key:
        canon_result = _try_canonicalize_audio(storage, song)
        if canon_result:
            pending_updates["audio_key"] = canon_result
            updated = True

    if audio_ok and thumb_ok and not updated:
        return False

    # Try to fix from existing files in storage first
    if song.song_name:
        fixed = await _fix_keys_from_storage(
            storage, song_dao, song, audio_ok, thumb_ok, pending_updates,
        )
        if fixed:
            updated = True
            audio_ok = "audio_key" in pending_updates or audio_ok
            thumb_ok = "thumbnail_key" in pending_updates or thumb_ok

    if updated and pending_updates:
        await song_dao.update_by_id(song.id, **pending_updates)
        pending_updates = {}
        return True

    # Try to discover youtube_id if missing
    song = await _discover_youtube_id_if_missing(song, song_dao, youtube)

    if not song.youtube_id:
        logger.warning(
            "Admin heal: cannot re-download audio -- no youtube_id song_name=%r",
            song.song_name,
        )
        return updated

    # Re-download missing files
    return await _redownload_missing(
        song, audio_ok, thumb_ok, user_sub, user_email,
        song_dao, user_dao, storage, youtube, updated,
    )


def _try_canonicalize_audio(
    storage: StorageBackend, song: SongRecord,
) -> str | None:
    """Canonicalize audio key to audio.mp3 if needed. Returns new key or None."""
    if not song.audio_key or song.audio_key.endswith("/audio.mp3"):
        return None
    try:
        canonical = ensure_canonical_audio_mp3(
            storage, song_name=song.song_name, source_audio_key=song.audio_key,
        )
        if canonical and canonical != song.audio_key:
            return canonical
    except Exception:
        pass
    return None


async def _fix_keys_from_storage(
    storage: StorageBackend,
    song_dao: SongDAO,
    song: SongRecord,
    audio_ok: bool,
    thumb_ok: bool,
    pending_updates: dict[str, str | None],
) -> bool:
    """Try to fix missing audio/thumbnail keys from existing files on disk."""
    updated = False
    try:
        files = set(storage.list_files(song.song_name))
    except Exception as e:
        logger.warning("Admin: failed to list files for %s: %s", song.song_name, e)
        return False

    if not audio_ok:
        found = _find_audio_key(storage, song, files)
        if found:
            pending_updates["audio_key"] = found
            updated = True

    if not thumb_ok:
        found = await _find_thumbnail_key(storage, song_dao, song, files)
        if found:
            pending_updates["thumbnail_key"] = found[0]
            if found[1]:  # youtube_id discovered from filename
                pending_updates["youtube_id"] = found[1]
            updated = True

    return updated


def _find_audio_key(
    storage: StorageBackend, song: SongRecord, files: set[str],
) -> str | None:
    """Find an audio file key from known candidates or any non-stem mp3."""
    candidates = [
        f"{song.song_name}/audio.mp3",
        f"{song.song_name}/full_mix.mp3",
        f"{song.song_name}/mix.mp3",
    ]
    stem_like = {
        "vocals.mp3", "guitar.mp3", "guitar_isolated.mp3",
        "vocals_isolated.mp3", "guitar_removed.mp3", "vocals_guitar.mp3",
        "drums.mp3", "bass.mp3", "piano.mp3", "other.mp3",
    }
    for f in files:
        if f.endswith(".mp3") and f.rsplit("/", 1)[-1] not in stem_like:
            candidates.append(f)

    found_key: str | None = None
    for key in candidates:
        if key in files and storage.file_exists(key):
            found_key = key
            break

    if not found_key:
        return None

    # Canonicalize if not audio.mp3
    if not found_key.endswith("/audio.mp3") and song.song_name:
        try:
            canonical = ensure_canonical_audio_mp3(
                storage, song_name=song.song_name, source_audio_key=found_key,
            )
            if canonical and canonical != found_key:
                return canonical
        except Exception:
            pass

    return found_key


async def _find_thumbnail_key(
    storage: StorageBackend,
    song_dao: SongDAO,
    song: SongRecord,
    files: set[str],
) -> tuple[str, str | None] | None:
    """Find a thumbnail key. Returns (key, youtube_id_or_None) or None."""
    candidates: list[str] = []
    if song.youtube_id:
        base_yt_id = song.youtube_id.rstrip("_")
        candidates.append(f"{song.song_name}/{base_yt_id}.jpg")
        if base_yt_id != song.youtube_id:
            candidates.append(f"{song.song_name}/{song.youtube_id}.jpg")

    candidates.extend([
        f"{song.song_name}/thumbnail.jpg",
        f"{song.song_name}/thumbnail.jpeg",
        f"{song.song_name}/cover.jpg",
        f"{song.song_name}/cover.jpeg",
    ])

    for key in candidates:
        if key in files and storage.file_exists(key):
            return key, None

    # Fallback: any JPEG file
    for f in sorted(files):
        if not f.lower().endswith((".jpg", ".jpeg")):
            continue
        yt_id = None
        if not song.youtube_id:
            stem = f.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            if stem not in ("thumbnail", "cover"):
                candidate = stem
                while await song_dao.get_by_youtube_id(candidate) is not None:
                    candidate += "_"
                yt_id = candidate
        return f, yt_id

    return None


async def _discover_youtube_id_if_missing(
    song: SongRecord, song_dao: SongDAO, youtube: YoutubeService,
) -> SongRecord:
    """Search YouTube to discover a youtube_id for songs that lack one."""
    if song.youtube_id:
        return song

    terms: list[str] = []
    if song.artist:
        terms.append(song.artist)
    if song.title:
        terms.append(song.title)
    if not terms and song.song_name:
        terms.append(song.song_name.rsplit("/", 1)[-1].replace("_", " "))

    query = " ".join(t.strip() for t in terms if t and t.strip()).strip()
    if not query:
        return song

    query = f"{query} official"
    try:
        results = await youtube.search(query, max_results=1)
        youtube_id = results[0].youtube_id if results else None
        if not youtube_id:
            return song

        candidate = youtube_id
        while await song_dao.get_by_youtube_id(candidate) is not None:
            candidate += "_"
        song = await song_dao.update_by_id(song.id, youtube_id=candidate)
        logger.info(
            "Admin: discovered youtube_id for %s via query '%s'",
            song.song_name, query,
        )
    except Exception as e:
        logger.warning(
            "Admin: YouTube search failed for %s (query='%s'): %s",
            song.song_name, query, e,
        )

    return song


async def _redownload_missing(
    song: SongRecord,
    audio_ok: bool,
    thumb_ok: bool,
    user_sub: str,
    user_email: str,
    song_dao: SongDAO,
    user_dao: UserDAO,
    storage: StorageBackend,
    youtube: YoutubeService,
    updated: bool,
) -> bool:
    """Re-download missing audio/thumbnail from YouTube."""
    tmp_dir = tempfile.mkdtemp(prefix="song_admin_")
    try:
        user = await user_dao.get_or_create(user_sub, user_email)
        heal_updates: dict[str, str | uuid.UUID | None] = {}

        if not audio_ok:
            audio_key = await _redownload_audio(
                song, tmp_dir, storage, youtube,
            )
            if audio_key:
                heal_updates["audio_key"] = audio_key
                updated = True

        if not thumb_ok:
            thumb_key = await _redownload_thumbnail(song, tmp_dir, storage, youtube)
            if thumb_key:
                heal_updates["thumbnail_key"] = thumb_key
                updated = True

        if updated and not song.downloaded_by:
            heal_updates["downloaded_by"] = user.id

        if updated and heal_updates:
            await song_dao.update_by_id(song.id, **heal_updates)
        return updated
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def _redownload_audio(
    song: SongRecord,
    tmp_dir: str,
    storage: StorageBackend,
    youtube: YoutubeService,
) -> str | None:
    """Download and upload audio from YouTube. Returns the storage key or None."""
    try:
        local_audio, _raw_name, _meta = await youtube.download(song.youtube_id, tmp_dir)
    except Exception:
        logger.exception(
            "Admin heal: YouTube download failed song_name=%r youtube_id=%r",
            song.song_name, song.youtube_id,
        )
        raise

    canonical_audio_key = f"{song.song_name}/audio.mp3"
    local_mp3 = os.path.join(tmp_dir, "audio.mp3")

    try:
        transcode_audio_to_mp3_cbr192(local_audio, local_mp3)
        storage.upload_file(local_mp3, canonical_audio_key)
        return canonical_audio_key
    except Exception:
        logger.exception(
            "Admin heal: transcode failed, falling back to original song_name=%r",
            song.song_name,
        )
        audio_filename = os.path.basename(local_audio)
        audio_key = f"{song.song_name}/{audio_filename}"
        storage.upload_file(local_audio, audio_key)
        return audio_key


async def _redownload_thumbnail(
    song: SongRecord,
    tmp_dir: str,
    storage: StorageBackend,
    youtube: YoutubeService,
) -> str | None:
    """Download and upload thumbnail from YouTube. Returns the storage key or None."""
    try:
        thumb_path = await youtube.download_thumbnail(song.youtube_id, tmp_dir)
        thumb_key = f"{song.song_name}/{song.youtube_id}.jpg"
        storage.upload_file(thumb_path, thumb_key)
        return thumb_key
    except Exception:
        logger.exception(
            "Admin heal: thumbnail download failed song_name=%r youtube_id=%r",
            song.song_name, song.youtube_id,
        )
        return None
