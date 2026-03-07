"""Helpers for YouTube search/query hygiene.

Policy goals:
- Prefer official uploads for keyword searches by appending the token "official".
- Avoid downloading live concerts / shows by filtering probable live-performance
  results based on the *video title*.

We intentionally use a contextual matcher (vs naive substring matching) to avoid
false positives for studio tracks like "Live Forever" or "Show Me How to Live".
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse


_WHITESPACE_RE = re.compile(r"\s+")

# Keywords that are strong signals of a performance recording.
_ALWAYS_KEYWORDS_RE = re.compile(
    r"\b(concert|festival|tour|gig|setlist|bootleg|livestream)\b", re.IGNORECASE
)

_ALWAYS_PHRASES_RE = re.compile(
    r"\b("
    r"full\s+(concert|show|set)"
    r"|live\s+(performance|session|set|show|concert)"
    r"|audience\s+recording"
    r"|pro\s+shot"
    r")\b",
    re.IGNORECASE,
)

# "live" should only trigger when it suggests a venue/broadcast context.
_LIVE_CONTEXT_RE = re.compile(
    r"\blive\s+(at|from|in|on)\b"  # live at / live from / live in / live on
    r"|\blive\s*[-–—]\s*(at|from|in|on)\b"  # live - at ...
    r"|\blive\s+\d{4}\b"  # live 1996
    r"|\b\d{4}\s+live\b"  # 1996 live
    r"|\b(live)\s+version\b",
    re.IGNORECASE,
)

# "live" or "concert" inside parentheses -- parenthesised metadata in video
# titles virtually always describes the recording, not the song name, so this
# is safe from false positives like "Live Forever".
_PAREN_LIVE_RE = re.compile(
    r"\([^)]*\blive\b[^)]*\)"
    r"|\([^)]*\bconcert\b[^)]*\)",
    re.IGNORECASE,
)

# Non-English live-performance keywords.
_NON_ENGLISH_LIVE_RE = re.compile(
    "הופעה",  # Hebrew: live show / performance
)


def _normalize(s: str) -> str:
    s = (s or "").strip()
    s = _WHITESPACE_RE.sub(" ", s)
    return s


def ensure_official_query(query: str) -> str:
    """Append "official" to a keyword query if it isn't already present."""
    q = _normalize(query)
    if not q:
        return q

    # Avoid "official official".
    if re.search(r"\bofficial\b", q, flags=re.IGNORECASE):
        return q

    return f"{q} official"


def extract_youtube_id_from_url(value: str) -> str | None:
    """Best-effort extract a YouTube video id from a URL.

    Supports:
    - https://www.youtube.com/watch?v=<id>
    - https://youtu.be/<id>
    - https://www.youtube.com/shorts/<id>
    """
    raw = (value or "").strip()
    if not raw.startswith("http://") and not raw.startswith("https://"):
        return None

    try:
        parsed = urlparse(raw)
    except Exception:
        return None

    host = (parsed.hostname or "").lower()
    path = parsed.path or ""

    if host in {"youtu.be"}:
        candidate = path.strip("/").split("/", 1)[0]
        return candidate or None

    if host.endswith("youtube.com"):
        if path == "/watch":
            qs = parse_qs(parsed.query or "")
            v = (qs.get("v") or [None])[0]
            return v

        # Shorts format: /shorts/<id>
        if path.startswith("/shorts/"):
            candidate = path.split("/", 3)[2] if len(path.split("/")) >= 3 else ""
            return candidate or None

    return None


def is_probable_live_performance_title(title: str) -> bool:
    """Return True if the title looks like a live performance/concert recording."""
    t = _normalize(title).lower()
    if not t:
        return False

    # Strong signals.
    if _ALWAYS_KEYWORDS_RE.search(t) or _ALWAYS_PHRASES_RE.search(t):
        return True

    # Contextual "live" patterns.
    if _LIVE_CONTEXT_RE.search(t):
        return True

    # "live" or "concert" inside parentheses (high-confidence signal).
    if _PAREN_LIVE_RE.search(t):
        return True

    # Non-English live-performance keywords (any position).
    if _NON_ENGLISH_LIVE_RE.search(t):
        return True

    return False
