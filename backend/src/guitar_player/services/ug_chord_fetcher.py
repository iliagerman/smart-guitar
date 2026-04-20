"""Fetch chord sheets from Ultimate Guitar.

Uses curl_cffi with Chrome TLS impersonation to bypass Cloudflare.
1. Search for a matching song by artist + title
2. Fetch the highest-rated chord sheet
3. Parse the [ch]...[/ch] content into structured StaticChordLine data

All errors are non-fatal — returns None on failure.
"""

import html as html_mod
import json
import logging
import re
from dataclasses import dataclass, field

from curl_cffi.requests import AsyncSession

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT = 15

# Section header patterns: [Verse 1], [Chorus], [Intro], etc.
_SECTION_PATTERN = re.compile(r"^\[([^\]]+)\]$")

# UG inline chord tag: [ch]Am[/ch]
_CHORD_TAG_PATTERN = re.compile(r"\[ch\](.*?)\[/ch\]")

# Tab tag wrapping: [tab]...[/tab]
_TAB_WRAPPER = re.compile(r"\[/?tab\]")

# UG data content attribute
_DATA_CONTENT_PATTERN = re.compile(r'class="js-store"[^>]*data-content="([^"]+)"')


@dataclass
class StaticChordPosition:
    """A chord placed at a character offset within a lyrics line."""

    chord: str
    position: int


@dataclass
class StaticChordLine:
    """A single line in a static chord sheet."""

    type: str  # "lyric" | "section" | "instrumental" | "empty"
    text: str
    chords: list[StaticChordPosition] = field(default_factory=list)


@dataclass
class UGChordSheet:
    """Result of fetching a chord sheet from Ultimate Guitar."""

    lines: list[StaticChordLine]
    source_url: str = ""
    capo: int = 0
    key: str = ""
    matched_artist: str = ""
    matched_title: str = ""
    rating: float = 0.0


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
    query_artist: str, query_title: str, result_artist: str, result_title: str,
) -> float:
    """Score a UG result against our query. Higher = better."""
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


def _is_chord_only_line(line: str) -> bool:
    """Check if a line consists only of chord tags and whitespace."""
    stripped = _CHORD_TAG_PATTERN.sub("", line).strip()
    return len(stripped) == 0 and _CHORD_TAG_PATTERN.search(line) is not None


def _extract_chords_with_positions(line: str) -> list[StaticChordPosition]:
    """Extract chord names and their character positions from a line with [ch] tags."""
    chords: list[StaticChordPosition] = []
    visual_pos = 0
    remaining = line
    while remaining:
        match = _CHORD_TAG_PATTERN.search(remaining)
        if not match:
            break
        before = remaining[:match.start()]
        visual_pos += len(before)
        chord_name = match.group(1)
        chords.append(StaticChordPosition(chord=chord_name, position=visual_pos))
        visual_pos += len(chord_name)
        remaining = remaining[match.end():]
    return chords


def _get_plain_text(line: str) -> str:
    """Remove all [ch]...[/ch] tags, returning plain text."""
    return _CHORD_TAG_PATTERN.sub(lambda m: m.group(1), line)


def parse_ug_content(raw_content: str) -> list[StaticChordLine]:
    """Parse Ultimate Guitar chord content into structured lines.

    Handles two formats:
    1. Inline: chords mixed with lyrics via [ch]...[/ch] tags
    2. Two-line: chord-only line followed by lyrics line
    """
    content = _TAB_WRAPPER.sub("", raw_content)
    raw_lines = content.split("\n")
    lines: list[StaticChordLine] = []
    i = 0

    while i < len(raw_lines):
        line = raw_lines[i]
        stripped = line.rstrip()

        if not stripped:
            lines.append(StaticChordLine(type="empty", text=""))
            i += 1
            continue

        plain = _get_plain_text(stripped)
        section_match = _SECTION_PATTERN.match(plain.strip())
        if section_match:
            lines.append(StaticChordLine(type="section", text=section_match.group(1)))
            i += 1
            continue

        if _is_chord_only_line(stripped):
            chord_positions = _extract_chords_with_positions(stripped)
            if i + 1 < len(raw_lines):
                next_line = raw_lines[i + 1].rstrip()
                next_plain = _get_plain_text(next_line)
                next_section = _SECTION_PATTERN.match(next_plain.strip())
                if next_plain and not next_section and not _is_chord_only_line(next_line):
                    lyrics_text = next_plain
                    if _CHORD_TAG_PATTERN.search(next_line):
                        extra_chords = _extract_chords_with_positions(next_line)
                        chord_positions.extend(extra_chords)
                        chord_positions.sort(key=lambda c: c.position)
                    lines.append(StaticChordLine(
                        type="lyric", text=lyrics_text, chords=chord_positions,
                    ))
                    i += 2
                    continue
            lines.append(StaticChordLine(type="instrumental", text="", chords=chord_positions))
            i += 1
            continue

        if _CHORD_TAG_PATTERN.search(stripped):
            chord_positions = _extract_chords_with_positions(stripped)
            lyrics_text = _get_plain_text(stripped)
            lines.append(StaticChordLine(type="lyric", text=lyrics_text, chords=chord_positions))
            i += 1
            continue

        lines.append(StaticChordLine(type="lyric", text=stripped, chords=[]))
        i += 1

    return lines


def _extract_page_data(page_text: str) -> dict | None:
    """Extract the JSON store data from a UG page's data-content attribute."""
    match = _DATA_CONTENT_PATTERN.search(page_text)
    if not match:
        return None
    try:
        return json.loads(html_mod.unescape(match.group(1)))
    except (json.JSONDecodeError, ValueError):
        return None


def _find_best_chord_tab(tabs: list[dict], artist: str, title: str) -> dict | None:
    """Find the best-matching Chords-type tab from search results."""
    chord_tabs = [
        t for t in tabs
        if t.get("type", "").lower() == "chords"
    ]
    if not chord_tabs:
        return None

    best_tab = None
    best_score = 0.0

    for tab in chord_tabs:
        match = _match_score(
            artist, title,
            tab.get("artist_name", ""), tab.get("song_name", ""),
        )
        rating = tab.get("rating", 0) or 0
        combined = match + (rating / 10.0)
        if combined > best_score:
            best_score = combined
            best_tab = tab

    if best_score < 0.7 or best_tab is None:
        logger.info(
            "UG: no good match for %r by %r (best_score=%.2f)",
            title, artist, best_score,
        )
        return None

    logger.info(
        "UG: matched %r by %r (id=%s, rating=%.1f, score=%.2f)",
        best_tab.get("song_name", ""), best_tab.get("artist_name", ""),
        best_tab.get("id", ""), best_tab.get("rating", 0), best_score,
    )
    return best_tab


async def fetch_ug_chord_sheet(
    artist: str,
    title: str,
    timeout_seconds: int = _REQUEST_TIMEOUT,
) -> UGChordSheet | None:
    """Search Ultimate Guitar and fetch the best chord sheet for a song.

    Uses curl_cffi with Chrome impersonation to bypass Cloudflare.
    Returns a parsed UGChordSheet or None if no match found.
    """
    query = f"{artist} {title}"
    logger.info("UG search: %r", query)

    try:
        async with AsyncSession() as session:
            # Step 1: Search
            search_resp = await session.get(
                "https://www.ultimate-guitar.com/search.php",
                params={"search_type": "title", "value": query},
                impersonate="chrome",
                timeout=timeout_seconds,
            )
            if search_resp.status_code != 200:
                logger.warning("UG search returned %d", search_resp.status_code)
                return None

            search_data = _extract_page_data(search_resp.text)
            if not search_data:
                logger.info("UG: could not extract page data from search results")
                return None

            result_groups = (
                search_data.get("store", {})
                .get("page", {})
                .get("data", {})
                .get("results", [])
            )

            # Flatten result groups into a single list of tabs
            all_tabs: list[dict] = []
            for group in result_groups:
                if isinstance(group, dict):
                    if "results" in group:
                        all_tabs.extend(group["results"])
                    elif "song_name" in group:
                        all_tabs.append(group)

            if not all_tabs:
                logger.info("UG: no results for %r", query)
                return None

            best_tab = _find_best_chord_tab(all_tabs, artist, title)
            if not best_tab:
                return None

            tab_url = best_tab.get("tab_url", "")
            if not tab_url:
                logger.info("UG: no tab_url for matched tab")
                return None

            # Step 2: Fetch the tab page
            tab_resp = await session.get(
                tab_url, impersonate="chrome", timeout=timeout_seconds,
            )
            if tab_resp.status_code != 200:
                logger.warning("UG tab page returned %d for %s", tab_resp.status_code, tab_url)
                return None

            tab_data = _extract_page_data(tab_resp.text)
            if not tab_data:
                logger.info("UG: could not extract page data from tab page")
                return None

            content = (
                tab_data.get("store", {})
                .get("page", {})
                .get("data", {})
                .get("tab_view", {})
                .get("wiki_tab", {})
                .get("content", "")
            )
            if not content:
                logger.info("UG: no wiki_tab content for %s", tab_url)
                return None

            # Step 3: Parse
            parsed_lines = parse_ug_content(content)
            if not parsed_lines:
                logger.info("UG: parsed content is empty for %s", tab_url)
                return None

            capo = 0
            capo_match = re.search(r"capo[:\s]*(\d+)", content, re.IGNORECASE)
            if capo_match:
                capo = int(capo_match.group(1))

            key = best_tab.get("tonality_name", "")

            logger.info(
                "UG: got %d lines for %r by %r (rating=%.1f)",
                len(parsed_lines),
                best_tab.get("song_name", ""),
                best_tab.get("artist_name", ""),
                best_tab.get("rating", 0),
            )

            return UGChordSheet(
                lines=parsed_lines,
                source_url=tab_url,
                capo=capo,
                key=key,
                matched_artist=best_tab.get("artist_name", ""),
                matched_title=best_tab.get("song_name", ""),
                rating=best_tab.get("rating", 0) or 0,
            )

    except Exception:
        logger.warning("UG fetch failed for %r", query, exc_info=True)
        return None
