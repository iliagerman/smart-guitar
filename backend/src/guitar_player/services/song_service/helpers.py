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


# A lyric line lasts at most this long per word it contains. Measured against
# 22,774 genuinely-timed sung lines (Whisper lines followed by a real gap):
# median 0.58 s/word, 99th percentile 2.28 s/word.
MAX_SECONDS_PER_WORD = 2.5

# Floor for very short lines, and the longest any single word may stay
# highlighted. The 99.9th percentile of genuinely-timed words is 5.85 s.
MAX_HOLD_SECONDS = 5.0


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
    for segment in segments:
        _trim_to_plausible_duration(segment)
    return segments, raw.get("source"), raw



def _trim_to_plausible_duration(segment: LyricsSegment) -> None:
    """Cut a lyric line loose from the silence that follows it.

    No upstream source gives us line *end* times. LRC ends a line where the
    next line starts, Songsterr spreads lines evenly across whole sections,
    and the onset aligner then spreads the words to match. A line followed by
    a solo therefore swallows the solo: it stays highlighted over music nobody
    sings to, and it hides the instrumental gap from skip-instrumentals and
    from the chord-sheet merge.

    We cannot recover the true end here, so we bound the line by how long its
    words could plausibly take to sing. Correctly-timed lines fall well inside
    that bound and are left untouched.
    """
    for word in segment.words:
        word.end = min(word.end, word.start + MAX_HOLD_SECONDS)

    word_count = len(segment.words) or len(segment.text.split()) or 1
    budget = max(MAX_HOLD_SECONDS, word_count * MAX_SECONDS_PER_WORD)
    end = min(segment.end, segment.start + budget)
    if end >= segment.end:
        return

    segment.end = round(end, 3)
    segment.words = _refit_words(segment.words, segment.start, segment.end)


def _refit_words(
    words: list[LyricsWord], start: float, end: float,
) -> list[LyricsWord]:
    """Pull words that were stretched past `end` back inside [start, end].

    Words that already fit keep their timing. The ones beyond the trim point
    were spread across the silence, so they are redistributed evenly over
    whatever room is left — never held longer than a real note. No word is
    ever dropped.
    """
    fitting = [w for w in words if w.start < end]
    for word in fitting:
        word.end = min(word.end, end)

    stretched = words[len(fitting):]
    if not stretched:
        return words

    room_start = fitting[-1].end if fitting else start
    slice_duration = (end - room_start) / len(stretched)
    for i, word in enumerate(stretched):
        word.start = round(room_start + i * slice_duration, 3)
        word.end = round(
            min(word.start + slice_duration, word.start + MAX_HOLD_SECONDS, end), 3
        )
    return words
