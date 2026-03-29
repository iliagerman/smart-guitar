"""Chord management -- save, delete, vote on user chord versions."""

import logging
import uuid
from typing import Any

from guitar_player.dao.chord_vote_dao import ChordVoteDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.exceptions import BadRequestError, NotFoundError
from guitar_player.schemas.song import (
    ChordEntry,
    ChordVersionVoteResponse,
    LyricsSegment,
    SaveUserChordsRequest,
    SaveUserChordsResponse,
    SongSection,
)
from guitar_player.services.llm_service import LlmService
from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)


def chords_match(a: list[ChordEntry], b: list[ChordEntry]) -> bool:
    """Check if two chord lists are identical (same chords, same timing)."""
    if len(a) != len(b):
        return False
    return all(
        x.chord == y.chord
        and abs(x.start_time - y.start_time) < 0.05
        and abs(x.end_time - y.end_time) < 0.05
        for x, y in zip(a, b)
    )


def lyrics_match(
    a: list[LyricsSegment] | None,
    b: list[LyricsSegment] | None,
) -> bool:
    """Check if two lyrics lists are identical (same text and timing)."""
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if len(a) != len(b):
        return False
    return all(
        x.text == y.text
        and abs(x.start - y.start) < 0.05
        and abs(x.end - y.end) < 0.05
        for x, y in zip(a, b)
    )


def find_duplicate_version(
    storage: StorageBackend,
    song_name: str,
    new_chords: list[ChordEntry],
    new_lyrics: list[LyricsSegment] | None = None,
) -> str | None:
    """Return the name of an existing version where BOTH chords and lyrics match."""
    if new_lyrics is None or len(new_lyrics) == 0:
        # No lyrics submitted -- fall back to chord-only comparison
        for key, label in [
            (f"{song_name}/chords_web.json", "Gemini (V2)"),
            (f"{song_name}/chords.json", "Autochord (V1)"),
        ]:
            if not storage.file_exists(key):
                continue
            try:
                raw = storage.read_json(key)
                if isinstance(raw, list):
                    existing = [ChordEntry(**c) for c in raw]
                    if chords_match(new_chords, existing):
                        return label
            except Exception:
                pass

    # Check user version files (chords + lyrics)
    try:
        for key in _list_user_chord_files(storage, song_name):
            try:
                data = storage.read_json(key)
                if not isinstance(data, dict) or "chords" not in data:
                    continue
                existing = [ChordEntry(**c) for c in data["chords"]]
                if not chords_match(new_chords, existing):
                    continue
                existing_lyrics = None
                if isinstance(data.get("lyrics"), list):
                    existing_lyrics = [LyricsSegment(**seg) for seg in data["lyrics"]]
                if not lyrics_match(new_lyrics, existing_lyrics):
                    continue
                return data.get("name", key.rsplit("/", 1)[-1])
            except Exception:
                pass
    except Exception:
        pass

    return None


def _list_user_chord_files(storage: StorageBackend, song_name: str) -> list[str]:
    """Return all user chord file keys for a song."""
    try:
        files = storage.list_files(song_name)
    except Exception:
        return []
    return [
        f for f in files
        if "chords_user" in f.rsplit("/", 1)[-1]
        and f.endswith(".json")
    ]


def find_user_chord_key(
    storage: StorageBackend, song_name: str, user_email: str,
) -> str | None:
    """Find the chord file created by a specific user, or None."""
    for key in _list_user_chord_files(storage, song_name):
        try:
            data = storage.read_json(key)
            if isinstance(data, dict) and data.get("created_by") == user_email:
                return key
        except Exception:
            pass
    return None


def next_user_chord_key(storage: StorageBackend, song_name: str) -> str | None:
    """Return the next available chords_user[_N].json key, or None if at limit."""
    existing = _list_user_chord_files(storage, song_name)
    if not existing:
        return f"{song_name}/chords_user.json"
    if len(existing) >= 8:
        return None
    n = len(existing) + 1
    return f"{song_name}/chords_user_{n}.json"


async def save_user_chords(
    song_id: uuid.UUID,
    request: SaveUserChordsRequest,
    user_email: str,
    song_dao: SongDAO,
    storage: StorageBackend,
    get_song_detail_fn: Any,
) -> SaveUserChordsResponse:
    """Save user-edited chords as a new chord variant."""
    song = await song_dao.get_by_id(song_id)
    if not song:
        raise NotFoundError("Song", str(song_id))

    duplicate_name = find_duplicate_version(
        storage, song.song_name, request.chords, request.lyrics,
    )
    if duplicate_name:
        detail = await get_song_detail_fn(song_id)
        return SaveUserChordsResponse(detail=detail, saved=False, duplicate_of=duplicate_name)

    existing_key = find_user_chord_key(storage, song.song_name, user_email)
    if existing_key:
        storage_key = existing_key
    else:
        storage_key = next_user_chord_key(storage, song.song_name)
        if not storage_key:
            raise BadRequestError("Maximum of 8 user chord versions reached")

    payload: dict[str, Any] = {
        "name": request.name,
        "description": request.description,
        "capo": request.capo,
        "created_by": user_email,
        "chords": [c.model_dump() for c in request.chords],
    }
    if request.lyrics:
        payload["lyrics"] = [seg.model_dump() for seg in request.lyrics]
    storage.write_json(storage_key, payload)

    detail = await get_song_detail_fn(song_id)
    return SaveUserChordsResponse(detail=detail, saved=True)


async def delete_user_chords(
    song_id: uuid.UUID,
    user_email: str,
    song_dao: SongDAO,
    storage: StorageBackend,
    get_song_detail_fn: Any,
) -> Any:
    """Delete the chord version created by this user."""
    song = await song_dao.get_by_id(song_id)
    if not song:
        raise NotFoundError("Song", str(song_id))

    key = find_user_chord_key(storage, song.song_name, user_email)
    if not key:
        raise NotFoundError("Chord version", user_email)

    storage.delete_file(key)
    return await get_song_detail_fn(song_id)


async def vote_chord_version(
    song_id: uuid.UUID,
    version_key: str,
    user_sub: str,
    vote: int,
    song_dao: SongDAO,
    user_dao: UserDAO,
    chord_vote_dao: ChordVoteDAO,
) -> ChordVersionVoteResponse:
    """Submit or update a user's vote on a chord version."""
    song = await song_dao.get_by_id(song_id)
    if not song:
        raise NotFoundError("Song", str(song_id))

    user = await user_dao.get_by_cognito_sub(user_sub)
    if not user:
        raise NotFoundError("User", user_sub)

    clamped_vote = max(-1, min(1, vote))
    await chord_vote_dao.upsert_vote(song_id, version_key, user.id, clamped_vote)
    await chord_vote_dao.commit()

    counts = await chord_vote_dao.get_vote_counts(song_id)
    score = counts.get(version_key, 0)
    return ChordVersionVoteResponse(version_key=version_key, vote_score=score)


async def generate_ai_strum_patterns(
    song_id: uuid.UUID,
    song_dao: SongDAO,
    storage: StorageBackend,
) -> list[SongSection]:
    """Generate AI strum patterns on-demand and persist to songsterr_data.json."""
    from guitar_player.config import get_settings

    song = await song_dao.get_by_id(song_id)
    if not song:
        raise NotFoundError("Song", str(song_id))

    external_strums_key = song.external_strums_key
    if not external_strums_key or not storage.file_exists(external_strums_key):
        raise BadRequestError("No Songsterr data available for this song")

    raw_songsterr = storage.read_json(external_strums_key)
    if not isinstance(raw_songsterr, dict):
        raise BadRequestError("Invalid Songsterr data format")

    sections_data = raw_songsterr.get("sections", [])
    if not sections_data:
        raise BadRequestError("No sections available")

    # Return existing patterns if already generated
    if any(s.get("llm_pattern") for s in sections_data):
        return [SongSection(**s) for s in sections_data]

    time_signature = _extract_time_signature(raw_songsterr)

    settings = get_settings()
    llm = LlmService(settings)
    llm_result = await llm.lookup_strum_patterns(
        song.artist or "", song.title or "",
        time_signature, settings.tavily.api_key,
    )

    if llm_result and llm_result.sections:
        _apply_llm_patterns(sections_data, llm_result)
        raw_songsterr["sections"] = sections_data
        storage.write_json(external_strums_key, raw_songsterr)

    return [SongSection(**s) for s in sections_data]


def _extract_time_signature(raw: dict[str, Any]) -> tuple[int, int] | None:
    raw_ts = raw.get("time_signature")
    if isinstance(raw_ts, list) and len(raw_ts) == 2:
        return (raw_ts[0], raw_ts[1])
    return None


def _apply_llm_patterns(sections_data: list[dict[str, Any]], llm_result: Any) -> None:
    llm_map = {s.section.lower(): s.pattern for s in llm_result.sections}
    for sec in sections_data:
        canonical = sec["name"].lower().rstrip("0123456789 ")
        if canonical in llm_map:
            sec["llm_pattern"] = llm_map[canonical]
        elif len(llm_result.sections) == 1:
            sec["llm_pattern"] = llm_result.sections[0].pattern
