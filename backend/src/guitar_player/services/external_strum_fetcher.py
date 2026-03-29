"""Fetch tab data from Songsterr.

Uses Songsterr's public API and CDN to:
1. Search for a matching song
2. Get revision metadata (image hash, revision ID)
3. Download the tab JSON from CloudFront CDN
4. Extract notes (fret/string), strum directions, sections, and lyrics

All errors are non-fatal — returns None on failure.
"""

import gzip
import json
import logging
import re
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)

_SONGSTERR_SEARCH_URL = "https://www.songsterr.com/api/songs"
_SONGSTERR_META_URL = "https://www.songsterr.com/api/meta"
_CDN_DOMAINS = ["dqsljvtekg760", "d3d3l6a6rcgkaf"]


@dataclass
class SongsterrStrum:
    """A single strum from Songsterr tab data."""

    time_seconds: float
    direction: str  # "down" | "up"
    num_strings: int
    beat_position: float  # position in beats from song start


@dataclass
class SongsterrNote:
    """A single note from Songsterr tab data."""

    time_seconds: float
    duration_seconds: float
    string: int  # 0=low E (remapped from Songsterr's 0=high E)
    fret: int
    beat_position: float


@dataclass
class SongsterrSection:
    """A song section marker from Songsterr tab data."""

    name: str  # "Intro", "Verse 1", "Chorus", etc.
    start_measure: int
    start_time: float


@dataclass
class SongsterrResult:
    """Result of fetching and parsing Songsterr data."""

    source_bpm: float
    strums: list[SongsterrStrum] = field(default_factory=list)
    notes: list[SongsterrNote] = field(default_factory=list)
    sections: list[SongsterrSection] = field(default_factory=list)
    tuning: list[int] = field(default_factory=list)  # MIDI values, low E to high E
    lyrics_text: str = ""
    matched_artist: str = ""
    matched_title: str = ""
    num_strings: int = 6
    time_signature: tuple[int, int] = (4, 4)  # e.g. (3, 4) for 3/4 time


# Keep old name as alias for backward compat
SongsterrStrumResult = SongsterrResult


def _normalize(text: str) -> str:
    """Normalize text for fuzzy matching."""
    text = text.lower().strip()
    text = re.sub(r"\s*\(.*?\)\s*", " ", text)
    text = re.sub(r"\s*\[.*?\]\s*", " ", text)
    text = re.sub(r"\b(feat\.?|ft\.?|featuring)\b.*", "", text)
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _match_score(
    query_artist: str, query_title: str, result_artist: str, result_title: str
) -> float:
    """Score a Songsterr result against our query. Higher = better."""
    q_artist = _normalize(query_artist)
    q_title = _normalize(query_title)
    r_artist = _normalize(result_artist)
    r_title = _normalize(result_title)

    score = 0.0

    if q_artist == r_artist:
        score += 1.0
    elif q_artist in r_artist or r_artist in q_artist:
        score += 0.7
    else:
        q_words = set(q_artist.split())
        r_words = set(r_artist.split())
        overlap = len(q_words & r_words)
        if overlap > 0:
            score += 0.4 * (overlap / max(len(q_words), 1))

    if q_title == r_title:
        score += 1.0
    elif q_title in r_title or r_title in q_title:
        score += 0.7
    else:
        q_words = set(q_title.split())
        r_words = set(r_title.split())
        overlap = len(q_words & r_words)
        if overlap > 0:
            score += 0.4 * (overlap / max(len(q_words), 1))

    return score


def _rank_guitar_track_indices(song_data: dict, max_tracks: int = 3) -> list[int]:
    """Rank guitar tracks by preference, returning up to *max_tracks* indices.

    Priority: acoustic guitar > popularTrackGuitar > defaultTrack > any guitar > track 0.
    """
    tracks = song_data.get("tracks", [])
    if not tracks:
        return []

    seen: set[int] = set()
    ranked: list[int] = []

    def _add(idx: int) -> None:
        if idx not in seen and 0 <= idx < len(tracks):
            seen.add(idx)
            ranked.append(idx)

    # Prefer acoustic guitar tracks (clearer strum patterns)
    for i, track in enumerate(tracks):
        instrument = track.get("instrument", "").lower()
        if "acoustic" in instrument and "guitar" in instrument:
            _add(i)

    # Fall back to popularTrackGuitar
    popular = song_data.get("popularTrackGuitar")
    if popular is not None:
        _add(popular)

    # Fall back to defaultTrack
    default = song_data.get("defaultTrack")
    if default is not None:
        _add(default)

    # Any other guitar tracks
    for i, track in enumerate(tracks):
        instrument = track.get("instrument", "").lower()
        if "guitar" in instrument:
            _add(i)

    # Ultimate fallback to first track
    _add(0)

    return ranked[:max_tracks]


def _find_vocals_track_index(song_data: dict) -> int | None:
    """Find a track with lyrics (usually vocals, track 0)."""
    tracks = song_data.get("tracks", [])
    for i, track in enumerate(tracks):
        if track.get("withLyrics"):
            return i
    return None


def _calc_beat_duration(beat: dict, current_bpm: float) -> tuple[float, int]:
    """Calculate beat duration in seconds. Returns (duration, beat_type)."""
    beat_type = beat.get("type", 4)
    if beat_type <= 0:
        beat_type = 4

    duration = (4.0 / beat_type) * (60.0 / current_bpm)

    if beat.get("dotted"):
        duration *= 1.5
    elif beat.get("doubleDotted"):
        duration *= 1.75

    tuplet = beat.get("tuplet")
    if tuplet and isinstance(tuplet, dict):
        enters = tuplet.get("enters", 1)
        times = tuplet.get("times", 1)
        if enters > 0 and times > 0:
            duration *= times / enters

    return duration, beat_type


def _extract_beat_notes(
    beat: dict,
    num_strings: int,
    current_time: float,
    beat_duration: float,
    current_beat_pos: float,
) -> tuple[list[SongsterrNote], int]:
    """Extract fretted notes from a beat. Returns (notes, fretted_count)."""
    beat_notes = beat.get("notes", [])
    if not beat_notes or beat.get("rest"):
        return [], 0

    result: list[SongsterrNote] = []
    fretted_count = 0
    for note in beat_notes:
        if note.get("rest") or "fret" not in note or "string" not in note:
            continue
        # Remap string: Songsterr 0=high E, we use 0=low E
        mapped_string = (num_strings - 1) - note["string"]
        fretted_count += 1
        result.append(
            SongsterrNote(
                time_seconds=current_time,
                duration_seconds=beat_duration,
                string=mapped_string,
                fret=note["fret"],
                beat_position=current_beat_pos,
            )
        )
    return result, fretted_count


def _extract_strum_direction(beat: dict) -> str | None:
    """Determine strum direction from a beat's brush/stroke data."""
    brush = beat.get("brushStroke")
    if brush and isinstance(brush, dict):
        direction = brush.get("direction")
        if direction in ("down", "up"):
            return direction

    if beat.get("upStroke"):
        return "up"
    if beat.get("downStroke"):
        return "down"
    return "down"  # default for fretted notes


def _parse_tab_json(
    tab_data: dict, source_bpm: float, num_strings: int = 6,
) -> tuple[list[SongsterrStrum], list[SongsterrNote], list[SongsterrSection], tuple[int, int]]:
    """Parse Songsterr tab JSON to extract notes, strums, sections, and time signature.

    Returns (strums, notes, sections, dominant_time_signature).
    """
    from collections import Counter

    measures = tab_data.get("measures", [])
    if not measures:
        return [], [], [], (4, 4)

    tempo_changes: dict[int, float] = {}
    for entry in tab_data.get("automations", {}).get("tempo", []):
        tempo_changes[entry.get("measure", 0)] = float(entry.get("bpm", source_bpm))

    sig_counter: Counter[tuple[int, int]] = Counter()
    strums: list[SongsterrStrum] = []
    notes: list[SongsterrNote] = []
    sections: list[SongsterrSection] = []
    current_time = 0.0
    current_beat_pos = 0.0
    current_bpm = source_bpm

    for measure_idx, measure in enumerate(measures):
        if measure_idx in tempo_changes:
            current_bpm = tempo_changes[measure_idx]

        marker = measure.get("marker")
        if marker and isinstance(marker, dict) and marker.get("text"):
            sections.append(SongsterrSection(
                name=marker["text"], start_measure=measure_idx, start_time=current_time,
            ))

        signature = measure.get("signature", [4, 4])
        beat_unit = signature[1] if len(signature) > 1 else 4
        sig_counter[(signature[0] if signature else 4, beat_unit)] += 1

        voices = measure.get("voices", [])
        if not voices:
            beats_in_measure = signature[0] if signature else 4
            current_time += (beats_in_measure * 60.0) / current_bpm * (4.0 / beat_unit)
            current_beat_pos += beats_in_measure
            continue

        voice = voices[0] if isinstance(voices[0], dict) else {"beats": voices[0]}
        for beat in voice.get("beats", []):
            beat_duration, beat_type = _calc_beat_duration(beat, current_bpm)

            beat_notes, fretted_count = _extract_beat_notes(
                beat, num_strings, current_time, beat_duration, current_beat_pos,
            )
            notes.extend(beat_notes)

            if fretted_count > 0:
                direction = _extract_strum_direction(beat)
                if direction in ("down", "up"):
                    strums.append(SongsterrStrum(
                        time_seconds=current_time, direction=direction,
                        num_strings=fretted_count, beat_position=current_beat_pos,
                    ))

            current_time += beat_duration
            current_beat_pos += 4.0 / beat_type

    dominant_sig = sig_counter.most_common(1)[0][0] if sig_counter else (4, 4)
    return strums, notes, sections, dominant_sig


def _extract_lyrics(tab_data: dict) -> str:
    """Extract lyrics text from a Songsterr track's newLyrics field."""
    new_lyrics = tab_data.get("newLyrics")
    if not new_lyrics or not isinstance(new_lyrics, list):
        return ""

    lines: list[str] = []
    for entry in new_lyrics:
        text = entry.get("text", "")
        if text:
            lines.append(text)

    return "\n".join(lines)


async def _download_track_json(
    client: httpx.AsyncClient,
    song_id: int,
    revision_id: int,
    image: str | None,
    track_idx: int,
) -> dict | None:
    """Download a single track's JSON from Songsterr CDN."""
    for cdn in _CDN_DOMAINS:
        if image:
            url = f"https://{cdn}.cloudfront.net/{song_id}/{revision_id}/{image}/{track_idx}.json"
        else:
            url = f"https://{cdn}.cloudfront.net/part/{revision_id}/{track_idx}"

        try:
            tab_resp = await client.get(url)
            if tab_resp.status_code == 200:
                raw = tab_resp.content
                try:
                    return json.loads(gzip.decompress(raw))
                except (gzip.BadGzipFile, OSError):
                    return json.loads(raw)
        except Exception:
            continue
    return None


def _find_best_match(
    results: list[dict], artist: str, title: str, query: str,
) -> dict | None:
    """Find the best-matching Songsterr result by artist/title similarity."""
    best_result = None
    best_score = 0.0
    for r in results:
        score = _match_score(artist, title, r.get("artist", ""), r.get("title", ""))
        if score > best_score:
            best_score = score
            best_result = r

    if best_score < 1.0 or best_result is None:
        logger.info("Songsterr: no good match for %r (best_score=%.2f)", query, best_score)
        return None

    logger.info(
        "Songsterr: matched %r by %r (id=%d, score=%.2f)",
        best_result.get("title", ""), best_result.get("artist", ""),
        best_result["songId"], best_score,
    )
    return best_result


async def _select_best_track(
    client: httpx.AsyncClient, song_id: int, revision_id: int,
    image: str | None, ranked_tracks: list[int],
) -> tuple[dict | None, list[SongsterrStrum], list[SongsterrNote], list[SongsterrSection], tuple[int, int], float, list[int], int, int]:
    """Try ranked guitar tracks, preferring one with mixed strum directions."""
    best: dict | None = None
    b_strums: list[SongsterrStrum] = []
    b_notes: list[SongsterrNote] = []
    b_sections: list[SongsterrSection] = []
    b_sig: tuple[int, int] = (4, 4)
    b_bpm, b_num = 120.0, 6
    b_tuning: list[int] = []
    b_idx = ranked_tracks[0]

    for track_idx in ranked_tracks:
        tab = await _download_track_json(client, song_id, revision_id, image, track_idx)
        if not tab:
            continue

        bpm = 120.0
        tempo_entries = tab.get("automations", {}).get("tempo", [])
        if tempo_entries:
            bpm = float(tempo_entries[0].get("bpm", 120))

        tuning = list(reversed(tab.get("tuning", [64, 59, 55, 50, 45, 40])))
        num = tab.get("strings", 6)
        strums, notes, sections, sig = _parse_tab_json(tab, bpm, num)
        has_ups = any(s.direction == "up" for s in strums)

        if best is None or has_ups:
            best, b_strums, b_notes, b_sections = tab, strums, notes, sections
            b_sig, b_bpm, b_tuning, b_num, b_idx = sig, bpm, tuning, num, track_idx

        if has_ups:
            logger.info("Songsterr: track %d has mixed strum directions, using it", track_idx)
            break

    return best, b_strums, b_notes, b_sections, b_sig, b_bpm, b_tuning, b_num, b_idx


async def _fetch_lyrics_text(
    client: httpx.AsyncClient, tab_data: dict, track_idx: int,
    song_id: int, revision_id: int, image: str | None,
) -> str:
    """Extract lyrics from the guitar track, falling back to the vocals track."""
    text = _extract_lyrics(tab_data)
    if not text and track_idx != 0:
        vocals = await _download_track_json(client, song_id, revision_id, image, 0)
        if vocals:
            text = _extract_lyrics(vocals)
    return text


async def fetch_songsterr_data(
    artist: str,
    title: str,
    timeout_seconds: float = 15.0,
) -> SongsterrResult | None:
    """Search Songsterr, download tab JSON, and extract full tab data."""
    query = f"{artist} {title}"
    logger.info("Songsterr search: %r", query)

    try:
        async with httpx.AsyncClient(
            timeout=timeout_seconds, follow_redirects=True
        ) as client:
            resp = await client.get(_SONGSTERR_SEARCH_URL, params={"pattern": query, "size": 10})
            resp.raise_for_status()
            results = resp.json()
            if not results:
                logger.info("Songsterr: no results for %r", query)
                return None

            best_result = _find_best_match(results, artist, title, query)
            if not best_result:
                return None

            song_id = best_result["songId"]
            ranked_tracks = _rank_guitar_track_indices(best_result)
            if not ranked_tracks:
                logger.info("Songsterr: no guitar track found for song %d", song_id)
                return None

            meta_resp = await client.get(f"{_SONGSTERR_META_URL}/{song_id}")
            meta_resp.raise_for_status()
            meta = meta_resp.json()
            revision_id = meta.get("revisionId")
            image = meta.get("image")
            if not revision_id:
                logger.info("Songsterr: no revision ID for song %d", song_id)
                return None

            (tab_data, strums, notes, sections, time_sig, bpm,
             tuning, num_strings, track_idx) = await _select_best_track(
                client, song_id, revision_id, image, ranked_tracks,
            )
            if tab_data is None:
                logger.info("Songsterr: could not download tab data for song %d", song_id)
                return None

            lyrics = await _fetch_lyrics_text(
                client, tab_data, track_idx, song_id, revision_id, image,
            )
            matched_artist = best_result.get("artist", "")
            matched_title = best_result.get("title", "")

            logger.info(
                "Songsterr: extracted %d notes, %d strums, %d sections "
                "(bpm=%.1f, time_sig=%s, %d down, %d up) for %r by %r",
                len(notes), len(strums), len(sections), bpm,
                f"{time_sig[0]}/{time_sig[1]}",
                sum(1 for s in strums if s.direction == "down"),
                sum(1 for s in strums if s.direction == "up"),
                matched_title, matched_artist,
            )

            return SongsterrResult(
                source_bpm=bpm, strums=strums, notes=notes, sections=sections,
                tuning=tuning, lyrics_text=lyrics, matched_artist=matched_artist,
                matched_title=matched_title, num_strings=num_strings, time_signature=time_sig,
            )

    except httpx.HTTPStatusError as e:
        logger.warning("Songsterr HTTP error: %s", e)
        return None
    except httpx.TimeoutException:
        logger.warning("Songsterr request timed out for %r", query)
        return None
    except Exception:
        logger.warning("Songsterr fetch failed for %r", query, exc_info=True)
        return None


# Backward-compatible alias
fetch_songsterr_strums = fetch_songsterr_data
