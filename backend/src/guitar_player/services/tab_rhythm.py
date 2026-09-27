"""Strum patterns and beat emphasis read from a Songsterr tab.

A tab notates rhythm exactly, so no audio analysis is needed:

- Strum pattern: in the guitar track with the most strummed bars, a stroke
  is a beat that sounds at least two strings (tied notes are held, not
  struck again). A bar is strummed when it strikes beat 1, has at least
  three strokes and at least one full chord, which leaves out riffs and
  picked parts. Each section's most common bar becomes its pattern, but
  only when it covers enough of the section's strummed bars to be the
  section's real pattern. Direction follows the strumming hand: down on the
  count, up in between.
- Beat emphasis: the share of drum bars with a snare hit on each beat.
  Strum steps on the snare beats are marked as accents.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from fractions import Fraction

from guitar_player.schemas.song import StrumStep, StrumStepDirection, TabRhythm, TabStrumPattern

# General MIDI percussion: side stick, acoustic snare, electric snare.
_SNARE_NOTES = {37, 38, 40}
_MIN_STROKE_STRINGS = 2
_FULL_CHORD_STRINGS = 4
_MIN_STROKES_PER_BAR = 3
# Sections whose guitar is lead, not rhythm.
_SKIPPED_SECTIONS = re.compile(r"\bsolo\b", re.IGNORECASE)
# A section's most common bar must cover this share of its strummed bars.
_MIN_BAR_SHARE = 0.3
_MIN_SECTION_BARS = 2
_ACCENT_FROM = 0.5
_SIXTEENTH = Fraction(1, 16)
_DEFAULT_SIGNATURE = (4, 4)
_WHOLE_SONG = "Whole song"


@dataclass(frozen=True)
class _Bar:
    section: str
    signature: tuple[int, int]
    strokes: tuple[int, ...]  # stroke positions in sixteenths from the bar start


def read_tab_rhythm(guitar_tabs: list[dict], drum_tab: dict | None) -> TabRhythm | None:
    """Tab rhythm from the downloaded guitar tracks and optional drum track."""
    tracks = [_strummed_bars(tab) for tab in guitar_tabs]
    bars = max(tracks, key=len, default=[])
    signature = _dominant_signature(guitar_tabs[0]) if guitar_tabs else _DEFAULT_SIGNATURE
    beats_per_bar, beat_unit = signature
    if beat_unit not in (4, 8):
        return None

    accents = _beat_accents(drum_tab, signature) if drum_tab else []
    patterns = _section_patterns([b for b in bars if b.signature == signature], signature, accents)
    return TabRhythm(beats_per_bar=beats_per_bar, beat_accents=accents, strum_patterns=patterns)


def _bars(tab: dict) -> list[tuple[str, tuple[int, int], list[tuple[Fraction, dict]]]]:
    """(section, signature, [(position in whole notes, beat)]) for every bar."""
    section = _WHOLE_SONG
    signature = _DEFAULT_SIGNATURE
    out = []
    for measure in tab.get("measures", []):
        marker = measure.get("marker")
        if isinstance(marker, dict) and marker.get("text"):
            section = _section_name(marker["text"])
        if measure.get("signature"):
            signature = tuple(measure["signature"])
        voices = measure.get("voices") or [{}]
        position = Fraction(0)
        beats = []
        for beat in voices[0].get("beats", []):
            beats.append((position, beat))
            numerator, denominator = beat.get("duration", [1, beat.get("type", 4)])
            position += Fraction(numerator, denominator)
        if position == Fraction(signature[0], signature[1]):
            out.append((section, signature, beats))
    return out


def _section_name(marker: str) -> str:
    """ "[A] Verse 1: Drums enter" -> "Verse"."""
    name = re.sub(r"^\[[^\]]*\]\s*", "", marker)
    name = re.split(r"[:(]", name)[0]
    return re.sub(r"\s*\d+$", "", name).strip() or _WHOLE_SONG


def _struck_strings(beat: dict) -> int:
    if beat.get("rest"):
        return 0
    return sum(
        1 for note in beat.get("notes", [])
        if "fret" in note and not note.get("rest") and not note.get("tie")
    )


def _strummed_bars(tab: dict) -> list[_Bar]:
    bars = []
    for section, signature, beats in _bars(tab):
        if _SKIPPED_SECTIONS.search(section):
            continue
        strings = [(position, _struck_strings(beat)) for position, beat in beats]
        positions = [position / _SIXTEENTH for position, count in strings if count >= _MIN_STROKE_STRINGS]
        if (
            len(positions) < _MIN_STROKES_PER_BAR
            or positions[0] != 0
            or max(c for _, c in strings) < _FULL_CHORD_STRINGS
        ):
            continue
        # Tuplets and grace notes do not fit a strumming grid.
        if any(p.denominator != 1 for p in positions):
            continue
        bars.append(_Bar(section, signature, tuple(int(p) for p in positions)))
    return bars


def _dominant_signature(tab: dict) -> tuple[int, int]:
    counts = Counter(signature for _, signature, _ in _bars(tab))
    return counts.most_common(1)[0][0] if counts else _DEFAULT_SIGNATURE


def _beat_accents(drum_tab: dict, signature: tuple[int, int]) -> list[float]:
    beats_per_bar, beat_unit = signature
    hit_bars = 0
    snare_bars = [0] * beats_per_bar
    for _, bar_signature, beats in _bars(drum_tab):
        if bar_signature != signature or not any(beat.get("notes") and not beat.get("rest") for _, beat in beats):
            continue
        hit_bars += 1
        snare_beats = {
            position * beat_unit
            for position, beat in beats
            if any(note.get("fret") in _SNARE_NOTES for note in beat.get("notes", []))
        }
        for index in range(beats_per_bar):
            snare_bars[index] += index in snare_beats
    if not hit_bars:
        return []
    return [round(count / hit_bars, 2) for count in snare_bars]


def _section_patterns(bars: list[_Bar], signature: tuple[int, int], accents: list[float]) -> list[TabStrumPattern]:
    by_section: dict[str, Counter[tuple[int, ...]]] = {}
    for bar in bars:
        by_section.setdefault(bar.section, Counter())[bar.strokes] += 1

    patterns: list[TabStrumPattern] = []
    for section, counts in by_section.items():
        total = sum(counts.values())
        strokes, count = counts.most_common(1)[0]
        if total < _MIN_SECTION_BARS or count / total < _MIN_BAR_SHARE:
            continue
        pattern = _pattern(section, strokes, round(count / total, 2), signature, accents)
        same = next((p for p in patterns if p.steps == pattern.steps and p.subdivision == pattern.subdivision), None)
        if same:
            same.name = f"{same.name} / {section}"
        else:
            patterns.append(pattern)
    return patterns


def _pattern(
    name: str, strokes: tuple[int, ...], bar_share: float,
    signature: tuple[int, int], accents: list[float],
) -> TabStrumPattern:
    beats_per_bar, beat_unit = signature
    sixteenths_per_beat = 16 // beat_unit
    # Step in eighths when every stroke lands on one, else in sixteenths.
    step = 2 if all(s % 2 == 0 for s in strokes) else 1
    subdivision = sixteenths_per_beat // step
    struck = {s // step for s in strokes}

    steps = []
    for index in range(beats_per_bar * subdivision):
        if index not in struck:
            steps.append(StrumStep(direction=StrumStepDirection.MISS, accent=False))
            continue
        on_beat = index % subdivision == 0
        beat = index // subdivision
        steps.append(StrumStep(
            direction=StrumStepDirection.DOWN if index % 2 == 0 else StrumStepDirection.UP,
            accent=on_beat and bool(accents) and accents[beat] >= _ACCENT_FROM,
        ))
    return TabStrumPattern(name=name, subdivision=subdivision, steps=steps, bar_share=bar_share)
