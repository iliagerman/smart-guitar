"""Practice tags -- difficulty, easy chord vocabulary and tempo -- read from chord files.

Only reads storage: the tags live in DB columns on the song row.
"""

import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.song_dao import SongDAO
from guitar_player.enums import SongDifficulty
from guitar_player.schemas.admin import AdminRetagResponse
from guitar_player.schemas.records import SongRecord
from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)

_NO_CHORD = {"", "N", "X"}

# A chord must fill this share of the song's chord time to count, which drops
# detector noise (one-beat blips) from the vocabulary.
MIN_CHORD_SHARE = 0.03

EASY_MAX_CHORDS = 5
MEDIUM_MAX_CHORDS = 7

_EASY_CHORDS_MAX_LEN = 200  # songs.easy_chords column width

_BARRE_CHORD_NAMES = (
    "F", "Bm", "F#m", "Bb", "C#m", "G#m", "D#m", "Fm", "Cm", "Gm",
    "B", "Db", "Eb", "Ab", "Gb", "Bbm", "Ebm",
)

# Open shapes the beginner variants use for barre triads at the same pitch.
_OPEN_SUBSTITUTES = {"Fmaj7", "Bm7", "B7"}

# Detected (MIREX) quality -> readable suffix; anything else is dropped.
_QUALITY_SUFFIX = {"maj": "", "min": "m", "7": "7", "min7": "m7"}

_ROOT_RE = re.compile(r"([A-G])([#b]?)(.*)")
_PITCH_CLASSES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_ACCIDENTALS = {"#": 1, "b": -1, "": 0}


@dataclass(frozen=True)
class SongTags:
    difficulty: SongDifficulty
    easy_chords: list[str]
    easy_capo: int
    tempo_bpm: float | None


@dataclass(frozen=True)
class _ChordVersion:
    capo: int
    chords: list[str]


def readable_chord(label: str) -> str:
    """``Gb:min`` -> ``Gbm``, ``A:maj`` -> ``A``, ``E:7`` -> ``E7``; plain names pass through."""
    root, separator, quality = label.partition(":")
    if not separator:
        return label
    return root + _QUALITY_SUFFIX.get(quality, "")


def _triad(name: str) -> tuple[int, bool] | None:
    """(root pitch class, is_minor) of a readable chord name such as ``F#m7`` or ``C/G``."""
    match = _ROOT_RE.fullmatch(name.split("/")[0])
    if not match:
        return None
    letter, accidental, quality = match.groups()
    is_minor = quality.startswith("m") and not quality.startswith("maj")
    return (_PITCH_CLASSES[letter] + _ACCIDENTALS[accidental]) % 12, is_minor


_BARRE_TRIADS = {_triad(name) for name in _BARRE_CHORD_NAMES}


def is_barre_chord(name: str) -> bool:
    return name not in _OPEN_SUBSTITUTES and _triad(name) in _BARRE_TRIADS


def chord_vocabulary(chords: Iterable[tuple[str, float]]) -> list[str]:
    """Chords filling at least MIN_CHORD_SHARE of the chord time, in first-appearance order."""
    durations: dict[str, float] = {}
    for name, duration in chords:
        if name in _NO_CHORD:
            continue
        durations[name] = durations.get(name, 0.0) + max(duration, 0.0)
    threshold = MIN_CHORD_SHARE * sum(durations.values())
    return [name for name, total in durations.items() if total >= threshold]


def difficulty_for(chords: list[str]) -> SongDifficulty:
    if len(chords) <= EASY_MAX_CHORDS and not any(is_barre_chord(c) for c in chords):
        return SongDifficulty.EASY
    if len(chords) <= MEDIUM_MAX_CHORDS:
        return SongDifficulty.MEDIUM
    return SongDifficulty.HARD


def _timed(entries: list[dict], *, readable: bool = False) -> list[tuple[str, float]]:
    return [
        (
            readable_chord(entry["chord"]) if readable else entry["chord"],
            float(entry["end_time"]) - float(entry["start_time"]),
        )
        for entry in entries
    ]


def _beginner_versions(storage: StorageBackend, song_name: str) -> list[_ChordVersion]:
    """chords_beginner.json (capo 0) and chords_beginner_capo_N.json variants."""
    pattern = re.compile(rf"{re.escape(song_name)}/chords_beginner(?:_capo_(\d+))?\.json")
    versions: list[_ChordVersion] = []
    for key in storage.list_files(f"{song_name}/"):
        match = pattern.fullmatch(key)
        if not match:
            continue
        data = storage.read_json(key)
        entries = data.get("chords") if isinstance(data, dict) else None
        if not isinstance(entries, list):
            continue
        chords = chord_vocabulary(_timed(entries))
        if chords:
            versions.append(_ChordVersion(capo=int(match.group(1) or 0), chords=chords))
    return versions


def _detected_version(storage: StorageBackend, song: SongRecord) -> _ChordVersion | None:
    key = song.chords_key or f"{song.song_name}/chords.json"
    if not storage.file_exists(key):
        return None
    entries = storage.read_json(key)
    if not isinstance(entries, list):
        return None
    chords = chord_vocabulary(_timed(entries, readable=True))
    return _ChordVersion(capo=0, chords=chords) if chords else None


def _read_bpm(storage: StorageBackend, song_name: str) -> float | None:
    key = f"{song_name}/chord_meta.json"
    if not storage.file_exists(key):
        return None
    meta = storage.read_json(key)
    bpm = meta.get("bpm") if isinstance(meta, dict) else None
    return float(bpm) if bpm else None


def _fit_column(chords: list[str]) -> list[str]:
    """Longest prefix whose comma-joined form fits the easy_chords column."""
    kept: list[str] = []
    for chord in chords:
        if len(",".join([*kept, chord])) > _EASY_CHORDS_MAX_LEN:
            break
        kept.append(chord)
    return kept


def compute_song_tags(storage: StorageBackend, song: SongRecord) -> SongTags | None:
    """Tags from the easiest chord version, or None when the song has no chords yet.

    The easiest version is the beginner variant (no capo or capo N) with the
    fewest chords, ties going to the lower capo; without beginner variants the
    detected chords.json is used at capo 0.
    """
    versions = _beginner_versions(storage, song.song_name)
    easiest = (
        min(versions, key=lambda v: (len(v.chords), v.capo))
        if versions
        else _detected_version(storage, song)
    )
    if easiest is None:
        return None
    return SongTags(
        difficulty=difficulty_for(easiest.chords),
        easy_chords=easiest.chords,
        easy_capo=easiest.capo,
        tempo_bpm=_read_bpm(storage, song.song_name),
    )


async def refresh_song_tags(
    song_dao: SongDAO, storage: StorageBackend, song: SongRecord,
) -> SongRecord | None:
    """Compute and store a song's tags; None when it has no chords to tag from."""
    tags = compute_song_tags(storage, song)
    if tags is None:
        return None
    easy_chords = _fit_column(tags.easy_chords)
    return await song_dao.update_by_id(
        song.id,
        difficulty=tags.difficulty.value,
        chord_count=len(tags.easy_chords),
        easy_chords=",".join(easy_chords),
        easy_capo=tags.easy_capo,
        tempo_bpm=tags.tempo_bpm,
        tags_computed_at=datetime.now(timezone.utc),
    )


async def ensure_song_tags(
    song_dao: SongDAO, storage: StorageBackend, song: SongRecord,
) -> SongRecord:
    """Tag a song the first time its detail is built once chords exist."""
    if song.tags_computed_at is not None or not song.chords_key:
        return song
    try:
        return await refresh_song_tags(song_dao, storage, song) or song
    except Exception:
        logger.warning("Failed to compute practice tags for %s", song.song_name, exc_info=True)
        return song


async def retag_songs(
    session: AsyncSession, storage: StorageBackend,
    offset: int, limit: int, force: bool,
) -> AdminRetagResponse:
    """Tag one window of songs (oldest first); already-tagged songs are skipped unless forced."""
    song_dao = SongDAO(session)
    total = await song_dao.count()
    songs = await song_dao.list_by_creation(offset, limit)

    tagged = skipped = failed = 0
    for song in songs:
        if song.tags_computed_at is not None and not force:
            skipped += 1
            continue
        try:
            updated = await refresh_song_tags(song_dao, storage, song)
        except Exception:
            logger.warning("Retag failed for %s", song.song_name, exc_info=True)
            failed += 1
            continue
        if updated:
            tagged += 1
        else:
            skipped += 1
    await song_dao.commit()

    return AdminRetagResponse(
        processed=len(songs),
        tagged=tagged,
        skipped=skipped,
        failed=failed,
        next_offset=offset + limit if offset + limit < total else None,
        total=total,
    )
