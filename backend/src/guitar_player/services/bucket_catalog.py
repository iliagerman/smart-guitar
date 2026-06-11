"""Discover songs and their metadata from a bucket directory tree.

Used by scripts/rebuild_local_db.py to rebuild the catalog from a synced
copy of the production bucket. Handles both storage layouts:

  * old: ``{artist}/{song}/audio.mp3`` (youtube_id from ``{ytid}.jpg``)
  * new: ``{artist}/{song}/{youtube_id}/audio.mp3``
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

# YouTube video IDs: 11 chars of [A-Za-z0-9_-].
_YTID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Thumbnails that are NOT named after a youtube id.
_GENERIC_IMAGE_NAMES = {"cover", "thumbnail", "thumb", "artwork"}


@dataclass
class DiscoveredSong:
    song_name: str  # relative dir path, e.g. "abba/waterloo/Sj_9CiNkkn4"
    youtube_id: str | None


def _youtube_id_from_images(song_dir: Path) -> str | None:
    for img in song_dir.glob("*.jpg"):
        stem = img.stem
        if stem.lower() in _GENERIC_IMAGE_NAMES:
            continue
        if _YTID_RE.match(stem):
            return stem
    return None


def discover_song_dirs(base: Path) -> list[DiscoveredSong]:
    """Find every song directory (contains audio.mp3) under *base*."""
    discovered: list[DiscoveredSong] = []
    for audio in sorted(base.rglob("audio.mp3")):
        song_dir = audio.parent
        rel_parts = song_dir.relative_to(base).parts
        if len(rel_parts) == 2:
            artist_folder, song_folder = rel_parts
            ytid = _youtube_id_from_images(song_dir)
        elif len(rel_parts) == 3 and _YTID_RE.match(rel_parts[2]):
            ytid = rel_parts[2]
        else:
            logger.warning("Skipping unrecognized song path layout: %s", song_dir)
            continue
        discovered.append(
            DiscoveredSong(song_name="/".join(rel_parts), youtube_id=ytid)
        )
    return discovered


def prettify_folder_name(folder: str) -> str:
    """'knocking_on_heavens_door' -> 'Knocking On Heavens Door'."""
    return " ".join(w.capitalize() for w in folder.replace("_", " ").split())


def _matched_metadata(song_dir: Path) -> tuple[str | None, str | None]:
    """Pull matched artist/title from online-fetched JSON artifacts, if any."""
    for fname in ("static_chords.json", "songsterr_data.json"):
        path = song_dir / fname
        if not path.is_file():
            continue
        try:
            with open(path) as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        title = data.get("matched_title")
        artist = data.get("matched_artist")
        if title and artist:
            return str(title), str(artist)
    return None, None


def resolve_metadata(
    base: Path, song_name: str, seed_index: dict[str, dict],
) -> tuple[str, str, str | None]:
    """Resolve (title, artist, genre) for a discovered song.

    Preference: seed catalog (curated) > matched online metadata > prettified
    folder names. The seed catalog is keyed by the two-level song_name.
    """
    parts = song_name.split("/")
    two_level = "/".join(parts[:2])

    seed = seed_index.get(song_name) or seed_index.get(two_level)
    if seed and seed.get("title") and seed.get("artist"):
        return seed["title"], seed["artist"], seed.get("genre")

    title, artist = _matched_metadata(base / song_name)
    if title and artist:
        return title, artist, None

    artist_folder = parts[0]
    song_folder = parts[1] if len(parts) > 1 else parts[0]
    return (
        prettify_folder_name(song_folder),
        prettify_folder_name(artist_folder),
        None,
    )
