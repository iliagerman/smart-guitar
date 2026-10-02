"""Put a chord sheet's Hebrew lines in reading order.

Chord sheets are typed left to right: the chord row sits above the lyric
with each chord at a character column. A Hebrew lyric reads right to left,
so its first word is at the right edge, under the *last* chord of the row.
Stored as written, the chords of a Hebrew line come out backwards — the
chord sequence doesn't match the song, and chords attach to the wrong words.

``to_reading_order`` reverses those rows and re-measures each chord's
position from the start of the Hebrew text. Chord-only lines (an intro, a
solo) are typed in playing order and stay as they are: on 25 Hebrew songs
that rule lines the sheets up with the audio best (17 fit, against 6 as
written and 15 when every line is reversed).
"""

from __future__ import annotations

import re

READING_ORDER = "reading"
_HEBREW = re.compile(r"[֐-׿]")


def to_reading_order(lines: list[dict]) -> list[dict]:
    """Sheet line dicts ({type, text, chords: [{chord, position}]}) with Hebrew lyric rows reversed."""
    out = []
    for line in lines:
        text = line.get("text") or ""
        chords = line.get("chords") or []
        if not chords or not _HEBREW.search(text):
            out.append(line)
            continue
        last = max(len(text) - 1, 0)
        reordered = [
            {**c, "position": min(max(last - int(c.get("position") or 0), 0), last)}
            for c in reversed(chords)
        ]
        out.append({**line, "chords": reordered})
    return out
