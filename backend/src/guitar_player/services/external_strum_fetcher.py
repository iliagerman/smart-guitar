"""Fetch strumming pattern data from Songsterr.

Uses Songsterr's public API and CDN to:
1. Search for a matching song
2. Get revision metadata (image hash, revision ID)
3. Download the tab JSON from CloudFront CDN
4. Extract strum direction from beat data (brushStroke.direction)

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
class SongsterrStrumResult:
    """Result of fetching and parsing Songsterr strum data."""

    source_bpm: float
    strums: list[SongsterrStrum] = field(default_factory=list)
    matched_artist: str = ""
    matched_title: str = ""


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


def _find_guitar_track_index(song_data: dict) -> int | None:
    """Find the best guitar track from search results."""
    tracks = song_data.get("tracks", [])
    if not tracks:
        return None

    # Prefer the popularTrackGuitar
    popular = song_data.get("popularTrackGuitar")
    if popular is not None and 0 <= popular < len(tracks):
        return popular

    # Fall back to defaultTrack
    default = song_data.get("defaultTrack")
    if default is not None and 0 <= default < len(tracks):
        return default

    # Search for guitar tracks by instrument name
    for i, track in enumerate(tracks):
        instrument = track.get("instrument", "").lower()
        if "guitar" in instrument:
            return i

    return 0  # fallback to first track


def _parse_tab_json(
    tab_data: dict, source_bpm: float
) -> list[SongsterrStrum]:
    """Parse Songsterr tab JSON to extract strum events with timing.

    The tab JSON has measures → voices → beats → notes structure.
    Beats can have a `brushStroke` field with explicit direction.
    """
    measures = tab_data.get("measures", [])
    if not measures:
        return []

    # Get tempo changes from automations
    tempo_changes: dict[int, float] = {}
    automations = tab_data.get("automations", {})
    for tempo_entry in automations.get("tempo", []):
        measure_idx = tempo_entry.get("measure", 0)
        bpm = tempo_entry.get("bpm", source_bpm)
        tempo_changes[measure_idx] = float(bpm)

    strums: list[SongsterrStrum] = []
    current_time = 0.0
    current_beat_pos = 0.0
    current_bpm = source_bpm

    for measure_idx, measure in enumerate(measures):
        # Check for tempo change
        if measure_idx in tempo_changes:
            current_bpm = tempo_changes[measure_idx]

        signature = measure.get("signature", [4, 4])
        beat_unit = signature[1] if len(signature) > 1 else 4

        voices = measure.get("voices", [])
        if not voices:
            # Empty measure — advance by measure duration
            beats_in_measure = signature[0] if signature else 4
            measure_duration = (beats_in_measure * 60.0) / current_bpm * (4.0 / beat_unit)
            current_time += measure_duration
            current_beat_pos += beats_in_measure
            continue

        # Process first voice only
        voice = voices[0] if isinstance(voices[0], dict) else {"beats": voices[0]}
        beats = voice.get("beats", [])

        for beat in beats:
            notes = beat.get("notes", [])
            beat_type = beat.get("type", 4)  # duration type: 1=whole, 2=half, 4=quarter, 8=eighth, etc.

            # Calculate beat duration in seconds
            if beat_type <= 0:
                beat_type = 4
            beat_duration = (4.0 / beat_type) * (60.0 / current_bpm)

            # Apply dotted
            if beat.get("dotted"):
                beat_duration *= 1.5
            elif beat.get("doubleDotted"):
                beat_duration *= 1.75

            # Apply tuplet
            tuplet = beat.get("tuplet")
            if tuplet and isinstance(tuplet, dict):
                enters = tuplet.get("enters", 1)
                times = tuplet.get("times", 1)
                if enters > 0 and times > 0:
                    beat_duration *= times / enters

            if notes and not beat.get("rest"):
                # Determine direction
                brush = beat.get("brushStroke")
                direction = None
                if brush and isinstance(brush, dict):
                    direction = brush.get("direction")

                if not direction:
                    # Check upStroke/downStroke flags
                    if beat.get("upStroke"):
                        direction = "up"
                    else:
                        direction = "down"  # default

                if direction in ("down", "up"):
                    strums.append(
                        SongsterrStrum(
                            time_seconds=current_time,
                            direction=direction,
                            num_strings=len(notes),
                            beat_position=current_beat_pos,
                        )
                    )

            current_time += beat_duration
            current_beat_pos += 4.0 / beat_type

    return strums


async def fetch_songsterr_strums(
    artist: str,
    title: str,
    timeout_seconds: float = 15.0,
) -> SongsterrStrumResult | None:
    """Search Songsterr, download tab JSON, and extract strum patterns.

    Returns SongsterrStrumResult with strum events, or None if not found.
    """
    query = f"{artist} {title}"
    logger.info("Songsterr search: %r", query)

    try:
        async with httpx.AsyncClient(
            timeout=timeout_seconds, follow_redirects=True
        ) as client:
            # Step 1: Search for the song
            resp = await client.get(
                _SONGSTERR_SEARCH_URL,
                params={"pattern": query, "size": 10},
            )
            resp.raise_for_status()
            results = resp.json()

            if not results:
                logger.info("Songsterr: no results for %r", query)
                return None

            # Step 2: Find best match
            best_result = None
            best_score = 0.0
            for r in results:
                r_artist = r.get("artist", "")
                r_title = r.get("title", "")
                score = _match_score(artist, title, r_artist, r_title)
                if score > best_score:
                    best_score = score
                    best_result = r

            if best_score < 1.0 or best_result is None:
                logger.info(
                    "Songsterr: no good match for %r (best_score=%.2f)",
                    query,
                    best_score,
                )
                return None

            song_id = best_result["songId"]
            matched_artist = best_result.get("artist", "")
            matched_title = best_result.get("title", "")
            logger.info(
                "Songsterr: matched %r by %r (id=%d, score=%.2f)",
                matched_title,
                matched_artist,
                song_id,
                best_score,
            )

            # Find the guitar track
            track_idx = _find_guitar_track_index(best_result)
            if track_idx is None:
                logger.info("Songsterr: no guitar track found for song %d", song_id)
                return None

            # Step 3: Get metadata for revision ID and image hash
            meta_resp = await client.get(f"{_SONGSTERR_META_URL}/{song_id}")
            meta_resp.raise_for_status()
            meta = meta_resp.json()

            revision_id = meta.get("revisionId")
            image = meta.get("image")

            if not revision_id:
                logger.info("Songsterr: no revision ID for song %d", song_id)
                return None

            # Step 4: Download tab JSON from CDN
            tab_data = None
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
                            tab_data = json.loads(gzip.decompress(raw))
                        except (gzip.BadGzipFile, OSError):
                            tab_data = json.loads(raw)
                        break
                except Exception:
                    continue

            if not tab_data:
                logger.info(
                    "Songsterr: could not download tab data for song %d", song_id
                )
                return None

            # Step 5: Get source BPM from tempo automations
            source_bpm = 120.0
            tempo_entries = tab_data.get("automations", {}).get("tempo", [])
            if tempo_entries:
                source_bpm = float(tempo_entries[0].get("bpm", 120))

            # Step 6: Parse strum events
            strums = _parse_tab_json(tab_data, source_bpm)

            if not strums:
                logger.info("Songsterr: no strum events extracted for song %d", song_id)
                return None

            logger.info(
                "Songsterr: extracted %d strums (bpm=%.1f, %d down, %d up) for %r by %r",
                len(strums),
                source_bpm,
                sum(1 for s in strums if s.direction == "down"),
                sum(1 for s in strums if s.direction == "up"),
                matched_title,
                matched_artist,
            )

            return SongsterrStrumResult(
                source_bpm=source_bpm,
                strums=strums,
                matched_artist=matched_artist,
                matched_title=matched_title,
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
