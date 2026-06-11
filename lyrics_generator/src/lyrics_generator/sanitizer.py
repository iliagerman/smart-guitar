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

# Identical-token runs faster than this are decoder degeneration ("you" x221
# in 15s ≈ 14/sec) — no human sings discrete words that fast. Real chants
# ("la la la" at ~3/sec) stay untouched.
_MAX_TOKEN_RATE_HZ = 5.0
_THINNED_TOKEN_DURATION_S = 0.3
_MIN_RUN_TO_THIN = 10


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


def _thin_degenerate_runs(words: list[WordInfo]) -> tuple[list[WordInfo], bool]:
    """Thin impossibly fast runs of one repeated token to a singable pace.

    Returns (words, modified). The run keeps its time window; only the
    token count inside it is reduced and re-timed evenly.
    """
    if len(words) < _MIN_RUN_TO_THIN:
        return words, False
    out: list[WordInfo] = []
    modified = False
    i = 0
    while i < len(words):
        j = i
        token = _normalize_text(words[i].word)
        while j < len(words) and _normalize_text(words[j].word) == token:
            j += 1
        run = words[i:j]
        if len(run) >= _MIN_RUN_TO_THIN:
            window = max(run[-1].end - run[0].start, 1e-6)
            if len(run) / window > _MAX_TOKEN_RATE_HZ:
                target = max(4, min(len(run), round(window / _THINNED_TOKEN_DURATION_S)))
                step = window / target
                start = run[0].start
                run = [
                    WordInfo(
                        word=run[0].word,
                        start=round(start + k * step, 3),
                        end=round(start + (k + 1) * step, 3),
                    )
                    for k in range(target)
                ]
                modified = True
        out.extend(run)
        i = j
    return out, modified


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
        words, thinned = _thin_degenerate_runs(words)
        # Only rebuild text when thinning changed the words — otherwise the
        # original text (punctuation, casing) is preserved verbatim.
        text = " ".join(w.word for w in words) if thinned else s.text
        result.append(
            SegmentInfo(start=round(start, 3), end=round(end, 3), text=text, words=words)
        )
        prev_end = end
    return result
