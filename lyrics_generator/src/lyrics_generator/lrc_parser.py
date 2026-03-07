"""Parse LRC (synced lyrics) format into SegmentInfo with word-level timestamps.

LRC format encodes per-line timestamps:
    [00:12.34] First line of lyrics
    [00:17.89] Second line of lyrics

This module parses that into SegmentInfo objects, distributing word
timestamps evenly across each line's duration. The frontend's
normalizeWords() further refines these synthetic word timestamps.
"""

from __future__ import annotations

import re
from .schemas import SegmentInfo, WordInfo

# Matches [mm:ss.xx] or [mm:ss.xxx] at the start of a line.
_LRC_LINE_RE = re.compile(r"^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$")


def _parse_timestamp(minutes: str, seconds: str, centis: str) -> float:
    """Convert LRC timestamp components to seconds."""
    m = int(minutes)
    s = int(seconds)
    # Handle both centiseconds (2 digits) and milliseconds (3 digits)
    if len(centis) == 2:
        frac = int(centis) / 100.0
    else:
        frac = int(centis) / 1000.0
    return round(m * 60 + s + frac, 3)


def _distribute_words(text: str, start: float, end: float) -> list[WordInfo]:
    """Split text into words and distribute timing proportionally by character count.

    Longer words get proportionally more time, providing a better
    approximation of natural pronunciation rhythm than uniform distribution.
    """
    words = text.split()
    if not words:
        return []
    if len(words) == 1:
        return [WordInfo(word=words[0], start=start, end=end)]

    duration = end - start
    char_counts = [max(len(w), 1) for w in words]
    total_chars = sum(char_counts)
    result: list[WordInfo] = []
    t = start
    for i, w in enumerate(words):
        wd = duration * char_counts[i] / total_chars
        ws = t
        we = round(t + wd, 3) if i < len(words) - 1 else round(end, 3)
        result.append(WordInfo(word=w, start=round(ws, 3), end=we))
        t = we
    return result


def parse_lrc(lrc_text: str, total_duration: float | None = None) -> list[SegmentInfo]:
    """Parse an LRC string into a list of SegmentInfo with synthetic word timestamps.

    Args:
        lrc_text: The full LRC-format string (newline-separated timestamped lines).
        total_duration: Total audio duration in seconds. Used to set the end time
            of the last line. If None, the last line gets a 5-second window.

    Returns:
        List of SegmentInfo with evenly-distributed word timestamps.
    """
    lines: list[tuple[float, str]] = []

    for raw_line in lrc_text.splitlines():
        m = _LRC_LINE_RE.match(raw_line.strip())
        if not m:
            continue
        ts = _parse_timestamp(m.group(1), m.group(2), m.group(3))
        text = m.group(4).strip()
        if text:
            lines.append((ts, text))

    if not lines:
        return []

    segments: list[SegmentInfo] = []
    for i, (start, text) in enumerate(lines):
        if i + 1 < len(lines):
            end = lines[i + 1][0]
        elif total_duration is not None:
            end = total_duration
        else:
            end = start + 5.0

        # Clamp: end must be > start
        if end <= start:
            end = start + 2.0

        end = round(end, 3)
        words = _distribute_words(text, start, end)
        segments.append(SegmentInfo(start=start, end=end, text=text, words=words))

    return segments
