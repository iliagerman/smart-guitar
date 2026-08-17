"""Align fetched chord-sheet lines to whisper lyrics timing.

Community chord sheets (Ultimate Guitar) carry lyric lines + chord positions
but no timestamps. This module matches each sheet lyric line to a contiguous
window of whisper-transcribed WORDS — deterministically, in order, no LLM —
so the sheet can auto-scroll in real time.

Matching at the word level (rather than segment level) is essential: whisper
segmentation varies wildly, and older transcripts often pack several sheet
lines into one long segment. Word timestamps let every line get its own
window regardless of how whisper chose to segment.

Lines that don't match (ad-libs, section noise, tab/tuning text the sheet
parser mislabeled as lyrics) get a window interpolated between their matched
neighbors. If too few lines match overall, alignment returns None and the
caller falls back to even distribution across the song duration.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher

from guitar_player.schemas.song import LyricsSegment

# A line->window match must reach this token-sequence similarity.
_MATCH_THRESHOLD = 0.6
# If fewer than this fraction of lyric lines matched, give up (wrong sheet).
_MIN_MATCH_RATIO = 0.35
# Window width slack around the line's token count.
_WIDTH_SLACK = 2
# At most this many candidate anchor positions are scored per line.
_MAX_CANDIDATES = 60

_NON_WORD_RE = re.compile(r"[^\w\s]", re.UNICODE)

# Sheet line types that occupy playback time.
TIMED_LINE_TYPES = ("lyric", "instrumental")

# A chordless "lyric" line with fewer tokens than this is a short ad-lib
# ("oh yeah") that's never checked against the transcript, since a match on
# so few tokens is meaningless either way.
_COMMENTARY_MIN_TOKENS = 3
# Below this best-effort fuzzy match against the transcript, a chordless
# line is assumed to be tabber commentary rather than sung content.
_COMMENTARY_MATCH_THRESHOLD = 0.45

# ASCII guitar-tab lines are dominated by dashes, fret digits, and tab
# markup (h=hammer-on, p=pull-off, b=bend, r=release, x=mute, /,\=slides,
# ~=vibrato, |=bar line, (),.=grace notes/legend punctuation).
_TAB_SYMBOL_RE = re.compile(r"[\-0-9hHpPbBrRxX/\\~|().]")
_PREAMBLE_TEXT_RE = re.compile(
    r"^(?:(?:song|artist)\s*:|tabbed by\b|https?://|www\.)",
    re.IGNORECASE,
)
_ARTIST_TITLE_RE = re.compile(r"^[^-]{2,}\s+-\s+[^-]{2,}$")


@dataclass
class TimedWord:
    """A single normalized token from the whisper transcript with its window."""

    token: str
    start: float
    end: float


@dataclass
class LineAlignment:
    """Real timing window for one sheet line.

    ``words`` holds the matched whisper tokens underlying this line's window
    (in order) when the line was directly matched against the transcript.
    It is ``None`` for lines whose window was interpolated between matched
    neighbors — there's no real per-word data to hand back for those.
    """

    start: float
    end: float
    words: list[TimedWord] | None = None


def tokenize(text: str) -> list[str]:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return _NON_WORD_RE.sub(" ", without_marks).split()


def _is_noise_line(text: str) -> bool:
    """Tab/tuning/url text the sheet parser mislabeled as lyrics.

    Such lines never match the transcript; excluding them from the match
    gate keeps one noisy header from blocking an otherwise good sheet.
    """
    lowered = text.lower()
    if "http://" in lowered or "https://" in lowered or "www." in lowered:
        return True
    tokens = tokenize(text)
    if not tokens:
        return True
    noisy = sum(1 for t in tokens if any(ch.isdigit() for ch in t) or len(t) == 1)
    return noisy / len(tokens) > 0.5


def _flatten_words(segments: list[LyricsSegment]) -> list[TimedWord]:
    words: list[TimedWord] = []
    for seg in segments:
        for w in seg.words:
            tokens = tokenize(w.word)
            if not tokens:
                continue
            # A whisper "word" is occasionally multiple tokens; share its window.
            for t in tokens:
                words.append(TimedWord(token=t, start=float(w.start), end=float(w.end)))
    return words


def _match_line(
    tokens: list[str],
    words: list[TimedWord],
    min_start: int,
) -> tuple[int, int, float] | None:
    """Best (start_idx, end_idx_exclusive, score) word window for a line."""
    n = len(tokens)
    if n == 0:
        return None
    anchors = {tokens[0]}
    if n > 1:
        anchors.add(tokens[1])

    best: tuple[int, int, float] | None = None
    candidates = 0
    for s in range(min_start, len(words)):
        if words[s].token not in anchors:
            continue
        candidates += 1
        if candidates > _MAX_CANDIDATES:
            break
        for width in range(max(1, n - _WIDTH_SLACK), n + _WIDTH_SLACK + 1):
            e = s + width
            if e > len(words):
                break
            window = [w.token for w in words[s:e]]
            score = SequenceMatcher(None, tokens, window).ratio()
            if score >= _MATCH_THRESHOLD and (best is None or score > best[2]):
                best = (s, e, score)
        if best is not None and best[2] > 0.95:
            break  # essentially exact; no point scanning further
    return best


def _is_tab_ascii_line(text: str) -> bool:
    """True for an ASCII guitar-tab notation line (e.g. "e|--3--5--|").

    Requires a run of 3+ dashes (a fretted/open-string span) AND more than
    60% of the line's non-space characters drawn from tab notation symbols.
    The dash-run requirement is what keeps real lyrics (no dash runs) and
    chord-voicing lines like "G  3-x-0-0-0-3" (single dashes between
    digits, no run of 3+) out — those aren't this detector's job.

    Genuine tab notation never contains real words — only single-letter
    string names (e/B/G/D/A/E) and technique markers (h/p/b/r/x). Sheets
    also draw sustained sung syllables as dash runs ("...Fly--------!"),
    so any line with a 3+ letter word is a lyric, not tab.
    """
    if "---" not in text:
        return False
    if re.search(r"[A-Za-z]{3,}", text):
        return False
    non_space = [c for c in text if not c.isspace()]
    if not non_space:
        return False
    symbol_count = sum(1 for c in non_space if _TAB_SYMBOL_RE.fullmatch(c))
    return symbol_count / len(non_space) > 0.6


def _drop_or_convert_tab_lines(raw_lines: list[dict]) -> list[dict]:
    """Drop chordless ASCII tab lines; convert chord-bearing ones to a
    chordless-text `instrumental` line so their chords survive."""
    result: list[dict] = []
    for line in raw_lines:
        if not isinstance(line, dict) or not _is_tab_ascii_line(line.get("text", "")):
            result.append(line)
            continue
        chords = line.get("chords") or []
        if chords:
            result.append({"type": "instrumental", "text": "", "chords": chords})
    return result


def _best_transcript_similarity(tokens: list[str], transcript: list[TimedWord]) -> float:
    """Best fuzzy match ratio of *tokens* against any similarly-sized window
    of the transcript.

    Candidate windows are anchored on ANY shared token (not just the
    first), so a single mistranscribed word near the start of a real lyric
    line doesn't hide it from matching. Anchor occurrences are capped at
    `_MAX_CANDIDATES` to bound the work, same idiom as `_match_line`.
    """
    if not tokens or not transcript:
        return 0.0
    anchors = set(tokens)
    best = 0.0
    candidates = 0
    for idx, w in enumerate(transcript):
        if w.token not in anchors:
            continue
        candidates += 1
        if candidates > _MAX_CANDIDATES:
            break
        for width in range(max(1, len(tokens) - _WIDTH_SLACK), len(tokens) + _WIDTH_SLACK + 1):
            start = max(0, idx - width + 1)
            end = min(len(transcript), start + width)
            window = [tw.token for tw in transcript[start:end]]
            score = SequenceMatcher(None, tokens, window).ratio()
            best = max(best, score)
        if best > 0.999:
            return best
    return best


def _is_commentary_line(line: dict, transcript: list[TimedWord]) -> bool:
    """True for a chordless `lyric` line that never appears in the transcript."""
    if not isinstance(line, dict) or line.get("type") != "lyric" or line.get("chords"):
        return False
    tokens = tokenize(line.get("text", ""))
    if len(tokens) < _COMMENTARY_MIN_TOKENS:
        return False
    return _best_transcript_similarity(tokens, transcript) < _COMMENTARY_MATCH_THRESHOLD


def sanitize_sheet_lines(raw_lines: list[dict], segments: list[LyricsSegment]) -> list[dict]:
    """Drop mid-sheet junk that's shown as lyrics: ASCII tab blocks and
    tabber commentary prose that's never actually sung.

    Meant to run once, right after `trim_sheet_preamble`, on the whole
    (already-trimmed) sheet — junk can sit between two real chord lines,
    not just at the top. The tab-line filter always runs; the commentary
    filter only runs when a transcript (*segments*) is available, since
    without one there's nothing to check "never sung" against.
    """
    without_tabs = _drop_or_convert_tab_lines(raw_lines)
    transcript = _flatten_words(segments)
    if not transcript:
        return without_tabs
    return [line for line in without_tabs if not _is_commentary_line(line, transcript)]


def _is_preamble_line(line: dict, index: int, raw_lines: list[dict]) -> bool:
    text = (line.get("text") or "").strip()
    if _PREAMBLE_TEXT_RE.search(text):
        return True
    metadata_follows = any(
        isinstance(candidate, dict)
        and _PREAMBLE_TEXT_RE.search((candidate.get("text") or "").strip())
        for candidate in raw_lines[index + 1:index + 4]
    )
    return bool(index == 0 and metadata_follows and _ARTIST_TITLE_RE.search(text))


def trim_sheet_preamble(raw_lines: list[dict]) -> list[dict]:
    """Drop UG sheet preamble (metadata, playing notes) before the first chord.

    Ultimate Guitar sheets often open with prose that isn't song content —
    "Song: ...", "Tabbed by: ...", YouTube links, "capo: 3rd fret" — as
    chord-less lyric/empty lines before the first real chord line. Those
    lines pollute both the displayed sheet and the whisper alignment gate.

    A leading section header (e.g. "Intro") that directly labels the first
    chord-bearing line (modulo blank lines between them) is kept, since it's
    real song structure, not preamble. Returns *raw_lines* unchanged if no
    line has a chord at all, so a sheet is never blanked out.
    """
    first_chord_idx = next(
        (
            i for i, line in enumerate(raw_lines)
            if isinstance(line, dict) and line.get("chords") and not _is_preamble_line(line, i, raw_lines)
        ),
        None,
    )
    if first_chord_idx is None:
        return raw_lines

    def _type(idx: int) -> str | None:
        line = raw_lines[idx]
        return line.get("type") if isinstance(line, dict) else None

    start = first_chord_idx
    i = first_chord_idx - 1
    while i >= 0 and _type(i) == "empty":
        i -= 1
    if i >= 0 and _type(i) == "section":
        start = i

    return raw_lines[start:]


def align_sheet_lines_to_segments(
    raw_lines: list[dict],
    segments: list[LyricsSegment],
    *,
    duration: float,
) -> list[tuple[float, float] | None] | None:
    """Compute a real (start, end) window for each sheet line.

    Returns a list parallel to *raw_lines*: a (start, end) tuple for timed
    line types ("lyric"/"instrumental"), None for section headers and empty
    lines. Returns None entirely when alignment isn't trustworthy — the
    caller should fall back to even distribution.
    """
    aligned = _align_lines(raw_lines, segments, duration=duration)
    if aligned is None:
        return None
    return [None if a is None else (a.start, a.end) for a in aligned]


def align_sheet_lines_with_words(
    raw_lines: list[dict],
    segments: list[LyricsSegment],
    *,
    duration: float,
    content_start: float | None = None,
) -> list[LineAlignment | None] | None:
    """Like :func:`align_sheet_lines_to_segments`, but also exposes the matched
    whisper words underlying each directly-matched line.

    Returns a list parallel to *raw_lines*: a `LineAlignment` for timed line
    types, ``None`` for section headers and empty lines. Within a
    `LineAlignment`, ``words`` is the matched whisper token list for lines
    that were directly matched, and ``None`` for lines whose window was only
    interpolated between matched neighbors. Returns ``None`` entirely when
    alignment isn't trustworthy — same gate as the plain window function.

    *content_start*, when given, anchors the leading instrumental-intro gap
    (lines before the first matched anchor) to the song's actual detected
    start instead of always assuming 0.0.
    """
    return _align_lines(raw_lines, segments, duration=duration, content_start=content_start)


def _align_lines(
    raw_lines: list[dict],
    segments: list[LyricsSegment],
    *,
    duration: float,
    content_start: float | None = None,
) -> list[LineAlignment | None] | None:
    if not segments:
        return None
    words = _flatten_words(segments)
    if not words:
        return None

    timed_indices = [
        idx for idx, line in enumerate(raw_lines)
        if isinstance(line, dict) and line.get("type") in TIMED_LINE_TYPES
    ]
    lyric_positions = [
        pos for pos, idx in enumerate(timed_indices)
        if raw_lines[idx].get("type") == "lyric" and (raw_lines[idx].get("text") or "").strip()
    ]
    gated_positions = [
        pos for pos in lyric_positions
        if not _is_noise_line(raw_lines[timed_indices[pos]].get("text", ""))
    ]
    if not gated_positions:
        return None

    # Match each lyric line to a word window, advancing monotonically.
    anchors: dict[int, tuple[float, float, list[TimedWord]]] = {}
    cursor = 0
    matched = 0
    for pos in lyric_positions:
        tokens = tokenize(raw_lines[timed_indices[pos]].get("text", ""))
        found = _match_line(tokens, words, cursor)
        if found is None:
            continue
        s, e, _score = found
        anchors[pos] = (round(words[s].start, 3), round(words[e - 1].end, 3), words[s:e])
        cursor = e
        matched += 1

    if matched / len(gated_positions) < _MIN_MATCH_RATIO:
        return None

    # Interpolate the unmatched timed positions between anchored neighbors.
    total_timed = len(timed_indices)
    windows: list[LineAlignment] = [LineAlignment(0.0, 0.0)] * total_timed
    anchor_positions = sorted(anchors)
    for pos in anchor_positions:
        start, end, matched_words = anchors[pos]
        windows[pos] = LineAlignment(start, end, words=matched_words)

    def _fill_gap(start_pos: int, end_pos: int, t0: float, t1: float) -> None:
        """Evenly distribute positions in (start_pos, end_pos) over [t0, t1]."""
        count = end_pos - start_pos - 1
        if count <= 0:
            return
        span = max(t1 - t0, 0.0)
        step = span / count if count else 0.0
        for k in range(1, count + 1):
            a = t0 + (k - 1) * step
            b = t0 + k * step
            windows[start_pos + k] = LineAlignment(round(a, 3), round(b, 3))

    first_anchor = anchor_positions[0]
    last_anchor = anchor_positions[-1]
    first_anchor_start = anchors[first_anchor][0]
    leading_start = 0.0 if content_start is None else min(content_start, first_anchor_start)
    _fill_gap(-1, first_anchor, leading_start, first_anchor_start)
    for a_pos, b_pos in zip(anchor_positions, anchor_positions[1:]):
        _fill_gap(a_pos, b_pos, anchors[a_pos][1], anchors[b_pos][0])
    _fill_gap(last_anchor, total_timed, anchors[last_anchor][1], max(duration, anchors[last_anchor][1]))

    # Build the result parallel to raw_lines.
    result: list[LineAlignment | None] = [None] * len(raw_lines)
    for pos, idx in enumerate(timed_indices):
        result[idx] = windows[pos]
    return result
