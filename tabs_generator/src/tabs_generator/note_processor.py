"""Post-processing for detected notes.

Filters out artifacts and improves note quality after basic-pitch detection
and before fret assignment. Handles common issues with Demucs-separated
guitar stems: ghost notes from bleed, fragmented sustains, and impossible
polyphony.
"""

import logging

from tabs_generator.schemas import NoteResult

logger = logging.getLogger(__name__)

# Guitar range: E2 (MIDI 40) to roughly C6 (MIDI 88, fret 24 on high E = 88)
GUITAR_MIDI_MIN = 40
GUITAR_MIDI_MAX = 88

MAX_POLYPHONY = 6

DEFAULT_MIN_DURATION = 0.05  # 50ms
DEFAULT_MERGE_GAP = 0.03  # 30ms


def filter_ghost_notes(
    notes: list[NoteResult],
    min_duration: float = DEFAULT_MIN_DURATION,
) -> list[NoteResult]:
    """Remove very short notes that are likely detection artifacts."""
    original = len(notes)
    filtered = [n for n in notes if (n.end_time - n.start_time) >= min_duration]
    removed = original - len(filtered)
    if removed:
        logger.info(
            "Removed %d ghost notes (duration < %.0fms)", removed, min_duration * 1000
        )
    return filtered


def filter_guitar_range(
    notes: list[NoteResult],
    midi_min: int = GUITAR_MIDI_MIN,
    midi_max: int = GUITAR_MIDI_MAX,
) -> list[NoteResult]:
    """Remove notes outside the playable guitar range."""
    original = len(notes)
    filtered = [n for n in notes if midi_min <= n.midi_pitch <= midi_max]
    removed = original - len(filtered)
    if removed:
        logger.info(
            "Removed %d out-of-range notes (outside MIDI %d-%d)",
            removed,
            midi_min,
            midi_max,
        )
    return filtered


def merge_fragmented_notes(
    notes: list[NoteResult],
    gap_threshold: float = DEFAULT_MERGE_GAP,
) -> list[NoteResult]:
    """Merge consecutive notes of the same pitch separated by small gaps.

    basic-pitch often fragments a single sustained note into multiple
    short detections. This merges them back together, keeping the
    higher confidence value.
    """
    if not notes:
        return notes

    sorted_notes = sorted(notes, key=lambda n: (n.midi_pitch, n.start_time))
    merged: list[NoteResult] = []
    current = sorted_notes[0]

    for next_note in sorted_notes[1:]:
        if (
            next_note.midi_pitch == current.midi_pitch
            and (next_note.start_time - current.end_time) <= gap_threshold
        ):
            current = NoteResult(
                start_time=current.start_time,
                end_time=max(current.end_time, next_note.end_time),
                midi_pitch=current.midi_pitch,
                amplitude=max(current.amplitude, next_note.amplitude),
                string=current.string,
                fret=current.fret,
                confidence=max(current.confidence, next_note.confidence),
            )
        else:
            merged.append(current)
            current = next_note

    merged.append(current)
    merged.sort(key=lambda n: n.start_time)

    merge_count = len(notes) - len(merged)
    if merge_count:
        logger.info("Merged %d fragmented note pairs", merge_count)
    return merged


def limit_polyphony(
    notes: list[NoteResult],
    max_voices: int = MAX_POLYPHONY,
) -> list[NoteResult]:
    """Limit simultaneous notes to max_voices (6 for standard guitar).

    When more than max_voices notes overlap at a point in time,
    drops the lowest-confidence ones.
    """
    if not notes:
        return notes

    notes_sorted = sorted(notes, key=lambda n: n.start_time)
    keep = set(range(len(notes_sorted)))

    for i in range(len(notes_sorted)):
        if i not in keep:
            continue

        note = notes_sorted[i]
        overlapping = []
        for j in range(len(notes_sorted)):
            if j not in keep:
                continue
            other = notes_sorted[j]
            if other.start_time >= note.end_time:
                break  # sorted by start_time, no more overlaps possible
            if other.end_time > note.start_time:
                overlapping.append(j)

        if len(overlapping) > max_voices:
            overlapping.sort(
                key=lambda idx: notes_sorted[idx].confidence, reverse=True
            )
            for idx in overlapping[max_voices:]:
                keep.discard(idx)

    result = [notes_sorted[i] for i in sorted(keep)]
    removed = len(notes) - len(result)
    if removed:
        logger.info(
            "Removed %d notes exceeding %d-voice polyphony", removed, max_voices
        )
    return result


def post_process_notes(
    notes: list[NoteResult],
    min_duration: float = DEFAULT_MIN_DURATION,
    min_confidence: float = 0.5,
    merge_gap: float = DEFAULT_MERGE_GAP,
    midi_min: int = GUITAR_MIDI_MIN,
    midi_max: int = GUITAR_MIDI_MAX,
    max_voices: int = MAX_POLYPHONY,
) -> list[NoteResult]:
    """Full post-processing pipeline for detected notes.

    Order: filter range -> remove ghost notes -> merge fragments ->
    filter confidence (after merge so merged notes keep highest) ->
    limit polyphony.
    """
    original_count = len(notes)

    notes = filter_guitar_range(notes, midi_min, midi_max)
    notes = filter_ghost_notes(notes, min_duration)
    notes = merge_fragmented_notes(notes, merge_gap)
    # Filter confidence after merging so merged notes keep the peak confidence
    notes = [n for n in notes if n.confidence >= min_confidence]
    notes = limit_polyphony(notes, max_voices)

    logger.info(
        "Post-processing: %d -> %d notes (removed %d)",
        original_count,
        len(notes),
        original_count - len(notes),
    )
    return notes
