"""Shared helpers for the song service package."""

import re
from typing import Any

from guitar_player.schemas.song import LyricsSegment, LyricsWord, StemType

# Chord variant files produced by the simplifier (name prefix -> filename).
CHORD_VARIANT_PREFIX = "chords_"
CHORD_VARIANT_SUFFIX = ".json"

# Single source of truth for stem types -- drives the API response and DB lookups.
STEM_DEFINITIONS: list[StemType] = [
    StemType(name="vocals", label="Vocals"),
    StemType(name="guitar", label="Guitar"),
    StemType(name="drums", label="Drums"),
    StemType(name="bass", label="Bass"),
    StemType(name="piano", label="Piano"),
    StemType(name="other", label="Other"),
]

STEM_NAMES = [s.name for s in STEM_DEFINITIONS]


def to_folder_name(name: str) -> str:
    """Convert a display name to a filesystem-safe snake_case folder name."""
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s-]+", "_", s)
    return s.strip("_")


def slug_to_display(slug: str) -> str:
    """Convert an internal slug (snake_case/kebab-case) into Title Case for UI."""
    s = (slug or "").strip()
    if not s:
        return ""
    s = s.replace("_", " ").replace("-", " ")
    s = re.sub(r"\s+", " ", s).strip()
    parts = [p for p in s.split(" ") if p]
    return " ".join(p[:1].upper() + p[1:].lower() for p in parts)


def parse_lyrics_payload(
    raw: dict[str, Any] | list[Any],
) -> tuple[list[LyricsSegment], str | None, dict[str, Any] | None]:
    """Parse a raw lyrics JSON payload into typed segments."""
    if not (isinstance(raw, dict) and "segments" in raw):
        return [], None, None

    segments = [
        LyricsSegment(
            start=segment["start"],
            end=segment["end"],
            text=segment["text"],
            words=[LyricsWord(**word) for word in segment.get("words", [])],
        )
        for segment in raw["segments"]
    ]
    return segments, raw.get("source"), raw
