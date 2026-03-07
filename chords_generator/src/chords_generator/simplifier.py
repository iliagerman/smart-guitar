"""Chord simplification using pychord.

Generates multiple playback options from recognized chords:
- Intermediate: basic major/minor triads (extensions stripped)
- Beginner: open chords only (no barre chords)
- Capo variations: transposed to maximize open chords
"""

import json
import logging
import os

from pychord import Chord

from chords_generator.schemas import ChordResult

logger = logging.getLogger(__name__)

# ── MIREX → pychord conversion ──────────────────────────────────

_MIREX_TO_PYCHORD_QUALITY: dict[str, str] = {
    "maj": "",
    "min": "m",
    "maj7": "maj7",
    "min7": "m7",
    "7": "7",
    "dim": "dim",
    "dim7": "dim7",
    "aug": "aug",
    "sus4": "sus4",
    "sus2": "sus2",
    "min6": "m6",
    "maj6": "6",
    "9": "9",
    "min9": "m9",
    "maj9": "maj9",
    "11": "11",
    "13": "13",
}


def mirex_to_pychord(mirex_chord: str) -> str | None:
    """Convert a MIREX chord label to pychord notation.

    Returns None for 'N' (no chord).
    """
    if mirex_chord == "N":
        return None

    if ":" not in mirex_chord:
        return mirex_chord

    root, rest = mirex_chord.split(":", 1)
    # Strip slash-bass (e.g. "min/b3") — keep only the quality
    quality = rest.split("/")[0] if "/" in rest else rest
    pychord_quality = _MIREX_TO_PYCHORD_QUALITY.get(quality, quality)
    return f"{root}{pychord_quality}"


# ── Triad simplification ────────────────────────────────────────

_QUALITY_TO_TRIAD: dict[str, str] = {
    # Major family → major
    "": "",
    "maj7": "",
    "6": "",
    "add9": "",
    "maj9": "",
    "maj13": "",
    "sus4": "",
    "sus2": "",
    "aug": "",
    "7": "",
    "9": "",
    "11": "",
    "13": "",
    # Minor family → minor
    "m": "m",
    "m7": "m",
    "m6": "m",
    "m9": "m",
    "m11": "m",
    "dim": "m",
    "dim7": "m",
}


def simplify_to_triad(pychord_name: str) -> str:
    """Simplify a chord to its basic major or minor triad.

    Uses pychord to parse the chord, then maps the quality to
    either major or minor.  Returns the original string if pychord
    cannot parse it.
    """
    try:
        chord = Chord(pychord_name)
        quality_str = str(chord.quality)
        simplified_quality = _QUALITY_TO_TRIAD.get(quality_str, "")
        return f"{chord.root}{simplified_quality}"
    except ValueError:
        return pychord_name


# ── Open-chord mapping (beginner) ───────────────────────────────

OPEN_CHORDS: set[str] = {"C", "D", "E", "G", "A", "Am", "Dm", "Em"}

# Maps any triad to its nearest open-chord equivalent (by semitone distance).
_OPEN_CHORD_MAP: dict[str, str] = {
    # Major → nearest open major
    "C": "C", "D": "D", "E": "E", "G": "G", "A": "A",
    "C#": "D", "Db": "D",
    "D#": "D", "Eb": "E",
    "F": "E",
    "F#": "G", "Gb": "G",
    "G#": "A", "Ab": "A",
    "A#": "A", "Bb": "A",
    "B": "C",
    # Minor → nearest open minor
    "Am": "Am", "Dm": "Dm", "Em": "Em",
    "A#m": "Am", "Bbm": "Am",
    "Bm": "Am",
    "Cm": "Dm",
    "C#m": "Dm", "Dbm": "Dm",
    "D#m": "Em", "Ebm": "Em",
    "Fm": "Em",
    "F#m": "Em", "Gbm": "Em",
    "Gm": "Am",
    "G#m": "Am", "Abm": "Am",
}


def to_open_chord(chord_name: str) -> str:
    """Map a chord to its nearest open-chord equivalent."""
    return _OPEN_CHORD_MAP.get(chord_name, chord_name)


# ── Capo transposition ──────────────────────────────────────────


def transpose_for_capo(chord_name: str, capo_fret: int) -> str:
    """Transpose a chord down by *capo_fret* semitones.

    This gives the chord shape a player would finger with a capo
    on the given fret.  Returns the original string if pychord
    cannot parse it or capo_fret is 0.
    """
    if capo_fret == 0:
        return chord_name
    try:
        chord = Chord(chord_name)
        chord.transpose(-capo_fret)
        return str(chord)
    except ValueError:
        return chord_name


def score_open_chords(chords: list[str]) -> int:
    """Count how many chord names fall in the open-chord set."""
    return sum(1 for c in chords if c in OPEN_CHORDS)


# ── Main entry point ────────────────────────────────────────────


def generate_simplified_options(results: list[ChordResult]) -> dict:
    """Produce simplified chord options from recognized chord results.

    Returns a dict ready for JSON serialisation::

        {
          "options": [
            {"name": "intermediate", "capo": 0, ...},
            {"name": "beginner",     "capo": 0, ...},
            {"name": "beginner_capo_N", "capo": N, ...},
            ...
          ]
        }
    """
    # 1. Convert MIREX → pychord → triad  (intermediate level)
    intermediate_chords: list[dict] = []
    intermediate_names: list[str] = []
    for r in results:
        if r.chord == "N":
            intermediate_chords.append(
                {"start_time": r.start_time, "end_time": r.end_time, "chord": "N"}
            )
            intermediate_names.append("N")
            continue

        pychord_name = mirex_to_pychord(r.chord)
        if pychord_name is None:
            intermediate_chords.append(
                {"start_time": r.start_time, "end_time": r.end_time, "chord": "N"}
            )
            intermediate_names.append("N")
            continue

        triad = simplify_to_triad(pychord_name)
        intermediate_chords.append(
            {"start_time": r.start_time, "end_time": r.end_time, "chord": triad}
        )
        intermediate_names.append(triad)

    # 2. Beginner (open chords, no capo)
    beginner_chords: list[dict] = []
    for entry in intermediate_chords:
        chord = entry["chord"]
        if chord == "N":
            beginner_chords.append(entry)
        else:
            beginner_chords.append(
                {"start_time": entry["start_time"], "end_time": entry["end_time"],
                 "chord": to_open_chord(chord)}
            )

    # 3. Best capo variations (score each capo 1-7, always pick top 2)
    capo_candidates: list[tuple[int, int, list[dict]]] = []
    for capo in range(1, 8):
        transposed_entries: list[dict] = []
        transposed_names: list[str] = []
        for entry in intermediate_chords:
            chord = entry["chord"]
            if chord == "N":
                transposed_entries.append(entry)
            else:
                t = transpose_for_capo(chord, capo)
                transposed_entries.append(
                    {"start_time": entry["start_time"], "end_time": entry["end_time"],
                     "chord": t}
                )
                transposed_names.append(t)

        capo_score = score_open_chords(transposed_names)
        capo_candidates.append((capo, capo_score, transposed_entries))

    # Always pick the top 2 capo positions by open-chord score
    capo_candidates.sort(key=lambda x: x[1], reverse=True)
    best_capos = capo_candidates[:2]

    # Build options list
    options: list[dict] = [
        {
            "name": "intermediate",
            "description": "Basic triads without extensions",
            "capo": 0,
            "chords": intermediate_chords,
        },
        {
            "name": "beginner",
            "description": "Open chords only",
            "capo": 0,
            "chords": beginner_chords,
        },
    ]

    for capo, _score, entries in best_capos:
        # Also convert capo chords to open where possible
        open_entries: list[dict] = []
        for entry in entries:
            chord = entry["chord"]
            if chord == "N":
                open_entries.append(entry)
            else:
                open_entries.append(
                    {"start_time": entry["start_time"], "end_time": entry["end_time"],
                     "chord": to_open_chord(chord)}
                )
        options.append(
            {
                "name": f"beginner_capo_{capo}",
                "description": f"Easy open chords with capo on fret {capo}",
                "capo": capo,
                "chords": open_entries,
            }
        )

    logger.info(
        "Generated %d simplified options (%d chords each)",
        len(options),
        len(results),
    )
    return {"options": options}


def write_simplified_outputs(options: dict, output_dir: str) -> list[str]:
    """Write each simplified option to its own JSON file in *output_dir*.

    Files produced (always):
        - ``chords_intermediate.json``
        - ``chords_beginner.json``

    Files produced (when beneficial capo positions exist):
        - ``chords_capo_{N}.json``  (up to 2)

    Each file is a JSON object with ``name``, ``description``, ``capo``,
    and ``chords`` (array of ``{start_time, end_time, chord}``).

    Returns the list of filenames written.
    """
    os.makedirs(output_dir, exist_ok=True)
    written: list[str] = []

    for option in options["options"]:
        filename = f"chords_{option['name']}.json"
        filepath = os.path.join(output_dir, filename)
        with open(filepath, "w") as f:
            json.dump(option, f, indent=2)
        written.append(filename)

    logger.info("Wrote %d simplified chord files to %s: %s", len(written), output_dir, written)
    return written
