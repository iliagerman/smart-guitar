"""Parse Guitar Pro files to extract strumming patterns.

Uses the `guitarpro` library to read .gp5/.gpx files, find guitar tracks,
and extract strum direction from note ordering within each beat.
"""

import logging
from dataclasses import dataclass, field

import guitarpro

logger = logging.getLogger(__name__)


@dataclass
class ExternalStrum:
    """A single strum event from an external Guitar Pro file."""

    beat_position: float  # position in beats from song start
    time_seconds: float  # position in seconds (at source tempo)
    direction: str  # "down" | "up"
    num_strings: int  # number of strings struck


@dataclass
class ExternalStrumPattern:
    """Parsed strumming pattern from an external source."""

    source: str  # "songsterr"
    source_bpm: float
    strums: list[ExternalStrum] = field(default_factory=list)


def _is_guitar_track(track: guitarpro.models.Track) -> bool:
    """Check if a track is a guitar track based on name or channel."""
    name = track.name.lower()
    guitar_keywords = ["guitar", "gtr", "acoustic", "electric", "rhythm", "lead"]
    if any(kw in name for kw in guitar_keywords):
        return True

    # MIDI channels 0-5 are typically guitar in Guitar Pro files
    # Channel 10 (index 9) is drums
    if hasattr(track, "channel") and track.channel:
        channel = track.channel
        if hasattr(channel, "instrument"):
            # MIDI program numbers 24-31 are guitars
            inst = channel.instrument
            if 24 <= inst <= 31:
                return True

    return False


def _determine_strum_direction(notes: list[guitarpro.models.Note]) -> str:
    """Determine strum direction from note ordering within a beat.

    In Guitar Pro, notes within a beat are ordered by string number.
    - Low-to-high string order (6→1) = down strum
    - High-to-low string order (1→6) = up strum
    """
    if len(notes) < 2:
        return "down"  # single note defaults to down

    # Get string numbers (1=high E, 6=low E in Guitar Pro convention)
    strings = [n.string for n in notes if not n.type == guitarpro.models.NoteType.tie]

    if len(strings) < 2:
        return "down"

    # Check if descending (low string number first = high pitch first = up strum)
    # or ascending (high string number first = low pitch first = down strum)
    ascending = 0
    descending = 0
    for i in range(len(strings) - 1):
        if strings[i] > strings[i + 1]:
            ascending += 1  # going from low to high pitch = down strum
        elif strings[i] < strings[i + 1]:
            descending += 1  # going from high to low pitch = up strum

    if ascending > descending:
        return "down"
    elif descending > ascending:
        return "up"
    return "down"  # default


def _beat_duration_to_seconds(beat: guitarpro.models.Beat, tempo: float) -> float:
    """Convert a Guitar Pro beat duration to seconds at a given tempo."""
    # Quarter note = 1 beat at the given tempo
    quarter_duration = 60.0 / tempo

    # Guitar Pro duration values: 1=whole, 2=half, 4=quarter, 8=eighth, etc.
    duration_value = beat.duration.value
    if duration_value <= 0:
        duration_value = 4  # default to quarter note

    base_duration = (4.0 / duration_value) * quarter_duration

    # Apply dotted note multiplier
    if beat.duration.isDotted:
        base_duration *= 1.5
    elif beat.duration.isDoubleDotted:
        base_duration *= 1.75

    # Apply tuplet
    tuplet = beat.duration.tuplet
    if tuplet and tuplet.enters > 0 and tuplet.times > 0:
        base_duration *= tuplet.times / tuplet.enters

    return base_duration


def parse_gp_file(data: bytes, source: str = "songsterr") -> ExternalStrumPattern | None:
    """Parse a Guitar Pro file and extract strumming patterns.

    Args:
        data: Raw bytes of the .gp5/.gpx file.
        source: Source identifier for the pattern.

    Returns:
        ExternalStrumPattern with aligned strum events, or None if parsing fails.
    """
    try:
        song = guitarpro.parse(data)
    except Exception:
        logger.warning("Failed to parse Guitar Pro file", exc_info=True)
        return None

    # Find guitar tracks
    guitar_tracks = [t for t in song.tracks if _is_guitar_track(t)]
    if not guitar_tracks:
        # Fallback: use the first non-percussion track
        guitar_tracks = [
            t
            for t in song.tracks
            if not (hasattr(t, "isPercussionTrack") and t.isPercussionTrack)
        ]
        if not guitar_tracks:
            logger.info("No guitar tracks found in GP file")
            return None

    # Use the first guitar track
    track = guitar_tracks[0]
    logger.info("Using track %r for strum extraction", track.name)

    # Get initial tempo
    tempo = song.tempo if hasattr(song, "tempo") and song.tempo else 120.0

    # Extract tempo changes from the header
    tempo_changes: dict[int, float] = {}
    if hasattr(song, "measureHeaders"):
        for i, header in enumerate(song.measureHeaders):
            if hasattr(header, "tempo") and header.tempo:
                tempo_value = header.tempo.value if hasattr(header.tempo, "value") else header.tempo
                if isinstance(tempo_value, (int, float)) and tempo_value > 0:
                    tempo_changes[i] = float(tempo_value)

    strums: list[ExternalStrum] = []
    current_time = 0.0
    current_beat_position = 0.0

    for measure_idx, measure in enumerate(track.measures):
        # Check for tempo change at this measure
        if measure_idx in tempo_changes:
            tempo = tempo_changes[measure_idx]

        for beat in measure.voices[0].beats:
            # Skip rests
            if beat.status == guitarpro.models.BeatStatus.rest:
                beat_seconds = _beat_duration_to_seconds(beat, tempo)
                current_time += beat_seconds
                current_beat_position += (beat_seconds * tempo) / 60.0
                continue

            # Get non-dead notes
            real_notes = [
                n
                for n in beat.notes
                if n.type != guitarpro.models.NoteType.tie
            ]

            if real_notes:
                direction = _determine_strum_direction(real_notes)
                strums.append(
                    ExternalStrum(
                        beat_position=current_beat_position,
                        time_seconds=current_time,
                        direction=direction,
                        num_strings=len(real_notes),
                    )
                )

            beat_seconds = _beat_duration_to_seconds(beat, tempo)
            current_time += beat_seconds
            current_beat_position += (beat_seconds * tempo) / 60.0

    if not strums:
        logger.info("No strums extracted from GP file")
        return None

    # Use the initial tempo as the source BPM
    source_bpm = song.tempo if hasattr(song, "tempo") and song.tempo else 120.0
    if isinstance(source_bpm, guitarpro.models.Tempo):
        source_bpm = float(source_bpm.value)

    logger.info(
        "Parsed %d strums from GP file (bpm=%.1f, %d down, %d up)",
        len(strums),
        source_bpm,
        sum(1 for s in strums if s.direction == "down"),
        sum(1 for s in strums if s.direction == "up"),
    )

    return ExternalStrumPattern(
        source=source,
        source_bpm=source_bpm,
        strums=strums,
    )
