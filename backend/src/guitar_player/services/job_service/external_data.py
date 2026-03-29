"""Background tasks for external data: stems merge, tabs, and Songsterr/strum fetching."""

import logging
import time
import uuid
from collections import Counter

from guitar_player.app_state import get_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import safe_session
from guitar_player.services.processing_service import ProcessingService

from .helpers import find_stem, score_tutorial_link, search_youtube_tutorial, stem_candidates

logger = logging.getLogger(__name__)


async def merge_vocals_guitar_only(song_id: uuid.UUID) -> None:
    """Merge vocals + guitar stems for an existing song if both are available."""
    try:
        storage = get_storage()
    except Exception:
        return

    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return

        if song.vocals_guitar_key and storage.file_exists(song.vocals_guitar_key):
            return

        vg_key = find_stem(storage, song.song_name, "vocals_guitar")
        if vg_key:
            await song_dao.update_by_id(song_id, vocals_guitar_key=vg_key)
            await song_dao.commit()
            return

        vocals_candidates = [
            getattr(song, "vocals_key", None),
            *stem_candidates(song.song_name, "vocals", "vocals_isolated"),
        ]
        vocals_key = next(
            (k for k in vocals_candidates if k and storage.file_exists(k)), None
        )

        guitar_candidates = [
            getattr(song, "guitar_key", None),
            *stem_candidates(song.song_name, "guitar", "guitar_isolated"),
        ]
        guitar_key = next(
            (k for k in guitar_candidates if k and storage.file_exists(k)), None
        )

        if not vocals_key or not guitar_key:
            return

        song_name = song.song_name

    t0 = time.monotonic()
    try:
        from guitar_player.services.audio_merge import merge_vocals_guitar_stem

        logger.info(
            "Vocals+guitar merge starting",
            extra={
                "event_type": "background_task_start",
                "task": "merge_only",
                "song_id": str(song_id),
                "vocals_key": vocals_key,
                "guitar_key": guitar_key,
            },
        )
        result_key = await merge_vocals_guitar_stem(
            storage, song_name, vocals_key, guitar_key
        )
        if not result_key:
            return
        elapsed_s = time.monotonic() - t0
        logger.info(
            "Vocals+guitar merge finished (%.1fs)", elapsed_s,
            extra={
                "event_type": "background_task_done",
                "task": "merge_only",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
            },
        )
    except Exception as e:
        elapsed_s = time.monotonic() - t0
        logger.warning(
            "Vocals+guitar merge failed (%.1fs): %s", elapsed_s, e,
            extra={
                "event_type": "background_task_failed",
                "task": "merge_only",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
                "error": str(e),
            },
        )
        return

    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return
        vg_key = find_stem(storage, song.song_name, "vocals_guitar")
        if vg_key:
            await song_dao.update_by_id(
                song_id, vocals_guitar_key=vg_key, merge_attempted_at=None
            )
            await song_dao.commit()


async def generate_tabs_only(song_id: uuid.UUID) -> None:
    """Generate tabs for an existing song if the guitar stem is available."""
    try:
        storage = get_storage()
    except Exception:
        return

    from guitar_player.config import get_settings

    settings = get_settings()

    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return

        tabs_key = f"{song.song_name}/tabs.json"
        if storage.file_exists(tabs_key):
            if not song.tabs_key:
                await song_dao.update_by_id(song_id, tabs_key=tabs_key)
                await song_dao.commit()
            return

        guitar_candidates = [
            getattr(song, "guitar_key", None),
            *stem_candidates(song.song_name, "guitar", "guitar_isolated"),
        ]
        guitar_key = next(
            (k for k in guitar_candidates if k and storage.file_exists(k)), None
        )
        if not guitar_key:
            return

        song_name = song.song_name

    t0 = time.monotonic()
    try:
        processing = ProcessingService(settings)
        service_path = storage.resolve_service_path(guitar_key)
        logger.info(
            "Tabs generation starting song_id=%s guitar_key=%s",
            song_id, guitar_key,
            extra={
                "event_type": "background_task_start",
                "task": "tabs_only",
                "song_id": str(song_id),
                "guitar_key": guitar_key,
            },
        )
        await processing.generate_tabs(service_path)
        elapsed_s = time.monotonic() - t0
        logger.info(
            "Tabs generation finished (%.1fs) song_id=%s", elapsed_s, song_id,
            extra={
                "event_type": "background_task_done",
                "task": "tabs_only",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
            },
        )
    except Exception as e:
        elapsed_s = time.monotonic() - t0
        logger.warning(
            "Tabs generation failed (%.1fs): %s song_id=%s",
            elapsed_s, e, song_id,
            extra={
                "event_type": "background_task_failed",
                "task": "tabs_only",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
                "error": str(e),
            },
        )
        try:
            async with safe_session() as session:
                song_dao = SongDAO(session)
                await song_dao.update_by_id(song_id, tabs_failed=True)
                await song_dao.commit()
        except Exception:
            logger.debug("Failed to persist tabs_failed for %s", song_id, exc_info=True)
        return

    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name:
            return
        tabs_key = f"{song_name}/tabs.json"
        if storage.file_exists(tabs_key):
            await song_dao.update_by_id(
                song_id, tabs_key=tabs_key, tabs_failed=False, tabs_attempted_at=None
            )
            await song_dao.commit()


def extract_measure_pattern(
    strums: list,
    section_start: float,
    section_end: float,
    measure_duration: float,
    max_symbols: int = 8,
) -> list[str]:
    """Find the most common strum direction pattern per measure."""
    buckets: Counter[str] = Counter()
    patterns: dict[str, list[str]] = {}

    t = section_start
    while t < section_end:
        t_end = t + measure_duration
        measure_strums = [s for s in strums if t <= s.time_seconds < t_end]
        if len(measure_strums) >= 2:
            dirs = [s.direction for s in measure_strums[:max_symbols]]
            key = "".join(d[0] for d in dirs)
            buckets[key] += 1
            if key not in patterns:
                patterns[key] = dirs
        t = t_end

    if not buckets:
        return []

    best_key = buckets.most_common(1)[0][0]
    return patterns[best_key]


async def fetch_external_strums(song_id: uuid.UUID) -> None:
    """Fetch tab data from Songsterr, align to audio, and store."""
    try:
        storage = get_storage()
    except Exception:
        return

    from guitar_player.config import get_settings

    settings = get_settings()
    ext_cfg = settings.external_strums
    if not ext_cfg.enabled:
        return

    async with safe_session() as session:
        song_dao = SongDAO(session)
        song = await song_dao.get_by_id(song_id)
        if not song or not song.song_name or not song.artist:
            return
        artist = song.artist
        title = song.title
        song_name = song.song_name
        audio_duration = float(song.duration_seconds or 300)

    t0 = time.monotonic()
    try:
        result = await _fetch_songsterr_result(artist, title, ext_cfg)
        tabs_data_out, source_bpm = _align_songsterr_notes(
            result, storage, song_name, audio_duration
        )

        sections_data, strum_notes, tutorial_url, tutorial_links = (
            await _fetch_strum_patterns(settings, artist, title, audio_duration)
        )

        # Use LLM BPM if available (often more accurate than Songsterr).
        # source_bpm is already set from Songsterr; override only if LLM provided one.

        songsterr_output = _build_songsterr_output(
            result, tabs_data_out, sections_data, source_bpm,
            artist, title, strum_notes, tutorial_url, tutorial_links,
        )

        songsterr_key = f"{song_name}/songsterr_data.json"
        storage.write_json(songsterr_key, songsterr_output)

        if result and result.lyrics_text:
            _write_songsterr_lyrics(
                storage, song_name, result.lyrics_text, sections_data
            )

        elapsed_s = time.monotonic() - t0
        logger.info(
            "Songsterr: wrote %d notes, %d sections (%.1fs) song_id=%s",
            len(tabs_data_out), len(sections_data), elapsed_s, song_id,
            extra={
                "event_type": "background_task_done",
                "task": "external_strums",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
                "note_count": len(tabs_data_out),
                "section_count": len(sections_data),
            },
        )

        async with safe_session() as session:
            song_dao = SongDAO(session)
            await song_dao.update_by_id(
                song_id,
                external_strums_key=songsterr_key,
                external_strums_failed=False,
                external_strums_attempted_at=None,
            )
            await song_dao.commit()

    except Exception as e:
        elapsed_s = time.monotonic() - t0
        logger.warning(
            "External strums fetch failed (%.1fs): %s song_id=%s",
            elapsed_s, e, song_id,
            extra={
                "event_type": "background_task_failed",
                "task": "external_strums",
                "song_id": str(song_id),
                "elapsed_s": round(elapsed_s, 1),
                "error": str(e),
            },
        )
        try:
            async with safe_session() as session:
                song_dao = SongDAO(session)
                await song_dao.update_by_id(song_id, external_strums_failed=True)
                await song_dao.commit()
        except Exception:
            logger.debug(
                "Failed to persist external_strums_failed for %s",
                song_id, exc_info=True,
            )


async def _fetch_songsterr_result(artist: str, title: str, ext_cfg):
    """Fetch and parse full tab data from Songsterr."""
    from guitar_player.services.external_strum_fetcher import fetch_songsterr_data

    result = await fetch_songsterr_data(
        artist=artist,
        title=title,
        timeout_seconds=ext_cfg.fetch_timeout_seconds,
    )
    if not result or (not result.strums and not result.notes):
        logger.info(
            "No Songsterr data for %r by %r -- will still attempt strum/tutorial lookup",
            title, artist,
        )
        return None
    return result


def _align_songsterr_notes(
    result, storage, song_name: str, audio_duration: float,
) -> tuple[list[dict], float]:
    """Align Songsterr notes to audio timing. Returns (tabs_data, source_bpm)."""
    if not result:
        return [], 120.0

    beat_times: list[float] = []
    detected_bpm = result.source_bpm

    tabs_key = f"{song_name}/tabs.json"
    if storage.file_exists(tabs_key):
        try:
            tabs_data = storage.read_json(tabs_key)
            if isinstance(tabs_data, dict):
                rhythm = tabs_data.get("rhythm")
                if isinstance(rhythm, dict) and rhythm.get("beat_times"):
                    beat_times = rhythm["beat_times"]
                    detected_bpm = rhythm.get("bpm", detected_bpm)
        except Exception:
            pass

    if not beat_times:
        beat_interval = 60.0 / result.source_bpm
        beat_times = [
            round(i * beat_interval, 6)
            for i in range(int(audio_duration / beat_interval) + 1)
        ]

    from guitar_player.services.strum_aligner import _compute_cross_correlation_offset

    source_bpm = result.source_bpm or 120.0
    tempo_ratio = detected_bpm / source_bpm
    best_ratio = tempo_ratio
    for candidate in [tempo_ratio, tempo_ratio * 2, tempo_ratio / 2]:
        if abs(candidate - 1.0) < abs(best_ratio - 1.0):
            best_ratio = candidate

    note_times = [n.time_seconds * best_ratio for n in result.notes[:200]]
    align_offset, _ = (
        _compute_cross_correlation_offset(note_times, beat_times)
        if note_times
        else (0.0, 0.0)
    )

    tabs_data_out: list[dict] = []
    for n in result.notes:
        aligned_time = round(n.time_seconds * best_ratio + align_offset, 4)
        aligned_end = round(aligned_time + n.duration_seconds * best_ratio, 4)
        if aligned_time < -0.5:
            continue
        midi_pitch = 0
        if n.string < len(result.tuning):
            midi_pitch = result.tuning[n.string] + n.fret
        tabs_data_out.append({
            "start_time": aligned_time,
            "end_time": aligned_end,
            "string": n.string,
            "fret": n.fret,
            "midi_pitch": midi_pitch,
            "confidence": 0.95,
        })

    return tabs_data_out, source_bpm


async def _fetch_strum_patterns(
    settings, artist: str, title: str, audio_duration: float,
) -> tuple[list[dict], str, str, list[dict]]:
    """Fetch strum patterns via Tavily + LLM, with YouTube fallback."""
    sections_data: list[dict] = []
    strum_notes: str = ""
    tutorial_url: str = ""
    tutorial_links: list[dict] = []

    try:
        from guitar_player.services.llm_service import LlmService

        tavily_api_key = settings.tavily.api_key
        llm = LlmService(settings)
        llm_result = await llm.lookup_strum_patterns(
            artist, title, tavily_api_key=tavily_api_key,
        )
        if llm_result and llm_result.sections:
            for llm_sec in llm_result.sections:
                sections_data.append({
                    "name": llm_sec.section,
                    "start_time": 0.0,
                    "end_time": round(audio_duration, 4),
                    "strum_pattern": llm_sec.pattern,
                    "llm_pattern": llm_sec.pattern,
                })
            if llm_result.bpm and llm_result.bpm > 0:
                pass  # source_bpm handled by caller
            if llm_result.notes:
                strum_notes = llm_result.notes

            youtube_links = [
                link for link in llm_result.tutorial_links
                if "youtube.com" in link.url or "youtu.be" in link.url
            ]
            if youtube_links:
                scored = [
                    (link, score_tutorial_link(link.title, link.url))
                    for link in youtube_links
                ]
                scored.sort(key=lambda x: x[1], reverse=True)
                tutorial_url = scored[0][0].url
                tutorial_links = [
                    {"url": link.url, "title": link.title} for link, _s in scored
                ]

        if not tutorial_url:
            tutorial_url, fallback_links = await search_youtube_tutorial(title, artist)
            if fallback_links and not tutorial_links:
                tutorial_links = fallback_links

    except Exception as e:
        logger.warning("Tavily+LLM strum pattern lookup failed: %s", e)

    return sections_data, strum_notes, tutorial_url, tutorial_links


def _build_songsterr_output(
    result, tabs_data_out: list[dict], sections_data: list[dict],
    source_bpm: float, artist: str, title: str,
    strum_notes: str, tutorial_url: str, tutorial_links: list[dict],
) -> dict:
    """Assemble the songsterr_data.json output."""
    output: dict = {
        "tabs": tabs_data_out,
        "sections": sections_data,
        "source_bpm": source_bpm,
        "matched_artist": result.matched_artist if result else artist,
        "matched_title": result.matched_title if result else title,
        "time_signature": list(result.time_signature) if result else [4, 4],
    }
    if strum_notes:
        output["strum_notes"] = strum_notes
    if tutorial_url:
        output["tutorial_url"] = tutorial_url
    if tutorial_links:
        output["tutorial_links"] = tutorial_links
    if result and result.lyrics_text:
        output["lyrics_text"] = result.lyrics_text
    return output


def _write_songsterr_lyrics(
    storage, song_name: str, lyrics_text: str, sections_data: list[dict],
) -> None:
    """Write Songsterr lyrics as a standalone lyrics file."""
    lyrics_lines = [line.strip() for line in lyrics_text.split("\n") if line.strip()]
    if not lyrics_lines or not sections_data:
        return

    vocal_sections = [
        s for s in sections_data
        if s["name"].lower() not in (
            "intro", "outro", "instrumental", "solo", "breakdown"
        )
    ]
    if not vocal_sections:
        vocal_sections = sections_data

    segments = _distribute_lyrics_across_sections(lyrics_lines, vocal_sections)
    if segments:
        storage.write_json(
            f"{song_name}/lyrics_songsterr.json",
            {"segments": segments, "source": "songsterr"},
        )


def _distribute_lyrics_across_sections(
    lyrics_lines: list[str], vocal_sections: list[dict],
) -> list[dict]:
    """Distribute lyrics lines evenly across vocal sections with word-level timing."""
    segments: list[dict] = []
    lines_per_section = max(1, len(lyrics_lines) // len(vocal_sections))
    line_idx = 0

    for sec in vocal_sections:
        sec_lines = lyrics_lines[line_idx:line_idx + lines_per_section]
        if not sec_lines:
            break
        seg_list = _lines_to_segments(sec_lines, sec["start_time"], sec["end_time"])
        segments.extend(seg_list)
        line_idx += lines_per_section

    # Handle remaining lines.
    if line_idx < len(lyrics_lines) and vocal_sections:
        last_sec = vocal_sections[-1]
        remaining = lyrics_lines[line_idx:]
        dur = (last_sec["end_time"] - last_sec["start_time"]) / max(1, len(remaining))
        for j, line_text in enumerate(remaining):
            seg_start = last_sec["end_time"] + j * dur
            clean_text = line_text.replace("-", "").replace("(", "").replace(")", "")
            segments.append({
                "start": round(seg_start, 3),
                "end": round(seg_start + dur, 3),
                "text": clean_text,
                "words": [],
            })

    return segments


def _lines_to_segments(
    lines: list[str], sec_start: float, sec_end: float,
) -> list[dict]:
    """Convert lyric lines into timed segments with word-level timing."""
    sec_duration = sec_end - sec_start
    line_duration = sec_duration / len(lines)
    segments: list[dict] = []

    for j, line_text in enumerate(lines):
        seg_start = sec_start + j * line_duration
        seg_end = seg_start + line_duration
        raw_words = line_text.replace("-", " ").split()
        if raw_words:
            word_dur = (seg_end - seg_start) / len(raw_words)
            words = [
                {
                    "word": w,
                    "start": round(seg_start + k * word_dur, 3),
                    "end": round(seg_start + (k + 1) * word_dur, 3),
                }
                for k, w in enumerate(raw_words)
            ]
        else:
            words = []
        clean_text = line_text.replace("-", "").replace("(", "").replace(")", "")
        segments.append({
            "start": round(seg_start, 3),
            "end": round(seg_end, 3),
            "text": clean_text,
            "words": words,
        })

    return segments
