"""Fetch chord sheets and tabs from Ultimate Guitar.

Uses curl_cffi with Chrome TLS impersonation to bypass Cloudflare.
1. Search for a matching song by artist + title
2. Fetch the top-rated chord sheets (up to 3) and best tab
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
_MAX_CHORD_VERSIONS = 3

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
    """A single chord sheet version from Ultimate Guitar."""

    lines: list[StaticChordLine]
    source_url: str = ""
    capo: int = 0
    key: str = ""
    matched_artist: str = ""
    matched_title: str = ""
    rating: float = 0.0


@dataclass
class UGFetchResult:
    """Result of fetching all data for a song from Ultimate Guitar."""

    chord_sheets: list[UGChordSheet] = field(default_factory=list)
    tab_content: str | None = None
    tab_source_url: str = ""


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
    """Parse Ultimate Guitar chord content into structured lines."""
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


def _find_matching_tabs(
    all_tabs: list[dict], artist: str, title: str, tab_type: str, limit: int,
) -> list[dict]:
    """Find top matching tabs of a given type, sorted by match score + rating."""
    type_lower = tab_type.lower()
    filtered = [
        t for t in all_tabs
        if t.get("type", "").lower() == type_lower
    ]
    if not filtered:
        return []

    scored: list[tuple[dict, float]] = []
    for tab in filtered:
        match = _match_score(
            artist, title,
            tab.get("artist_name", ""), tab.get("song_name", ""),
        )
        if match < 0.7:
            continue
        rating = tab.get("rating", 0) or 0
        combined = match + (rating / 10.0)
        scored.append((tab, combined))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [tab for tab, _ in scored[:limit]]


async def _fetch_tab_content(
    session: AsyncSession, tab: dict, timeout: int,
) -> str | None:
    """Fetch the wiki_tab content for a single tab."""
    tab_url = tab.get("tab_url", "")
    if not tab_url:
        return None

    try:
        resp = await session.get(tab_url, impersonate="chrome", timeout=timeout)
        if resp.status_code != 200:
            return None

        page_data = _extract_page_data(resp.text)
        if not page_data:
            return None

        return (
            page_data.get("store", {})
            .get("page", {})
            .get("data", {})
            .get("tab_view", {})
            .get("wiki_tab", {})
            .get("content", "")
        ) or None
    except Exception:
        logger.debug("Failed to fetch tab content from %s", tab_url, exc_info=True)
        return None


async def fetch_ug_data(
    artist: str,
    title: str,
    timeout_seconds: int = _REQUEST_TIMEOUT,
) -> UGFetchResult | None:
    """Search Ultimate Guitar and fetch top chord sheets + best tab.

    Uses curl_cffi with Chrome impersonation to bypass Cloudflare.
    Returns up to 3 chord versions and 1 tab, or None if no match found.
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

            # Step 2: Find top chord matches and best tab match
            chord_matches = _find_matching_tabs(
                all_tabs, artist, title, "Chords", _MAX_CHORD_VERSIONS,
            )
            tab_matches = _find_matching_tabs(all_tabs, artist, title, "Tabs", 1)

            if not chord_matches and not tab_matches:
                logger.info("UG: no matching chords or tabs for %r", query)
                return None

            result = UGFetchResult()

            # Step 3: Fetch each chord version
            for tab_meta in chord_matches:
                content = await _fetch_tab_content(session, tab_meta, timeout_seconds)
                if not content:
                    continue

                parsed_lines = parse_ug_content(content)
                if not parsed_lines:
                    continue

                capo = 0
                capo_match = re.search(r"capo[:\s]*(\d+)", content, re.IGNORECASE)
                if capo_match:
                    capo = int(capo_match.group(1))

                result.chord_sheets.append(UGChordSheet(
                    lines=parsed_lines,
                    source_url=tab_meta.get("tab_url", ""),
                    capo=capo,
                    key=tab_meta.get("tonality_name", ""),
                    matched_artist=tab_meta.get("artist_name", ""),
                    matched_title=tab_meta.get("song_name", ""),
                    rating=tab_meta.get("rating", 0) or 0,
                ))

            # Step 4: Fetch tab
            if tab_matches:
                tab_meta = tab_matches[0]
                tab_content = await _fetch_tab_content(session, tab_meta, timeout_seconds)
                if tab_content:
                    result.tab_content = tab_content
                    result.tab_source_url = tab_meta.get("tab_url", "")

            if not result.chord_sheets and not result.tab_content:
                logger.info("UG: fetched pages but no parseable content for %r", query)
                return None

            logger.info(
                "UG: got %d chord versions + %s tab for %r by %r",
                len(result.chord_sheets),
                "1" if result.tab_content else "0",
                title, artist,
            )
            return result

    except Exception:
        logger.warning("UG fetch failed for %r", query, exc_info=True)
        return None


# Backward-compatible alias
async def fetch_ug_chord_sheet(
    artist: str, title: str, timeout_seconds: int = _REQUEST_TIMEOUT,
) -> UGChordSheet | None:
    """Fetch only the best chord sheet (legacy interface)."""
    result = await fetch_ug_data(artist, title, timeout_seconds)
    if result and result.chord_sheets:
        return result.chord_sheets[0]
    return None
