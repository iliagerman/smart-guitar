"""Match-quality gate for external sheet/tab fetchers.

Both Ultimate Guitar and Songsterr search are fuzzy: the top result for
"Adele - Hello" can easily be "Lionel Richie - Hello" because the title is
identical. This module enforces that the artist *and* the title each clear
their own similarity threshold — a perfect title alone (or a perfect artist
alone) is not enough.

Used by ``ug_chord_fetcher`` and ``external_strum_fetcher`` to filter
search results, and by ``job_service`` to validate previously-stored
sheets against the song's current artist/title.
"""

from __future__ import annotations

import re

# Per-component thresholds. Both artist and title must clear MIN_*_SCORE for
# a result to be accepted. The component_score tiers map roughly to:
#   1.0 = exact match (after normalization)
#   0.7 = substring match in either direction
#   0..0.4 = partial word overlap (proportional)
#   0.0  = no overlap at all
# Substring (0.7) is the loosest match we trust.
MIN_ARTIST_SCORE = 0.7
MIN_TITLE_SCORE = 0.7


def normalize(text: str) -> str:
    """Lower-case, strip parentheticals/feat-suffixes/punctuation."""
    text = (text or "").lower().strip()
    text = re.sub(r"\s*\(.*?\)\s*", " ", text)
    text = re.sub(r"\s*\[.*?\]\s*", " ", text)
    text = re.sub(r"\b(feat\.?|ft\.?|featuring)\b.*", "", text)
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def component_score(query: str, result: str) -> float:
    """Score one field (artist or title). Returns a value in [0.0, 1.0]."""
    q = normalize(query)
    r = normalize(result)

    if not q or not r:
        return 0.0

    if q == r:
        return 1.0
    if q in r or r in q:
        return 0.7

    q_words = set(q.split())
    r_words = set(r.split())
    overlap = len(q_words & r_words)
    if overlap == 0:
        return 0.0
    return 0.4 * (overlap / max(len(q_words), 1))


def match_components(
    query_artist: str,
    query_title: str,
    result_artist: str,
    result_title: str,
) -> tuple[float, float]:
    """Return (artist_score, title_score) — each independently in [0, 1]."""
    return (
        component_score(query_artist, result_artist),
        component_score(query_title, result_title),
    )


def accept_match(
    artist_score: float,
    title_score: float,
    *,
    min_artist: float = MIN_ARTIST_SCORE,
    min_title: float = MIN_TITLE_SCORE,
) -> bool:
    """Accept only if BOTH components clear their threshold.

    This is the key fix: summing the two scores (the old behavior) let a
    perfect title carry a missing artist over the line.
    """
    return artist_score >= min_artist and title_score >= min_title
