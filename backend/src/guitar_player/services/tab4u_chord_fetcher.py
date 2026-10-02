"""Fetch chord sheets from Tab4U, the main Israeli chord site.

Ultimate Guitar rarely has Hebrew songs, or lists them under transliterated
names the matcher can't pair with ours. Tab4U is the fallback:
1. Search by artist + title; song links carry "<artist> - <title>".
2. Parse the song page's rows: a chord row (``td.chords``, chords positioned
   with spaces) above a lyric row (``td.song``); a chord row with no lyric
   under it is an instrumental line.

Returns the same UGChordSheet structure the UG fetcher does. All errors are
non-fatal — returns None on failure.
"""

import html as html_mod
import logging
import re
import urllib.parse

from curl_cffi.requests import AsyncSession

from guitar_player.services.source_match import accept_sheet_match, match_components
from guitar_player.services.ug_chord_fetcher import (
    StaticChordLine,
    StaticChordPosition,
    UGChordSheet,
    UGFetchResult,
)

logger = logging.getLogger(__name__)

_BASE = "https://www.tab4u.com/"
_REQUEST_TIMEOUT = 15
_MAX_CHORD_VERSIONS = 2
_SONG_LINK = re.compile(r'href="(tabs/songs/(\d+)_([^"]+?)\.html)"')
_CELL = re.compile(r'<td class="(chords|song|tabs)[^"]*"[^>]*>(.*?)</td>', re.S)
_CHORD_SPAN = re.compile(r"<span[^>]*>([^<]+)</span>")
_TAG = re.compile(r"<[^>]+>")
_CAPO = re.compile(r"(?:קאפו|capo)\D{0,6}(\d{1,2})", re.IGNORECASE)


def _text(cell: str) -> str:
    return html_mod.unescape(_TAG.sub("", cell)).replace("\xa0", " ").strip("\r\n\t")


def _chord_positions(cell: str) -> list[StaticChordPosition]:
    """Chords in a chord row with their character offsets."""
    chords: list[StaticChordPosition] = []
    position = 0
    rest = cell
    while True:
        match = _CHORD_SPAN.search(rest)
        if not match:
            break
        position += len(_text(rest[: match.start()]).replace("\n", ""))
        name = html_mod.unescape(match.group(1)).strip()
        chords.append(StaticChordPosition(chord=name, position=position))
        position += len(name)
        rest = rest[match.end():]
    return chords


def parse_tab4u_page(page: str) -> list[StaticChordLine]:
    """Chord and lyric lines of a Tab4U song page, in reading order."""
    lines: list[StaticChordLine] = []
    pending: list[StaticChordPosition] | None = None
    for kind, cell in _CELL.findall(page):
        if kind == "tabs":
            continue
        if kind == "chords":
            if pending:
                lines.append(StaticChordLine(type="instrumental", text="", chords=pending))
            pending = _chord_positions(cell) or None
            continue
        text = _text(cell).strip()
        if pending:
            lines.append(StaticChordLine(type="lyric", text=text, chords=pending))
            pending = None
        elif text.endswith(":") and len(text) < 30:
            lines.append(StaticChordLine(type="section", text=text.rstrip(":").strip()))
        elif text:
            lines.append(StaticChordLine(type="lyric", text=text, chords=[]))
        else:
            lines.append(StaticChordLine(type="empty", text=""))
    if pending:
        lines.append(StaticChordLine(type="instrumental", text="", chords=pending))
    return lines


def _candidates(search_page: str) -> list[tuple[str, str, str]]:
    """(url, artist, title) for each distinct song link in a search result page."""
    seen: set[str] = set()
    out: list[tuple[str, str, str]] = []
    for path, _song_id, slug in _SONG_LINK.findall(search_page):
        name = html_mod.unescape(urllib.parse.unquote(slug)).replace("_", " ")
        if path in seen or " - " not in name:
            continue
        seen.add(path)
        artist, title = name.split(" - ", 1)
        out.append((_BASE + path, artist.strip(), title.strip()))
    return out


def _accept(artist: str, title: str, r_artist: str, r_title: str) -> float | None:
    """Match score, or None when the candidate isn't this song."""
    if not accept_sheet_match(artist, title, r_artist, r_title):
        return None
    return sum(match_components(artist, title, r_artist, r_title))


async def fetch_tab4u_data(
    artist: str, title: str, timeout_seconds: int = _REQUEST_TIMEOUT,
) -> UGFetchResult | None:
    """Search Tab4U and fetch the best-matching chord sheets (up to 2)."""
    query = f"{artist} {title}"
    try:
        async with AsyncSession() as session:
            search = await session.get(
                _BASE + "resultsSimple", params={"tab": "songs", "q": query},
                impersonate="chrome", timeout=timeout_seconds,
            )
            if search.status_code != 200:
                logger.warning("Tab4U search returned %d", search.status_code)
                return None
            scored = []
            for url, r_artist, r_title in _candidates(search.text):
                score = _accept(artist, title, r_artist, r_title)
                if score is None:
                    logger.info("Tab4U: rejecting %r/%r against %r/%r", artist, title, r_artist, r_title)
                    continue
                scored.append((score, url, r_artist, r_title))
            scored.sort(key=lambda s: s[0], reverse=True)

            result = UGFetchResult()
            for _score, url, r_artist, r_title in scored[:_MAX_CHORD_VERSIONS]:
                page = await session.get(url, impersonate="chrome", timeout=timeout_seconds)
                if page.status_code != 200:
                    continue
                lines = parse_tab4u_page(page.text)
                if not any(line.chords for line in lines):
                    continue
                capo = _CAPO.search(_TAG.sub(" ", page.text))
                result.chord_sheets.append(UGChordSheet(
                    lines=lines, source_url=url, capo=int(capo.group(1)) if capo else 0,
                    matched_artist=r_artist, matched_title=r_title,
                ))
            if not result.chord_sheets:
                logger.info("Tab4U: no matching chord sheet for %r", query)
                return None
            logger.info("Tab4U: got %d chord versions for %r by %r", len(result.chord_sheets), title, artist)
            return result
    except Exception:
        logger.warning("Tab4U fetch failed for %r", query, exc_info=True)
        return None
