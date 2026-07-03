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
    return _NON_WORD_RE.sub(" ", text.lower()).split()


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
        (i for i, line in enumerate(raw_lines) if isinstance(line, dict) and line.get("chords")),
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
