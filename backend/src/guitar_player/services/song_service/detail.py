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
    RhythmInfo,
    SongDetailResponse,
    SongResponse,
    SongSection,
    StaticChordLine,
    StaticChordPosition,
    StemType,
    StemUrls,
    StrumEvent,
    TabNote,
)
from guitar_player.services.chord_merger import merge_gemini_with_autochord
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
    gemini_chords = chord_data.get("gemini", [])
    recommended_capo = chord_data.get("recommended_capo")
    song_key = chord_data.get("song_key")
    chord_bpm = chord_data.get("bpm")
    chord_time_signature = chord_data.get("time_signature")

    lyrics_data = await _load_all_lyrics(storage, song, song_dao)
    await _generate_corrected_lyrics_if_needed(storage, song, song_dao, llm, lyrics_data)

    tabs, tabs_source, tab_strums, rhythm = await _load_tabs_and_strums(storage, song, song_dao)
    songsterr_data = _load_songsterr_data(storage, song)
    hybrid_chords = _build_hybrid_chords(
        autochord_chords,
        gemini_chords,
        chord_bpm,
        chord_time_signature,
    )

    chord_options = await _assemble_chord_options(
        storage,
        song,
        song_id,
        chord_vote_dao,
        autochord_chords,
        hybrid_chords,
        gemini_chords,
        recommended_capo,
        lyrics_data,
    )

    # Merge tabs/strums: Songsterr takes priority
    final_tabs = songsterr_data.get("tabs") or tabs
    final_tabs_source = songsterr_data.get("tabs_source") or tabs_source
    final_strums = songsterr_data.get("strums") or tab_strums
    scoring_lyrics = (
        lyrics_data["corrected_lyrics"]
        or songsterr_data["ver4_lyrics"]
        or lyrics_data["lyrics"]
        or lyrics_data["quick_lyrics"]
    )
    primary_chords, primary_source = _choose_primary_chords(
        autochord_chords,
        hybrid_chords,
        gemini_chords,
        scoring_lyrics,
    )

    web_chords_pending = (
        not gemini_chords
        and not song.web_chords_failed
        and song.web_chords_attempted_at is not None
    )

    static_chords, static_chords_source = _load_static_chords(storage, song)
    static_chords_pending = (
        not static_chords
        and not song.static_chords_failed
        and song.static_chords_attempted_at is not None
    )

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
        web_chords_failed=song.web_chords_failed,
        web_chords_pending=web_chords_pending,
        static_chords=static_chords,
        static_chords_source=static_chords_source,
        static_chords_pending=static_chords_pending,
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
    """Load autochord and Gemini chords, plus chord metadata."""
    autochord = _read_chord_file(storage, song.chords_key)

    web_chords_key = song.web_chords_key
    if not web_chords_key and song.song_name:
        candidate = f"{song.song_name}/chords_web.json"
        if storage.file_exists(candidate):
            web_chords_key = candidate
    gemini = _read_chord_file(storage, web_chords_key)

    recommended_capo: int | None = None
    song_key: str | None = None
    bpm: int | None = None
    time_signature: tuple[int, int] | None = None
    if song.song_name:
        meta_key = f"{song.song_name}/chord_meta.json"
        if storage.file_exists(meta_key):
            try:
                meta = storage.read_json(meta_key)
                if isinstance(meta, dict):
                    recommended_capo = meta.get("capo") or None
                    song_key = meta.get("key") or None
                    bpm = meta.get("bpm") or None
                    time_signature = _parse_time_signature(meta.get("time_signature"))
            except Exception as e:
                logger.warning("Failed to read chord_meta for %s: %s", song.song_name, e)

    return {
        "autochord": autochord,
        "gemini": gemini,
        "recommended_capo": recommended_capo,
        "song_key": song_key,
        "bpm": bpm,
        "time_signature": time_signature,
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


def _build_hybrid_chords(
    autochord_chords: list[ChordEntry],
    gemini_chords: list[ChordEntry],
    bpm: int | None,
    time_signature: tuple[int, int] | None,
) -> list[ChordEntry]:
    if not autochord_chords or not gemini_chords:
        return []
    try:
        merged = merge_gemini_with_autochord(
            [entry.model_dump() for entry in gemini_chords],
            [entry.model_dump() for entry in autochord_chords],
            bpm=float(bpm or 0),
            time_signature=time_signature or (4, 4),
        )
        return [ChordEntry(**entry) for entry in merged]
    except Exception as e:
        logger.warning("Failed to build hybrid chords for %s: %s", bpm, e)
        return []


def _song_duration(chords: list[ChordEntry]) -> float:
    if not chords:
        return 0.0
    return max((entry.end_time for entry in chords), default=0.0)


def _lyrics_overlap_score(
    chords: list[ChordEntry],
    lyrics: list[LyricsSegment],
) -> float:
    if not chords or not lyrics:
        return 0.0
    overlap = 0.0
    total = 0.0
    for chord in chords:
        if chord.chord == "N":
            continue
        duration = max(chord.end_time - chord.start_time, 0.0)
        if duration <= 0:
            continue
        total += duration
        for segment in lyrics:
            current = min(chord.end_time, segment.end) - max(chord.start_time, segment.start)
            if current > 0:
                overlap += current
    if total <= 0:
        return 0.0
    return min(overlap / total, 1.0)


def _score_chord_candidate(
    source: str,
    chords: list[ChordEntry],
    lyrics: list[LyricsSegment],
) -> float:
    if not chords:
        return float("-inf")
    non_silent = [entry for entry in chords if entry.chord != "N"]
    if not non_silent:
        return float("-inf")
    duration_minutes = max(_song_duration(chords) / 60.0, 1.0)
    entries_per_minute = len(non_silent) / duration_minutes
    density_score = min(entries_per_minute / 18.0, 1.0)
    unique_score = min(len({entry.chord for entry in non_silent}) / 6.0, 1.0)
    overlap_score = _lyrics_overlap_score(chords, lyrics)
    max_duration = max((entry.end_time - entry.start_time for entry in non_silent), default=0.0)
    long_duration_penalty = max(max_duration - 16.0, 0.0) / 8.0
    single_chord_penalty = 1.5 if len({entry.chord for entry in non_silent}) == 1 and _song_duration(chords) > 90 else 0.0
    hybrid_bonus = 0.15 if source == "hybrid" else 0.0
    return overlap_score * 4.0 + density_score * 1.5 + unique_score * 0.8 + hybrid_bonus - long_duration_penalty - single_chord_penalty


def _choose_primary_chords(
    autochord_chords: list[ChordEntry],
    hybrid_chords: list[ChordEntry],
    gemini_chords: list[ChordEntry],
    lyrics: list[LyricsSegment],
) -> tuple[list[ChordEntry], str | None]:
    candidates = {
        "autochord": autochord_chords,
        "hybrid": hybrid_chords,
        "gemini": gemini_chords,
    }
    available = {
        source: chords for source, chords in candidates.items() if chords
    }
    if not available:
        return [], None
    scored = {
        source: _score_chord_candidate(source, chords, lyrics)
        for source, chords in available.items()
    }
    best_source = max(scored, key=scored.get)
    logger.info("Chord source scores: %s", scored)
    return available[best_source], best_source


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


def _load_static_chords(
    storage: StorageBackend, song: SongRecord,
) -> tuple[list[StaticChordLine], str | None]:
    """Load static chord sheet (from Ultimate Guitar) from S3."""
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
        source = raw.get("source")
        raw_lines = raw.get("lines", [])
        lines = [
            StaticChordLine(
                type=line.get("type", "lyric"),
                text=line.get("text", ""),
                chords=[
                    StaticChordPosition(chord=c["chord"], position=c["position"])
                    for c in line.get("chords", [])
                ],
            )
            for line in raw_lines
            if isinstance(line, dict)
        ]
        return lines, source
    except Exception as e:
        logger.warning("Failed to read static chords for %s: %s", song.song_name, e)
        return [], None


async def _assemble_chord_options(
    storage: StorageBackend,
    song: SongRecord,
    song_id: uuid.UUID,
    chord_vote_dao: ChordVoteDAO,
    autochord_chords: list[ChordEntry],
    hybrid_chords: list[ChordEntry],
    gemini_chords: list[ChordEntry],
    recommended_capo: int | None,
    lyrics_data: dict[str, Any],
) -> list[ChordOption]:
    """Assemble chord options: system versions, user versions, then variants."""
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

    # Autochord + each available lyrics version
    if autochord_chords:
        for lyr, lyr_src, label in [
            (lyrics_data["quick_lyrics"], lyrics_data["quick_lyrics_source"], "Detected + Lyrics V1"),
            (lyrics_data["lyrics"], lyrics_data["lyrics_source"], "Detected + Lyrics V2"),
            (lyrics_data["corrected_lyrics"], lyrics_data["corrected_lyrics_source"], "Detected + Lyrics V3"),
        ]:
            if lyr:
                chord_options.append(
                    ChordOption(
                        name=label,
                        description="Auto-detected chords",
                        capo=0,
                        chords=autochord_chords,
                        lyrics=lyr,
                        lyrics_source=lyr_src,
                    )
                )

    if hybrid_chords:
        chord_options.append(
            ChordOption(
                name="Hybrid Chords",
                description="Hybrid chords",
                capo=recommended_capo or 0,
                chords=hybrid_chords,
                lyrics=best_lyrics,
                lyrics_source=best_lyrics_source,
            )
        )

    # Gemini chords + best available lyrics
    if gemini_chords:
        chord_options.append(
            ChordOption(
                name="AI Chords",
                description="Gemini-detected chords",
                capo=recommended_capo or 0,
                chords=gemini_chords,
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
