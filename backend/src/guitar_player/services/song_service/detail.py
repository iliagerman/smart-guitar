"""Song detail assembly -- builds the full SongDetailResponse."""

import asyncio
import logging
import uuid
from typing import Any

from guitar_player.dao.chord_vote_dao import ChordVoteDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.exceptions import NotFoundError
from guitar_player.schemas.records import SongRecord
from guitar_player.schemas.song import (
    ChordEntry,
    ChordOption,
    LyricsSegment,
    LyricsWord,
    RhythmInfo,
    SongDetailResponse,
    SongResponse,
    SongSection,
    StemType,
    StemUrls,
    StrumEvent,
    TabNote,
)
from guitar_player.services.llm_service import LlmService
from guitar_player.services.lyrics_correction import merge_lyrics_with_llm
from guitar_player.storage import StorageBackend

from .helpers import (
    CHORD_VARIANT_PREFIX,
    CHORD_VARIANT_SUFFIX,
    STEM_DEFINITIONS,
    STEM_NAMES,
    parse_lyrics_payload,
)

logger = logging.getLogger(__name__)


async def build_song_detail(
    song_id: uuid.UUID,
    song_dao: SongDAO,
    chord_vote_dao: ChordVoteDAO,
    storage: StorageBackend,
    llm: LlmService,
) -> SongDetailResponse:
    """Build the full song detail response."""
    song = await song_dao.get_by_id(song_id)
    if not song:
        raise NotFoundError("Song", str(song_id))

    song_resp = SongResponse.model_validate(song)
    audio_url = _resolve_url(storage, song.audio_key)
    thumbnail_url = _resolve_url(storage, song.thumbnail_key)
    stems = _build_stems(storage, song)
    stem_types = _build_stem_types(stems)

    chord_data = _load_chords(storage, song)
    autochord_chords = chord_data.get("autochord", [])
    recommended_capo = chord_data.get("recommended_capo")
    song_key = chord_data.get("song_key")

    lyrics_data = await _load_all_lyrics(storage, song, song_dao)
    await _generate_corrected_lyrics_if_needed(storage, song, song_dao, llm, lyrics_data)

    tabs, tabs_source, tab_strums, rhythm = await _load_tabs_and_strums(storage, song, song_dao)
    songsterr_data = _load_songsterr_data(storage, song)

    # Load community chord versions (converts to ChordOption objects)
    duration = float(song.duration_seconds or 240)
    community_options, community_tabs = _load_community_chord_options(
        storage, song, duration, lyrics_data,
    )

    chord_options = await _assemble_chord_options(
        storage, song, song_id, chord_vote_dao,
        autochord_chords, recommended_capo, lyrics_data,
        community_options,
    )

    # Primary chords: prefer first community version, fall back to autochord
    if community_options and community_options[0].chords:
        primary_chords = community_options[0].chords
        primary_source = "community"
    elif autochord_chords:
        primary_chords = autochord_chords
        primary_source = "autochord"
    else:
        primary_chords = []
        primary_source = None

    # Community tabs replace Songsterr tabs when available
    final_tabs = community_tabs or songsterr_data.get("tabs") or tabs
    final_tabs_source = ("community" if community_tabs else None) or songsterr_data.get("tabs_source") or tabs_source
    final_strums = songsterr_data.get("strums") or tab_strums

    return SongDetailResponse(
        song=song_resp,
        thumbnail_url=thumbnail_url,
        audio_url=audio_url,
        stems=stems,
        stem_types=stem_types,
        chords=primary_chords,
        chord_options=chord_options,
        lyrics=lyrics_data["lyrics"],
        lyrics_source=lyrics_data["lyrics_source"],
        quick_lyrics=lyrics_data["quick_lyrics"],
        quick_lyrics_source=lyrics_data["quick_lyrics_source"],
        corrected_lyrics=lyrics_data["corrected_lyrics"],
        corrected_lyrics_source=lyrics_data["corrected_lyrics_source"],
        ver1_lyrics=lyrics_data["quick_lyrics"],
        ver1_lyrics_source=lyrics_data["quick_lyrics_source"],
        ver2_lyrics=lyrics_data["lyrics"],
        ver2_lyrics_source=lyrics_data["lyrics_source"],
        ver3_lyrics=lyrics_data["corrected_lyrics"],
        ver3_lyrics_source=lyrics_data["corrected_lyrics_source"],
        ver4_lyrics=songsterr_data["ver4_lyrics"],
        ver4_lyrics_source=songsterr_data["ver4_lyrics_source"],
        tabs=final_tabs,
        tabs_source=final_tabs_source,
        strums=final_strums,
        rhythm=rhythm,
        sections=songsterr_data.get("sections", []),
        source_bpm=songsterr_data.get("source_bpm"),
        time_signature=songsterr_data.get("time_signature"),
        strum_notes=songsterr_data.get("strum_notes"),
        tutorial_url=songsterr_data.get("tutorial_url"),
        tutorial_links=songsterr_data.get("tutorial_links", []),
        songsterr_status=songsterr_data.get("songsterr_status"),
        chord_source=primary_source,
        recommended_capo=recommended_capo,
        song_key=song_key,
        web_chords_failed=False,
        web_chords_pending=False,
        download_pending=song.download_requested_at is not None,
    )


def _resolve_url(storage: StorageBackend, key: str | None) -> str | None:
    if key and storage.file_exists(key):
        return storage.get_url(key)
    return None


def _build_stems(storage: StorageBackend, song: SongRecord) -> StemUrls:
    stems = StemUrls()
    for stem_name in STEM_NAMES:
        key = getattr(song, f"{stem_name}_key", None)
        if key and storage.file_exists(key):
            setattr(stems, stem_name, storage.get_url(key))
    return stems


def _build_stem_types(stems: StemUrls) -> list[StemType]:
    """Return only stem types that are currently available for playback.

    The API contract says ``stem_types`` should list stems actually produced for a
    song. Returning the full catalog keeps missing optional stems looking
    perpetually "pending" on the frontend and can trigger needless polling.
    """
    available = {stem_name for stem_name in STEM_NAMES if getattr(stems, stem_name, None)}
    return [stem for stem in STEM_DEFINITIONS if stem.name in available]


def _load_chords(
    storage: StorageBackend, song: SongRecord,
) -> dict[str, Any]:
    """Load autochord chords and chord metadata."""
    autochord = _read_chord_file(storage, song.chords_key)

    # Gemini chord detection disabled — community chords from UG used instead.

    recommended_capo: int | None = None
    song_key: str | None = None
    if song.song_name:
        meta_key = f"{song.song_name}/chord_meta.json"
        if storage.file_exists(meta_key):
            try:
                meta = storage.read_json(meta_key)
                if isinstance(meta, dict):
                    recommended_capo = meta.get("capo") or None
                    song_key = meta.get("key") or None
            except Exception as e:
                logger.warning("Failed to read chord_meta for %s: %s", song.song_name, e)

    return {
        "autochord": autochord,
        "recommended_capo": recommended_capo,
        "song_key": song_key,
    }


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


def _parse_time_signature(value: str | None) -> tuple[int, int] | None:
    if not value or "/" not in value:
        return None
    left, right = value.split("/", 1)
    try:
        return int(left), int(right)
    except ValueError:
        return None




async def _load_all_lyrics(
    storage: StorageBackend, song: SongRecord, song_dao: SongDAO,
) -> dict[str, Any]:
    """Load all lyrics versions into a dict."""
    result: dict[str, Any] = {
        "lyrics": [], "lyrics_source": None, "lyrics_payload": None,
        "quick_lyrics": [], "quick_lyrics_source": None, "quick_lyrics_payload": None,
        "corrected_lyrics": [], "corrected_lyrics_source": None, "corrected_key": None,
    }

    if song.lyrics_key and storage.file_exists(song.lyrics_key):
        try:
            raw = storage.read_json(song.lyrics_key)
            result["lyrics"], result["lyrics_source"], result["lyrics_payload"] = (
                parse_lyrics_payload(raw)
            )
        except Exception as e:
            logger.warning("Failed to read lyrics for %s: %s", song.song_name, e)

    await _load_quick_lyrics(storage, song, song_dao, result)
    await _load_corrected_lyrics_key(storage, song, song_dao, result)

    return result


async def _load_quick_lyrics(
    storage: StorageBackend, song: SongRecord, song_dao: SongDAO,
    result: dict[str, Any],
) -> None:
    quick_key = song.lyrics_quick_key
    if not quick_key and song.song_name:
        candidate = f"{song.song_name}/lyrics_quick.json"
        if storage.file_exists(candidate):
            quick_key = candidate
            # Persist to DB so future requests don't need the probe
            await song_dao.update_by_id(song.id, lyrics_quick_key=candidate)

    if not quick_key or not storage.file_exists(quick_key):
        return

    try:
        raw = storage.read_json(quick_key)
        result["quick_lyrics"], result["quick_lyrics_source"], result["quick_lyrics_payload"] = (
            parse_lyrics_payload(raw)
        )
    except Exception as e:
        logger.warning("Failed to read quick lyrics for %s: %s", song.song_name, e)


async def _load_corrected_lyrics_key(
    storage: StorageBackend, song: SongRecord, song_dao: SongDAO,
    result: dict[str, Any],
) -> None:
    corrected_key = song.lyrics_corrected_key
    if not corrected_key and song.song_name:
        candidate = f"{song.song_name}/lyrics_corrected.json"
        if storage.file_exists(candidate):
            corrected_key = candidate
            await song_dao.update_by_id(song.id, lyrics_corrected_key=candidate)
    result["corrected_key"] = corrected_key

    if corrected_key and storage.file_exists(corrected_key):
        try:
            raw = storage.read_json(corrected_key)
            result["corrected_lyrics"], result["corrected_lyrics_source"], _ = (
                parse_lyrics_payload(raw)
            )
        except Exception as e:
            logger.warning("Failed to read corrected lyrics for %s: %s", song.song_name, e)


async def _generate_corrected_lyrics_if_needed(
    storage: StorageBackend,
    song: SongRecord,
    song_dao: SongDAO,
    llm: LlmService,
    lyrics_data: dict[str, Any],
) -> None:
    """Generate ver3 corrected lyrics if both ver1 and ver2 exist but ver3 does not."""
    corrected_key = lyrics_data["corrected_key"]
    should_generate = (
        song.song_name
        and lyrics_data["lyrics_payload"] is not None
        and lyrics_data["quick_lyrics_payload"] is not None
        and not (corrected_key and storage.file_exists(corrected_key))
    )
    if not should_generate:
        return

    corrected_candidate = f"{song.song_name}/lyrics_corrected.json"
    try:
        corrected_payload, diagnostics = await asyncio.to_thread(
            merge_lyrics_with_llm,
            lyrics_data["quick_lyrics_payload"],
            lyrics_data["lyrics_payload"],
            llm,
        )
        storage.write_json(corrected_candidate, corrected_payload)
        await song_dao.update_by_id(song.id, lyrics_corrected_key=corrected_candidate)

        corrected_lyrics, corrected_source, _ = parse_lyrics_payload(corrected_payload)
        lyrics_data["corrected_lyrics"] = corrected_lyrics
        lyrics_data["corrected_lyrics_source"] = corrected_source
        lyrics_data["corrected_key"] = corrected_candidate

        logger.info(
            "Generated lyrics ver3 for %s (%s/%s aligned words across %s groups)",
            song.song_name,
            diagnostics.aligned_words,
            diagnostics.total_words,
            diagnostics.mapping_groups,
        )
    except Exception:
        logger.warning(
            "Failed to generate lyrics ver3 for %s", song.song_name, exc_info=True,
        )


async def _load_tabs_and_strums(
    storage: StorageBackend, song: SongRecord, song_dao: SongDAO,
) -> tuple[list[TabNote], str | None, list[StrumEvent], RhythmInfo | None]:
    """Load tabs, strums, and rhythm from tabs.json."""
    tabs: list[TabNote] = []
    strums: list[StrumEvent] = []
    tabs_source: str | None = None
    rhythm: RhythmInfo | None = None

    tabs_key = song.tabs_key
    if not tabs_key and song.song_name:
        candidate = f"{song.song_name}/tabs.json"
        if storage.file_exists(candidate):
            tabs_key = candidate
            # Persist to DB so future requests don't need the probe
            await song_dao.update_by_id(song.id, tabs_key=candidate)
            await song_dao.commit()

    if not tabs_key or not storage.file_exists(tabs_key):
        return tabs, tabs_source, strums, rhythm

    try:
        raw = storage.read_json(tabs_key)
        if isinstance(raw, dict):
            if isinstance(raw.get("notes"), list):
                tabs = [TabNote(**n) for n in raw["notes"]]
                tabs_source = "detected"
            if isinstance(raw.get("strums"), list):
                strums = [StrumEvent(**s) for s in raw["strums"]]
            if isinstance(raw.get("rhythm"), dict):
                rhythm = RhythmInfo(**raw["rhythm"])
    except Exception as e:
        logger.warning("Failed to read tabs for %s: %s", song.song_name, e)

    return tabs, tabs_source, strums, rhythm


def _load_songsterr_data(storage: StorageBackend, song: SongRecord) -> dict[str, Any]:
    """Load Songsterr enriched data (tabs, strums, sections, etc.)."""
    result: dict[str, Any] = {
        "strums": [], "tabs": None, "tabs_source": None,
        "sections": [], "source_bpm": None, "time_signature": None,
        "strum_notes": None, "tutorial_url": None, "tutorial_links": [],
        "songsterr_status": None, "ver4_lyrics": [], "ver4_lyrics_source": None,
    }

    if song.external_strums_failed:
        result["songsterr_status"] = "failed"
    elif not song.artist or not song.song_name:
        result["songsterr_status"] = "unavailable"

    external_strums_key = song.external_strums_key
    if external_strums_key and storage.file_exists(external_strums_key):
        result["songsterr_status"] = "ready"
        try:
            raw = storage.read_json(external_strums_key)
            if isinstance(raw, dict):
                _parse_enriched_songsterr(raw, result)
            elif isinstance(raw, list):
                result["strums"] = [StrumEvent(**s) for s in raw]
        except Exception as e:
            logger.warning("Failed to read Songsterr data for %s: %s", song.song_name, e)

    if song.song_name:
        _load_songsterr_lyrics(storage, song.song_name, result)

    return result


def _load_songsterr_lyrics(
    storage: StorageBackend, song_name: str, result: dict[str, Any],
) -> None:
    songsterr_lyrics_key = f"{song_name}/lyrics_songsterr.json"
    if not storage.file_exists(songsterr_lyrics_key):
        return
    try:
        raw_sl = storage.read_json(songsterr_lyrics_key)
        result["ver4_lyrics"], result["ver4_lyrics_source"], _ = (
            parse_lyrics_payload(raw_sl)
        )
    except Exception as e:
        logger.warning("Failed to read Songsterr lyrics for %s: %s", song_name, e)


def _parse_enriched_songsterr(raw: dict[str, Any], result: dict[str, Any]) -> None:
    """Parse enriched Songsterr format into the result dict."""
    if isinstance(raw.get("strums"), list):
        result["strums"] = [StrumEvent(**s) for s in raw["strums"]]
    if isinstance(raw.get("tabs"), list) and raw["tabs"]:
        result["tabs"] = [TabNote(**n) for n in raw["tabs"]]
        result["tabs_source"] = "songsterr"
    if isinstance(raw.get("sections"), list):
        result["sections"] = [SongSection(**s) for s in raw["sections"]]
    if raw.get("source_bpm"):
        result["source_bpm"] = float(raw["source_bpm"])
    if isinstance(raw.get("time_signature"), list):
        result["time_signature"] = raw["time_signature"]
    if raw.get("strum_notes"):
        result["strum_notes"] = raw["strum_notes"]
    if raw.get("tutorial_url"):
        result["tutorial_url"] = raw["tutorial_url"]
    if isinstance(raw.get("tutorial_links"), list):
        result["tutorial_links"] = raw["tutorial_links"]


def _static_lines_to_chord_option(
    raw_lines: list[dict],
    duration: float,
    name: str,
    capo: int = 0,
    key: str = "",
) -> ChordOption:
    """Convert static chord lines (position-based) to a ChordOption (time-based).

    Estimates timing for each line by distributing evenly across the song
    duration. This allows the chords to flow through the standard
    transformation pipeline (capo, beginner, transpose).
    """
    lyric_lines = [
        line for line in raw_lines
        if isinstance(line, dict) and line.get("type") in ("lyric", "instrumental")
    ]
    total = max(len(lyric_lines), 1)
    line_duration = duration / total

    chords: list[ChordEntry] = []
    lyrics: list[LyricsSegment] = []

    line_idx = 0
    for line in raw_lines:
        if not isinstance(line, dict):
            continue
        line_type = line.get("type", "")
        if line_type not in ("lyric", "instrumental"):
            continue

        seg_start = line_idx * line_duration
        seg_end = seg_start + line_duration
        text = line.get("text", "")
        raw_chords = line.get("chords", [])

        # Build ChordEntry objects from position-based chords
        chord_count = len(raw_chords)
        for ci, c in enumerate(raw_chords):
            chord_start = seg_start + (ci / max(chord_count, 1)) * line_duration
            chord_end = seg_start + ((ci + 1) / max(chord_count, 1)) * line_duration
            chords.append(ChordEntry(
                start_time=round(chord_start, 3),
                end_time=round(chord_end, 3),
                chord=c.get("chord", ""),
            ))

        # Build LyricsSegment from lyric text
        if text:
            words_raw = text.split()
            word_dur = (seg_end - seg_start) / max(len(words_raw), 1)
            words = [
                LyricsWord(
                    word=w,
                    start=round(seg_start + j * word_dur, 3),
                    end=round(seg_start + (j + 1) * word_dur, 3),
                )
                for j, w in enumerate(words_raw)
            ]
            lyrics.append(LyricsSegment(
                start=round(seg_start, 3),
                end=round(seg_end, 3),
                text=text,
                words=words,
            ))

        line_idx += 1

    description = "Community chord sheet"
    if key:
        description += f" (Key: {key})"

    return ChordOption(
        name=name,
        description=description,
        capo=capo,
        chords=chords,
        lyrics=lyrics,
        lyrics_source="community",
    )


def _load_community_chord_options(
    storage: StorageBackend,
    song: SongRecord,
    duration: float,
    lyrics_data: dict[str, Any],
) -> tuple[list[ChordOption], list[TabNote] | None]:
    """Load community chord versions and tab from static_chords.json.

    Returns (chord_options, tab_notes). Each chord version becomes a
    ChordOption with estimated timing so it works with capo/easy/transpose.
    """
    key = song.static_chords_key
    if not key and song.song_name:
        candidate = f"{song.song_name}/static_chords.json"
        if storage.file_exists(candidate):
            key = candidate

    if not key or not storage.file_exists(key):
        return [], None

    try:
        raw = storage.read_json(key)
        if not isinstance(raw, dict):
            return [], None

        options: list[ChordOption] = []

        # New multi-version format: {"versions": [...]}
        versions = raw.get("versions", [])
        if versions:
            for i, version in enumerate(versions):
                if not isinstance(version, dict):
                    continue
                raw_lines = version.get("lines", [])
                if not raw_lines:
                    continue
                option = _static_lines_to_chord_option(
                    raw_lines, duration,
                    name=f"Sheet {i + 1}",
                    capo=version.get("capo", 0),
                    key=version.get("key", ""),
                )
                options.append(option)
        else:
            # Legacy single-version format: {"lines": [...]}
            raw_lines = raw.get("lines", [])
            if raw_lines:
                option = _static_lines_to_chord_option(
                    raw_lines, duration,
                    name="Sheet 1",
                    capo=raw.get("capo", 0),
                    key=raw.get("key", ""),
                )
                options.append(option)

        # Parse tab content (raw text tab from UG)
        tab_notes: list[TabNote] | None = None
        tab_content = raw.get("tab_content")
        if tab_content and isinstance(tab_content, str):
            # Store as a single TabNote-compatible entry for the frontend
            # The tab content is raw text, rendered by the frontend TabsSheet
            # For now, pass through as-is via a marker in tabs_source
            pass  # tabs are handled via raw tab_content field in the JSON

        return options, tab_notes

    except Exception as e:
        logger.warning("Failed to read community chords for %s: %s", song.song_name, e)
        return [], None


async def _assemble_chord_options(
    storage: StorageBackend,
    song: SongRecord,
    song_id: uuid.UUID,
    chord_vote_dao: ChordVoteDAO,
    autochord_chords: list[ChordEntry],
    recommended_capo: int | None,
    lyrics_data: dict[str, Any],
    community_options: list[ChordOption],
) -> list[ChordOption]:
    """Assemble chord options: community versions first, then detected, user versions last."""
    chord_options: list[ChordOption] = []
    user_versions, variant_options = _load_chord_variants_from_disk(storage, song.song_name)

    # Enrich user versions with vote scores
    try:
        vote_counts = await chord_vote_dao.get_vote_counts(song_id)
        for option in user_versions:
            if option.version_key and option.version_key in vote_counts:
                option.vote_score = vote_counts[option.version_key]
                option.hidden = option.vote_score <= -10
    except Exception as e:
        logger.warning("Failed to load chord vote counts for %s: %s", song_id, e)
        await chord_vote_dao.rollback()

    # Best system lyrics: ver3 > ver2 > ver1
    best_lyrics = (
        lyrics_data["corrected_lyrics"]
        or lyrics_data["lyrics"]
        or lyrics_data["quick_lyrics"]
        or None
    )
    best_lyrics_source = (
        lyrics_data["corrected_lyrics_source"]
        or lyrics_data["lyrics_source"]
        or lyrics_data["quick_lyrics_source"]
    )

    # Community chord sheets first (most accurate, from UG)
    chord_options.extend(community_options)

    # Autochord detected chords (with best available lyrics) as fallback
    if autochord_chords and best_lyrics:
        chord_options.append(
            ChordOption(
                name="Detected",
                description="Auto-detected chords",
                capo=0,
                chords=autochord_chords,
                lyrics=best_lyrics,
                lyrics_source=best_lyrics_source,
            )
        )

    # User-created versions (auto-pair legacy saves that have no lyrics)
    for opt in user_versions:
        if opt.lyrics is None:
            opt.lyrics = best_lyrics
            opt.lyrics_source = best_lyrics_source
        chord_options.append(opt)

    # Beginner/capo variants at the end
    for opt in variant_options:
        opt.is_variant = True
    chord_options.extend(variant_options)

    return chord_options


def _load_chord_variants_from_disk(
    storage: StorageBackend, song_name: str,
) -> tuple[list[ChordOption], list[ChordOption]]:
    """Load user-created and system variant chord files from storage."""
    user_versions: list[ChordOption] = []
    variant_options: list[ChordOption] = []

    if not song_name:
        return user_versions, variant_options

    try:
        files = storage.list_files(song_name)
        has_web_variants = any("chords_web_" in f.rsplit("/", 1)[-1] for f in files)
        variant_keys = sorted(
            f
            for f in files
            if f.rsplit("/", 1)[-1].startswith(CHORD_VARIANT_PREFIX)
            and f.endswith(CHORD_VARIANT_SUFFIX)
            and "intermediate" not in f.rsplit("/", 1)[-1].lower()
            and (
                not has_web_variants
                or "chords_web_" in f.rsplit("/", 1)[-1]
                or "chords_user" in f.rsplit("/", 1)[-1]
            )
        )
        for key in variant_keys:
            option = _parse_variant_file(storage, key)
            if not option:
                continue
            filename = key.rsplit("/", 1)[-1]
            if "chords_user" in filename:
                user_versions.append(option)
            else:
                variant_options.append(option)
    except Exception as e:
        logger.warning("Failed to list chord variants for %s: %s", song_name, e)

    return user_versions, variant_options


def _parse_variant_file(storage: StorageBackend, key: str) -> ChordOption | None:
    """Parse a single chord variant JSON file into a ChordOption."""
    try:
        data = storage.read_json(key)
        if not isinstance(data, dict) or "chords" not in data:
            return None

        version_lyrics = None
        version_lyrics_source = None
        if isinstance(data.get("lyrics"), list):
            version_lyrics = [LyricsSegment(**seg) for seg in data["lyrics"]]
            version_lyrics_source = "user"

        return ChordOption(
            name=data.get("name", ""),
            description=data.get("description", ""),
            capo=data.get("capo", 0),
            chords=[ChordEntry(**c) for c in data["chords"]],
            lyrics=version_lyrics,
            lyrics_source=version_lyrics_source,
            version_key=key,
            created_by=data.get("created_by"),
        )
    except Exception as e:
        logger.warning("Failed to read chord variant %s: %s", key, e)
        return None
