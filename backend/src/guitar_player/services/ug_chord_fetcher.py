"""Fetch chord sheets from Ultimate Guitar.

Uses Ultimate Guitar's public-facing endpoints to:
1. Search for a matching song by artist + title
2. Fetch the highest-rated chord sheet
3. Parse the chord content into structured StaticChordLine data

All errors are non-fatal — returns None on failure.
"""

import json
import logging
import re
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)

_UG_SEARCH_URL = "https://www.ultimate-guitar.com/api/v1/tab/search"
_UG_TAB_URL = "https://tabs.ultimate-guitar.com/tab/fetch"
_REQUEST_TIMEOUT = 15.0

# Section header patterns: [Verse 1], [Chorus], [Intro], etc.
_SECTION_PATTERN = re.compile(r"^\[([^\]]+)\]$")

# UG inline chord tag: [ch]Am[/ch]
_CHORD_TAG_PATTERN = re.compile(r"\[ch\](.*?)\[/ch\]")

# Tab tag wrapping: [tab]...[/tab]
_TAB_WRAPPER = re.compile(r"\[/?tab\]")


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
    """Extract chord names and their character positions from a line with [ch] tags.

    Computes the visual position of each chord after removing all tags.
    """
    chords: list[StaticChordPosition] = []
    visual_pos = 0
    remaining = line
    while remaining:
        match = _CHORD_TAG_PATTERN.search(remaining)
        if not match:
            break
        # Characters before this chord tag contribute to visual position
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
    # Remove [tab] wrapper tags
    content = _TAB_WRAPPER.sub("", raw_content)
    raw_lines = content.split("\n")
    lines: list[StaticChordLine] = []
    i = 0

    while i < len(raw_lines):
        line = raw_lines[i]
        stripped = line.rstrip()

        # Empty line
        if not stripped:
            lines.append(StaticChordLine(type="empty", text=""))
            i += 1
            continue

        # Section header: [Verse 1], [Chorus], etc.
        plain = _get_plain_text(stripped)
        section_match = _SECTION_PATTERN.match(plain.strip())
        if section_match:
            lines.append(StaticChordLine(
                type="section", text=section_match.group(1),
            ))
            i += 1
            continue

        # Chord-only line (no lyrics text, just chord tags)
        if _is_chord_only_line(stripped):
            chord_positions = _extract_chords_with_positions(stripped)

            # Check if next line is a lyrics line (two-line format)
            if i + 1 < len(raw_lines):
                next_line = raw_lines[i + 1].rstrip()
                next_plain = _get_plain_text(next_line)
                next_section = _SECTION_PATTERN.match(next_plain.strip())

                if next_plain and not next_section and not _is_chord_only_line(next_line):
                    # Two-line format: chord line + lyrics line
                    lyrics_text = next_plain
                    # If the next line also has inline chords, merge them
                    if _CHORD_TAG_PATTERN.search(next_line):
                        extra_chords = _extract_chords_with_positions(next_line)
                        chord_positions.extend(extra_chords)
                        chord_positions.sort(key=lambda c: c.position)
                    lines.append(StaticChordLine(
                        type="lyric", text=lyrics_text, chords=chord_positions,
                    ))
                    i += 2
                    continue

            # Standalone chord line (instrumental)
            lines.append(StaticChordLine(
                type="instrumental", text="", chords=chord_positions,
            ))
            i += 1
            continue

        # Inline format: lyrics with embedded [ch]...[/ch] tags
        if _CHORD_TAG_PATTERN.search(stripped):
            chord_positions = _extract_chords_with_positions(stripped)
            lyrics_text = _get_plain_text(stripped)
            lines.append(StaticChordLine(
                type="lyric", text=lyrics_text, chords=chord_positions,
            ))
            i += 1
            continue

        # Plain lyrics line (no chords)
        lines.append(StaticChordLine(
            type="lyric", text=stripped, chords=[],
        ))
        i += 1

    return lines


def _find_best_tab(
    results: list[dict], artist: str, title: str,
) -> dict | None:
    """Find the best-matching Chords-type tab from UG search results."""
    chord_tabs = [
        r for r in results
        if r.get("type", "").lower() in ("chords", "ukulele chords")
    ]
    if not chord_tabs:
        logger.info("UG: no chord tabs in results for %r by %r", title, artist)
        return None

    best_tab = None
    best_score = 0.0

    for tab in chord_tabs:
        match = _match_score(
            artist, title,
            tab.get("artist_name", ""), tab.get("song_name", ""),
        )
        # Boost by rating (0-5 scale, normalized to 0-0.5 bonus)
        rating = tab.get("rating", 0) or 0
        combined = match + (rating / 10.0)

        if combined > best_score:
            best_score = combined
            best_tab = tab

    if best_score < 1.0 or best_tab is None:
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
    timeout_seconds: float = _REQUEST_TIMEOUT,
) -> UGChordSheet | None:
    """Search Ultimate Guitar and fetch the best chord sheet for a song.

    Returns a parsed UGChordSheet or None if no match found.
    """
    query = f"{artist} {title}"
    logger.info("UG search: %r", query)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
    }

    try:
        async with httpx.AsyncClient(
            timeout=timeout_seconds, follow_redirects=True, headers=headers,
        ) as client:
            # Step 1: Search for the song
            search_resp = await client.get(
                _UG_SEARCH_URL,
                params={
                    "search_type": "title",
                    "value": query,
                    "type": "Chords",
                    "page": 1,
                },
            )
            search_resp.raise_for_status()
            search_data = search_resp.json()

            # UG wraps results in different structures depending on the endpoint
            results = search_data
            if isinstance(search_data, dict):
                results = (
                    search_data.get("results", [])
                    or search_data.get("data", [])
                    or search_data.get("tabs", [])
                )
                # Sometimes nested under "results" -> list of dicts with "results" key
                if results and isinstance(results[0], dict) and "results" in results[0]:
                    flat: list[dict] = []
                    for group in results:
                        flat.extend(group.get("results", []))
                    results = flat

            if not results:
                logger.info("UG: no results for %r", query)
                return None

            best_tab = _find_best_tab(results, artist, title)
            if not best_tab:
                return None

            tab_url = best_tab.get("tab_url", "")
            tab_id = best_tab.get("id")

            # Step 2: Fetch the tab content
            content = ""
            if tab_id:
                try:
                    tab_resp = await client.get(
                        _UG_TAB_URL, params={"id": tab_id},
                    )
                    tab_resp.raise_for_status()
                    tab_data = tab_resp.json()
                    content = (
                        tab_data.get("content", "")
                        or tab_data.get("wiki_tab", {}).get("content", "")
                    )
                except Exception:
                    logger.debug("UG: tab fetch by ID failed, trying URL", exc_info=True)

            # Fallback: try fetching the tab page directly
            if not content and tab_url:
                try:
                    page_resp = await client.get(tab_url)
                    page_resp.raise_for_status()
                    page_text = page_resp.text

                    # Extract JSON data from the page's data-content attribute or script
                    json_match = re.search(
                        r'data-content="([^"]+)"', page_text,
                    )
                    if json_match:
                        import html as html_mod
                        decoded = html_mod.unescape(json_match.group(1))
                        try:
                            page_data = json.loads(decoded)
                            content = (
                                page_data.get("store", {})
                                .get("page", {})
                                .get("data", {})
                                .get("tab_view", {})
                                .get("wiki_tab", {})
                                .get("content", "")
                            )
                        except json.JSONDecodeError:
                            pass

                    if not content:
                        # Try JS_DATA pattern
                        js_match = re.search(
                            r"window\.__STORE__\s*=\s*(\{.+?\});\s*</script>",
                            page_text, re.DOTALL,
                        )
                        if js_match:
                            try:
                                store = json.loads(js_match.group(1))
                                content = (
                                    store.get("page", {})
                                    .get("data", {})
                                    .get("tab_view", {})
                                    .get("wiki_tab", {})
                                    .get("content", "")
                                )
                            except json.JSONDecodeError:
                                pass
                except Exception:
                    logger.debug("UG: page fetch failed for %s", tab_url, exc_info=True)

            if not content:
                # Try using the content directly from search results
                content = best_tab.get("content", "")

            if not content:
                logger.info("UG: no content found for tab %s", tab_id)
                return None

            # Step 3: Parse the content
            parsed_lines = parse_ug_content(content)
            if not parsed_lines:
                logger.info("UG: parsed content is empty for tab %s", tab_id)
                return None

            # Extract metadata
            capo = 0
            capo_match = re.search(r"capo[:\s]*(\d+)", content, re.IGNORECASE)
            if capo_match:
                capo = int(capo_match.group(1))

            key = best_tab.get("tonality_name", "")

            return UGChordSheet(
                lines=parsed_lines,
                source_url=tab_url,
                capo=capo,
                key=key,
                matched_artist=best_tab.get("artist_name", ""),
                matched_title=best_tab.get("song_name", ""),
                rating=best_tab.get("rating", 0) or 0,
            )

    except httpx.HTTPStatusError as e:
        logger.warning("UG HTTP error: %s", e)
        return None
    except httpx.TimeoutException:
        logger.warning("UG request timed out for %r", query)
        return None
    except Exception:
        logger.warning("UG fetch failed for %r", query, exc_info=True)
        return None
