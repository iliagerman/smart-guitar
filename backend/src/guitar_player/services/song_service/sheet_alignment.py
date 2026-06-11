"""Align fetched chord-sheet lines to whisper lyrics timing.

Community chord sheets (Ultimate Guitar) carry lyric lines + chord positions
but no timestamps. This module fuzzy-matches each sheet lyric line to the
whisper-transcribed segments — deterministically, with a monotonic dynamic
program (no LLM) — so the sheet can auto-scroll in real time.

Lines that don't match (ad-libs, transcription gaps, instrumentals) get a
window interpolated between their matched neighbors. If too few lines match
overall, alignment returns None and the caller falls back to even
distribution across the song duration.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from guitar_player.schemas.song import LyricsSegment

# A pair must be at least this similar to count as a match.
_MATCH_THRESHOLD = 0.55
# Cheap token-overlap prefilter before running SequenceMatcher.
_PREFILTER_JACCARD = 0.15
# If fewer than this fraction of lyric lines matched, give up (wrong sheet).
_MIN_MATCH_RATIO = 0.35

_NON_WORD_RE = re.compile(r"[^\w\s]", re.UNICODE)

# Sheet line types that occupy playback time.
TIMED_LINE_TYPES = ("lyric", "instrumental")


def _normalize(text: str) -> str:
    return " ".join(_NON_WORD_RE.sub(" ", text.lower()).split())


def _similarity(a: str, b: str, tokens_a: set[str], tokens_b: set[str]) -> float:
    if not a or not b:
        return 0.0
    union = tokens_a | tokens_b
    if union:
        jaccard = len(tokens_a & tokens_b) / len(union)
        if jaccard < _PREFILTER_JACCARD:
            return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _best_monotonic_matches(
    line_texts: list[str], segment_texts: list[str],
) -> dict[int, int]:
    """Monotonic line->segment assignment maximizing total similarity.

    Standard alignment DP: at each (i, j) either match line i to segment j,
    skip the line, or skip the segment. Matches below the threshold score 0
    and are discarded during backtracking.
    """
    n, m = len(line_texts), len(segment_texts)
    line_tokens = [set(t.split()) for t in line_texts]
    seg_tokens = [set(t.split()) for t in segment_texts]

    sim = [
        [
            _similarity(line_texts[i], segment_texts[j], line_tokens[i], seg_tokens[j])
            for j in range(m)
        ]
        for i in range(n)
    ]

    # dp[i][j] = best score aligning lines[i:] with segments[j:]
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            match_score = (sim[i][j] if sim[i][j] >= _MATCH_THRESHOLD else 0.0) + dp[i + 1][j + 1]
            dp[i][j] = max(match_score, dp[i + 1][j], dp[i][j + 1])

    matches: dict[int, int] = {}
    i = j = 0
    while i < n and j < m:
        match_score = (sim[i][j] if sim[i][j] >= _MATCH_THRESHOLD else 0.0) + dp[i + 1][j + 1]
        if dp[i][j] == match_score and sim[i][j] >= _MATCH_THRESHOLD:
            matches[i] = j
            i += 1
            j += 1
        elif dp[i][j] == dp[i + 1][j]:
            i += 1
        else:
            j += 1
    return matches


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
    if not segments:
        return None

    timed_indices = [
        idx for idx, line in enumerate(raw_lines)
        if isinstance(line, dict) and line.get("type") in TIMED_LINE_TYPES
    ]
    lyric_positions = [
        pos for pos, idx in enumerate(timed_indices)
        if raw_lines[idx].get("type") == "lyric" and (raw_lines[idx].get("text") or "").strip()
    ]
    if not lyric_positions:
        return None

    line_texts = [_normalize(raw_lines[timed_indices[pos]].get("text", "")) for pos in lyric_positions]
    segment_texts = [_normalize(s.text) for s in segments]

    matches = _best_monotonic_matches(line_texts, segment_texts)
    if len(matches) / len(lyric_positions) < _MIN_MATCH_RATIO:
        return None

    # Anchor windows for matched timed positions.
    total_timed = len(timed_indices)
    anchors: dict[int, tuple[float, float]] = {}
    for lyric_pos_idx, seg_idx in matches.items():
        timed_pos = lyric_positions[lyric_pos_idx]
        s = segments[seg_idx]
        anchors[timed_pos] = (float(s.start), float(s.end))

    # Interpolate the unmatched timed positions between anchored neighbors.
    windows: list[tuple[float, float]] = [(0.0, 0.0)] * total_timed
    anchor_positions = sorted(anchors)
    for pos in range(total_timed):
        if pos in anchors:
            windows[pos] = anchors[pos]

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
            windows[start_pos + k] = (round(a, 3), round(b, 3))

    first_anchor = anchor_positions[0]
    last_anchor = anchor_positions[-1]
    _fill_gap(-1, first_anchor, 0.0, anchors[first_anchor][0])
    for a_pos, b_pos in zip(anchor_positions, anchor_positions[1:]):
        _fill_gap(a_pos, b_pos, anchors[a_pos][1], anchors[b_pos][0])
    _fill_gap(last_anchor, total_timed, anchors[last_anchor][1], max(duration, anchors[last_anchor][1]))

    # Build the result parallel to raw_lines.
    result: list[tuple[float, float] | None] = [None] * len(raw_lines)
    for pos, idx in enumerate(timed_indices):
        result[idx] = windows[pos]
    return result
