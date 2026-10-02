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
import unicodedata

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
    """Case-fold and retain letters/numbers from every writing system."""
    text = unicodedata.normalize("NFKC", (text or "").casefold()).strip()
    text = re.sub(r"\s*\(.*?\)\s*", " ", text)
    text = re.sub(r"\s*\[.*?\]\s*", " ", text)
    text = re.sub(r"\b(feat\.?|ft\.?|featuring)\b.*", "", text)
    decomposed = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in decomposed if char.isalnum() or char.isspace())
    return re.sub(r"\s+", " ", text).strip()


def component_score(query: str, result: str) -> float:
    """Score one field (artist or title). Returns a value in [0.0, 1.0]."""
    q = normalize(query)
    r = normalize(result)

    if not q or not r:
        return 0.0

    if q == r or q.replace(" ", "") == r.replace(" ", ""):  # "Moon Shadow" / "Moonshadow"
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


# A title matched this well carries the match alone when the two artist names
# are written in different scripts: ours "Rafi Perski", Tab4U's "רפי פרסקי".
CROSS_SCRIPT_MIN_TITLE_SCORE = 0.95
_HEBREW = re.compile(r"[֐-׿]")


def accept_sheet_match(query_artist: str, query_title: str, result_artist: str, result_title: str) -> bool:
    """accept_match, plus an exact title when the artist names are in different scripts."""
    artist_score, title_score = match_components(query_artist, query_title, result_artist, result_title)
    if accept_match(artist_score, title_score):
        return True
    scripts_differ = bool(_HEBREW.search(query_artist)) != bool(_HEBREW.search(result_artist))
    return scripts_differ and title_score >= CROSS_SCRIPT_MIN_TITLE_SCORE
