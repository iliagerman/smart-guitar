"""MIDI-to-guitar-tab conversion.

Assigns optimal string/fret positions to detected MIDI notes using a
chord-aware algorithm that groups simultaneous notes and ensures physical
feasibility (no string conflicts, max hand span).
"""

import json
import logging
import os
from itertools import product

from tabs_generator.schemas import NoteResult, StrumEvent

logger = logging.getLogger(__name__)

STANDARD_TUNING = [40, 45, 50, 55, 59, 64]  # E2, A2, D3, G3, B3, E4
TUNING_NAMES = ["E2", "A2", "D3", "G3", "B3", "E4"]
MAX_FRET = 24
MAX_HAND_SPAN = 5  # max fret span a hand can comfortably reach
ONSET_TOLERANCE = 0.03  # 30ms — notes starting within this window are a chord


def get_possible_positions(
    midi_pitch: int,
    tuning: list[int] | None = None,
    max_fret: int = MAX_FRET,
) -> list[tuple[int, int]]:
    """Return all (string, fret) pairs that can produce a given MIDI pitch.

    Args:
        midi_pitch: MIDI note number (e.g. 40 = E2).
        tuning: Open-string MIDI pitches per string, low to high.
        max_fret: Highest fret available.

    Returns:
        List of (string_index, fret) tuples, sorted by string index.
    """
    if tuning is None:
        tuning = STANDARD_TUNING

    positions = []
    for string_idx, open_pitch in enumerate(tuning):
        fret = midi_pitch - open_pitch
        if 0 <= fret <= max_fret:
            positions.append((string_idx, fret))
    return positions


def group_into_chords(
    notes: list[NoteResult],
    onset_tolerance: float = ONSET_TOLERANCE,
) -> list[list[int]]:
    """Group notes by overlapping onset times.

    Notes starting within onset_tolerance of each other form a chord group.
    Returns list of groups, each a list of indices into the notes list.
    """
    if not notes:
        return []

    groups: list[list[int]] = []
    current_group = [0]

    for i in range(1, len(notes)):
        if notes[i].start_time - notes[current_group[0]].start_time <= onset_tolerance:
            current_group.append(i)
        else:
            groups.append(current_group)
            current_group = [i]

    groups.append(current_group)
    return groups


def _score_assignment(
    assignment: list[tuple[int, int]],
    hand_position: float,
) -> float:
    """Score a chord assignment (lower is better).

    Considers distance from hand position and fret span.
    """
    frets = [f for _, f in assignment if f > 0]
    if not frets:
        return 0.0  # all open strings — always good

    avg_fret = sum(frets) / len(frets)
    fret_span = max(frets) - min(frets)

    return abs(avg_fret - hand_position) + avg_fret * 0.1 + fret_span * 0.5


def _assign_chord_group(
    notes: list[NoteResult],
    indices: list[int],
    hand_position: float,
    tuning: list[int],
    max_fret: int,
    max_span: int = MAX_HAND_SPAN,
) -> float:
    """Assign string/fret to a group of simultaneous notes.

    For single notes, uses the original greedy approach.
    For chords, finds the best combination where no two notes share a
    string and all fretted notes are within max_span of each other.

    Returns updated hand position.
    """
    if len(indices) == 1:
        note = notes[indices[0]]
        positions = get_possible_positions(note.midi_pitch, tuning, max_fret)
        if positions:
            best = min(
                positions,
                key=lambda p: abs(p[1] - hand_position) + p[1] * 0.3,
            )
            note.string = best[0]
            note.fret = best[1]
            if best[1] > 0:
                hand_position = 0.7 * hand_position + 0.3 * best[1]
        return hand_position

    # Multi-note chord: collect possible positions for each note
    note_positions: list[tuple[int, list[tuple[int, int]]]] = []
    for idx in indices:
        positions = get_possible_positions(notes[idx].midi_pitch, tuning, max_fret)
        if not positions:
            continue
        note_positions.append((idx, positions))

    if not note_positions:
        return hand_position

    # For small chords (≤6 notes), brute-force all valid combinations.
    # A guitar has at most 6 strings so the search space is bounded.
    best_combo: list[tuple[int, int]] | None = None
    best_score = float("inf")

    position_lists = [positions for _, positions in note_positions]
    for combo in product(*position_lists):
        # Check: no two notes on the same string
        strings_used = [s for s, _ in combo]
        if len(set(strings_used)) != len(strings_used):
            continue

        # Check: fretted notes within max hand span
        frets = [f for _, f in combo if f > 0]
        if frets and (max(frets) - min(frets)) > max_span:
            continue

        score = _score_assignment(list(combo), hand_position)
        if score < best_score:
            best_score = score
            best_combo = list(combo)

    if best_combo:
        for i, (idx, _) in enumerate(note_positions):
            notes[idx].string = best_combo[i][0]
            notes[idx].fret = best_combo[i][1]

        frets = [f for _, f in best_combo if f > 0]
        if frets:
            avg_fret = sum(frets) / len(frets)
            hand_position = 0.7 * hand_position + 0.3 * avg_fret
    else:
        # No valid chord voicing found — fall back to greedy per-note
        for idx, positions in note_positions:
            best = min(
                positions,
                key=lambda p: abs(p[1] - hand_position) + p[1] * 0.3,
            )
            notes[idx].string = best[0]
            notes[idx].fret = best[1]
            if best[1] > 0:
                hand_position = 0.7 * hand_position + 0.3 * best[1]

    return hand_position


def assign_fret_positions(
    notes: list[NoteResult],
    tuning: list[int] | None = None,
    max_fret: int = MAX_FRET,
) -> list[NoteResult]:
    """Assign optimal string/fret to each note using chord-aware grouping.

    Groups simultaneous notes into chords and assigns them together so
    that no two notes share a string and all fretted notes fall within
    a comfortable hand span. Single notes use greedy hand-position tracking.

    Args:
        notes: List of NoteResult with midi_pitch set but string/fret unassigned.
        tuning: Open-string MIDI pitches per string.
        max_fret: Highest fret available.

    Returns:
        The same list with string and fret fields populated.
    """
    if tuning is None:
        tuning = STANDARD_TUNING

    hand_position = 3.0  # Start near lower frets

    groups = group_into_chords(notes)
    for group in groups:
        hand_position = _assign_chord_group(
            notes, group, hand_position, tuning, max_fret
        )

    return notes


def write_tabs_json(
    notes: list[NoteResult],
    output_dir: str,
    strum_events: list[StrumEvent] | None = None,
    rhythm: dict | None = None,
) -> str:
    """Write tabs.json with notes and optional strum data.

    Args:
        notes: Notes with string/fret assigned.
        output_dir: Directory to write tabs.json.
        strum_events: Optional list of detected strum events.

    Returns:
        Path to the written tabs.json file.
    """
    os.makedirs(output_dir, exist_ok=True)

    tabs_data: dict = {
        "tuning": TUNING_NAMES,
        "notes": [
            {
                "start_time": n.start_time,
                "end_time": n.end_time,
                "string": n.string,
                "fret": n.fret,
                "midi_pitch": n.midi_pitch,
                "confidence": n.confidence,
                "strum_id": n.strum_id,
            }
            for n in notes
        ],
    }

    if strum_events:
        tabs_data["strums"] = [
            {
                "id": s.id,
                "start_time": s.start_time,
                "end_time": s.end_time,
                "direction": s.direction,
                "confidence": round(s.confidence, 3),
                "num_strings": s.num_strings,
                "onset_spread_ms": round(s.onset_spread_ms, 3),
            }
            for s in strum_events
        ]

    if rhythm:
        tabs_data["rhythm"] = rhythm

    json_path = os.path.join(output_dir, "tabs.json")
    with open(json_path, "w") as f:
        json.dump(tabs_data, f, indent=2)

    logger.info("Wrote %d notes to %s", len(notes), json_path)
    return json_path


def convert_to_tabs(
    notes: list[NoteResult],
    output_dir: str,
    tuning: list[int] | None = None,
    max_fret: int = MAX_FRET,
) -> list[NoteResult]:
    """Full pipeline: assign positions and write tabs.json.

    Args:
        notes: Raw note detections from basic-pitch.
        output_dir: Directory to write tabs.json.
        tuning: Open-string MIDI pitches.
        max_fret: Highest fret available.

    Returns:
        Notes with string/fret assigned.
    """
    if tuning is None:
        tuning = STANDARD_TUNING

    notes = assign_fret_positions(notes, tuning, max_fret)
    write_tabs_json(notes, output_dir)

    return notes
