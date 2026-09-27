"""Detected chords and chord_meta.json fields for the song detail."""

import logging
from dataclasses import dataclass
from typing import Any

from guitar_player.schemas.records import SongRecord
from guitar_player.schemas.song import ChordEntry
from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ChordData:
    autochord: list[ChordEntry]
    recommended_capo: int | None
    song_key: str | None
    beat_times: list[float]  # full-mix beats; empty for songs processed before beats were stored
    bar_starts: list[float]  # stored 4/4 bar starts


def load_chord_data(storage: StorageBackend, song: SongRecord) -> ChordData:
    """Load autochord chords and chord metadata (capo, key, detected beats)."""
    # Gemini chord detection disabled — community chords from UG used instead.
    meta = _read_chord_meta(storage, song.song_name)
    return ChordData(
        autochord=_read_chord_file(storage, song.chords_key),
        recommended_capo=meta.get("capo") or None,
        song_key=meta.get("key") or None,
        beat_times=_float_list(meta.get("beat_times")),
        bar_starts=_float_list(meta.get("bar_starts")),
    )


def _read_chord_meta(storage: StorageBackend, song_name: str | None) -> dict[str, Any]:
    # schema-less: chord_meta.json is merged from several pipelines.
    if not song_name:
        return {}
    meta_key = f"{song_name}/chord_meta.json"
    if not storage.file_exists(meta_key):
        return {}
    try:
        meta = storage.read_json(meta_key)
    except Exception as e:
        logger.warning("Failed to read chord_meta for %s: %s", song_name, e)
        return {}
    return meta if isinstance(meta, dict) else {}


def _read_chord_file(storage: StorageBackend, key: str | None) -> list[ChordEntry]:
    if not key or not storage.file_exists(key):
        return []
    try:
        raw = storage.read_json(key)
        if isinstance(raw, list):
            return [ChordEntry(**c) for c in raw]
    except Exception as e:
        logger.warning("Failed to read chords from %s: %s", key, e)
    return []


def _float_list(value: object) -> list[float]:
    return [float(v) for v in value] if isinstance(value, list) else []
