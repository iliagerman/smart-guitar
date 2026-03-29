"""Smart merge of Gemini chord names with autochord timing.

Gemini produces correct chord names but mechanical timing.
Autochord produces accurate change-point timestamps but wrong names.
This module combines the best of both.
"""

import logging

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ChordMeta(BaseModel):
    """Chord metadata stored as chord_meta.json."""

    capo: int | None = None
    key: str | None = None
    bpm: int | None = None
    tuning: str | None = None
    time_signature: str | None = None
    notes: str | None = None
    source: str = "gemini"

# Minimum chord duration — entries shorter than this are noise.
_MIN_CHORD_DURATION = 1.0


def _build_beat_grid(
    duration: float, bpm: float, beats_per_bar: int = 4,
) -> list[float]:
    """Build a grid of beat timestamps from BPM."""
    if bpm <= 0:
        return []
    beat_interval = 60.0 / bpm
    return [i * beat_interval for i in range(int(duration / beat_interval) + 1)]


def _snap_to_grid(timestamp: float, grid: list[float]) -> float:
    """Snap a timestamp to the nearest beat grid point."""
    if not grid:
        return timestamp
    closest = min(grid, key=lambda g: abs(g - timestamp))
    return closest


def _extract_autochord_change_points(autochord: list[dict]) -> list[dict]:
    """Collapse autochord into change-point segments (merge consecutive same-chord)."""
    if not autochord:
        return []

    segments: list[dict] = []
    prev_chord = None
    for entry in autochord:
        chord = entry.get("chord", "N")
        if chord != prev_chord:
            segments.append({
                "start_time": entry["start_time"],
                "end_time": entry["end_time"],
                "original_chord": chord,
            })
            prev_chord = chord
        elif segments:
            segments[-1]["end_time"] = entry["end_time"]

    return segments


def _detect_chord_pattern(gemini_chords: list[dict]) -> list[str]:
    """Extract the ordered chord name sequence from Gemini output.

    Deduplicates consecutive same-chord entries to get the progression.
    """
    sequence: list[str] = []
    prev = None
    for entry in gemini_chords:
        chord = entry.get("chord", "N")
        if chord != "N" and chord != prev:
            sequence.append(chord)
            prev = chord
    return sequence


def merge_gemini_with_autochord(
    gemini_chords: list[dict],
    autochord_chords: list[dict],
    bpm: float = 0,
    time_signature: tuple[int, int] = (4, 4),
) -> list[dict]:
    """Map Gemini's correct chord names onto autochord's change-point timestamps.

    Algorithm:
    1. Extract autochord change-point segments (collapse consecutive same-chord).
    2. Optionally snap change points to a beat grid (reduces noise).
    3. Filter out segments shorter than half a beat (noise).
    4. Extract Gemini's ordered chord sequence.
    5. Map Gemini names cyclically onto the cleaned change points.
    6. Post-process: merge consecutive same-chord, fill gaps.
    """
    if not gemini_chords:
        return autochord_chords
    if not autochord_chords:
        return gemini_chords

    # Step 1: Collapse autochord into change-point segments
    segments = _extract_autochord_change_points(autochord_chords)
    if not segments:
        return gemini_chords

    song_duration = segments[-1]["end_time"]

    # Step 2: Snap to beat grid if BPM available
    half_beat = 60.0 / max(bpm, 60) / 2 if bpm > 0 else _MIN_CHORD_DURATION
    if bpm > 0:
        beats_per_bar = time_signature[0] if time_signature else 4
        grid = _build_beat_grid(song_duration, bpm, beats_per_bar)
        if grid:
            for seg in segments:
                seg["start_time"] = _snap_to_grid(seg["start_time"], grid)
                seg["end_time"] = _snap_to_grid(seg["end_time"], grid)

    # Step 3: Filter noise — segments shorter than half a beat
    filtered: list[dict] = []
    for seg in segments:
        dur = seg["end_time"] - seg["start_time"]
        if dur >= half_beat:
            filtered.append(seg)
        elif filtered:
            # Extend previous segment to cover the gap
            filtered[-1]["end_time"] = seg["end_time"]

    if not filtered:
        return gemini_chords

    # Step 4: Extract Gemini's chord pattern
    pattern = _detect_chord_pattern(gemini_chords)
    if not pattern:
        return gemini_chords

    # Step 5: Map pattern onto filtered change points cyclically
    pattern_len = len(pattern)
    pattern_idx = 0
    merged: list[dict] = []

    for seg in filtered:
        if seg["original_chord"] == "N":
            merged.append({
                "start_time": round(seg["start_time"], 3),
                "end_time": round(seg["end_time"], 3),
                "chord": "N",
            })
            continue

        chord_name = pattern[pattern_idx % pattern_len]
        merged.append({
            "start_time": round(seg["start_time"], 3),
            "end_time": round(seg["end_time"], 3),
            "chord": chord_name,
        })
        pattern_idx += 1

    # Step 6: Post-process
    return clean_chords(merged, song_duration)


# Maximum chord duration before splitting — prevents huge single-chord gaps
_MAX_CHORD_DURATION = 12.0


def clean_chords(
    chords: list[dict], song_duration: float = 0,
) -> list[dict]:
    """Post-process chord entries: filter short, split long, fill gaps."""
    if not chords:
        return chords

    # Filter entries shorter than minimum duration
    filtered: list[dict] = []
    for entry in chords:
        dur = entry["end_time"] - entry["start_time"]
        if dur >= _MIN_CHORD_DURATION:
            filtered.append(dict(entry))
        elif filtered:
            filtered[-1]["end_time"] = entry["end_time"]

    # Split entries that are too long (Gemini sometimes collapses sections)
    split: list[dict] = []
    for entry in filtered:
        dur = entry["end_time"] - entry["start_time"]
        if dur > _MAX_CHORD_DURATION and entry["chord"] != "N":
            # Split into chunks of ~_MAX_CHORD_DURATION
            t = entry["start_time"]
            while t < entry["end_time"] - _MIN_CHORD_DURATION:
                chunk_end = min(t + _MAX_CHORD_DURATION, entry["end_time"])
                split.append({
                    "start_time": round(t, 3),
                    "end_time": round(chunk_end, 3),
                    "chord": entry["chord"],
                })
                t = chunk_end
        else:
            split.append(entry)

    # Ensure no gaps between entries
    for i in range(1, len(split)):
        if split[i]["start_time"] > split[i - 1]["end_time"]:
            split[i - 1]["end_time"] = split[i]["start_time"]

    # Ensure coverage to song end
    if song_duration > 0 and split:
        last = split[-1]
        if last["end_time"] < song_duration - 0.5:
            last["end_time"] = round(song_duration, 3)

    # Round all times
    for entry in split:
        entry["start_time"] = round(entry["start_time"], 3)
        entry["end_time"] = round(entry["end_time"], 3)

    logger.info(
        "Chord clean: %d raw → %d cleaned entries",
        len(chords), len(split),
    )
    return split


def build_chord_meta(
    capo: int = 0,
    key: str = "",
    bpm: int = 0,
    tuning: str = "Standard",
    time_signature: str = "4/4",
    notes: str = "",
) -> ChordMeta:
    """Build chord metadata for storage as chord_meta.json."""
    return ChordMeta(
        capo=capo if capo else None,
        key=key if key else None,
        bpm=bpm if bpm else None,
        tuning=tuning if tuning and tuning != "Standard" else None,
        time_signature=time_signature if time_signature and time_signature != "4/4" else None,
        notes=notes if notes else None,
    )
