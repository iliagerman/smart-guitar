"""Deterministic structural sanitizer for transcribed lyrics.

Runs as the last step before lyrics JSON is written. It enforces timing
integrity so the player's highlight can never jump backward:

- drops empty segments
- fixes inverted start/end times
- sorts segments chronologically
- collapses duplicates of the SAME audio region (same text, overlapping
  time window) — a transcription artifact, while legitimate repeated
  lines (choruses) at different times are preserved
- clamps overlapping segment boundaries to be monotonic
- sorts, contains, and de-overlaps word timestamps within each segment

It never rewrites transcribed text — no AI, no content changes.
"""

from __future__ import annotations

from .schemas import SegmentInfo, WordInfo

# Minimum overlap (as a fraction of the shorter segment) for two same-text
# segments to be considered one audio region transcribed twice.
_DUPLICATE_OVERLAP_RATIO = 0.5


def _normalize_text(text: str) -> str:
    return " ".join(text.lower().split())


def _overlap_ratio(a: SegmentInfo, b: SegmentInfo) -> float:
    overlap = min(a.end, b.end) - max(a.start, b.start)
    if overlap <= 0:
        return 0.0
    shorter = min(a.end - a.start, b.end - b.start)
    if shorter <= 0:
        return 1.0
    return overlap / shorter


def _sanitize_words(words: list[WordInfo], seg_start: float, seg_end: float) -> list[WordInfo]:
    cleaned: list[WordInfo] = []
    for w in words:
        word = (w.word or "").strip()
        if not word:
            continue
        start = float(w.start)
        end = max(float(w.end), start)
        cleaned.append(WordInfo(word=word, start=start, end=end))

    cleaned.sort(key=lambda w: (w.start, w.end))

    result: list[WordInfo] = []
    prev_end = seg_start
    for w in cleaned:
        start = min(max(w.start, prev_end), seg_end)
        end = min(max(w.end, start), seg_end)
        result.append(WordInfo(word=w.word, start=round(start, 3), end=round(end, 3)))
        prev_end = end
    return result


def sanitize_segments(segments: list[SegmentInfo]) -> list[SegmentInfo]:
    """Return a structurally valid copy of *segments* (text untouched)."""
    valid = [
        SegmentInfo(
            start=float(s.start),
            end=max(float(s.end), float(s.start)),
            text=s.text.strip(),
            words=list(s.words),
        )
        for s in segments
        if s.text and s.text.strip()
    ]
    valid.sort(key=lambda s: (s.start, s.end))

    deduped: list[SegmentInfo] = []
    for s in valid:
        if deduped:
            prev = deduped[-1]
            same_text = _normalize_text(prev.text) == _normalize_text(s.text)
            if same_text and _overlap_ratio(prev, s) >= _DUPLICATE_OVERLAP_RATIO:
                # Same audio region transcribed twice — keep the first take,
                # widening it to cover both windows.
                prev.end = max(prev.end, s.end)
                continue
        deduped.append(s)

    result: list[SegmentInfo] = []
    prev_end = 0.0
    for s in deduped:
        start = max(s.start, prev_end) if result else max(s.start, 0.0)
        end = max(s.end, start)
        words = _sanitize_words(s.words, start, end)
        result.append(
            SegmentInfo(start=round(start, 3), end=round(end, 3), text=s.text, words=words)
        )
        prev_end = end
    return result
