"""Chord recognition wrapper around autochord.

Lazy-imports autochord to avoid loading TensorFlow at import time
and to enable easy test mocking.
"""

import json
import logging
import os

from chords_generator.schemas import ChordResult
from chords_generator.simplifier import generate_simplified_options, write_simplified_outputs

logger = logging.getLogger(__name__)


def recognize_chords(audio_path: str, output_dir: str) -> list[ChordResult]:
    """Run chord recognition on an audio file.

    Args:
        audio_path: Path to the input audio file.
        output_dir: Directory to write chords.lab and chords.json.

    Returns:
        List of ChordResult with start_time, end_time, and chord label.
    """
    import autochord

    os.makedirs(output_dir, exist_ok=True)

    lab_path = os.path.join(output_dir, "chords.lab")
    logger.info("Running autochord on: %s", audio_path)
    autochord.recognize(audio_path, lab_fn=lab_path)

    # Parse the .lab file (MIREX format: start_time end_time chord)
    results: list[ChordResult] = []
    if os.path.isfile(lab_path):
        with open(lab_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parts = line.split()
                if len(parts) >= 3:
                    results.append(
                        ChordResult(
                            start_time=float(parts[0]),
                            end_time=float(parts[1]),
                            chord=parts[2],
                        )
                    )

    # Also save as JSON for easy consumption
    json_path = os.path.join(output_dir, "chords.json")
    with open(json_path, "w") as f:
        json.dump(
            [{"start_time": r.start_time, "end_time": r.end_time, "chord": r.chord} for r in results],
            f,
            indent=2,
        )

    # Generate simplified chord options (difficulty levels + capo variations)
    options = generate_simplified_options(results)
    write_simplified_outputs(options, output_dir)

    logger.info("Recognized %d chords, output in: %s", len(results), output_dir)
    return results
