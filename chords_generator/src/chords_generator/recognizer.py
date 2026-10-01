"""Chord recognition: BTC chord probabilities decided on the Beat This! beat grid.

The beats come from the full mix (drums included). The chord model hears the
full mix and, when the separated stems are available, the accompaniment mix
too; averaging the two is more accurate than either alone. Every chord change
lands on a tracked beat, so the bar layout needs no snapping afterwards.
"""

import json
import logging
import os
import time

from chords_generator.beat_decode import beats_per_bar, decode_chords_on_beats
from chords_generator.beat_tracking import tempo_bpm, track_beats
from chords_generator.chord_model import FRAME_S, LABELS, SAMPLE_RATE, chord_log_probs, load_mono
from chords_generator.schemas import ChordResult
from chords_generator.simplifier import generate_simplified_options, write_simplified_outputs

logger = logging.getLogger(__name__)

CHORD_MODEL = "btc-large-voca"
BEAT_MODEL = "beat_this-final0"


def recognize_chords(
    audio_path: str, output_dir: str, accompaniment_path: str | None = None,
) -> list[ChordResult]:
    """Recognize chords and write chords.json, chords.lab, chord_meta.json and the simplified variants.

    Args:
        audio_path: The full mix.
        output_dir: Where the outputs are written.
        accompaniment_path: Optional mix of the non-vocal, non-drum stems.
    """
    os.makedirs(output_dir, exist_ok=True)

    timings: dict[str, float] = {}
    clock = time.monotonic()

    def lap(step: str) -> None:
        nonlocal clock
        now = time.monotonic()
        timings[step] = round(now - clock, 1)
        clock = now

    y = load_mono(audio_path)
    duration = len(y) / SAMPLE_RATE
    lap("load")
    log_probs = chord_log_probs(y)
    lap("chords")
    if accompaniment_path:
        accompaniment = load_mono(accompaniment_path)
        lap("load_accompaniment")
        accompaniment_log_probs = chord_log_probs(accompaniment)
        lap("chords_accompaniment")
        frames = min(len(log_probs), len(accompaniment_log_probs))
        log_probs = (log_probs[:frames] + accompaniment_log_probs[:frames]) / 2

    beats, downbeats = track_beats(y, SAMPLE_RATE)
    lap("beats")
    results = decode_chords_on_beats(log_probs, LABELS, FRAME_S, beats, downbeats, duration)
    bpm = tempo_bpm(beats)
    logger.info(
        "Recognized %d chords on %d beats (%.1f bpm, %d downbeats); seconds: %s",
        len(results), len(beats), bpm, len(downbeats), timings,
    )

    with open(os.path.join(output_dir, "chords.lab"), "w") as f:
        for r in results:
            f.write(f"{r.start_time:.3f}\t{r.end_time:.3f}\t{r.chord}\n")
    with open(os.path.join(output_dir, "chords.json"), "w") as f:
        json.dump(
            [{"start_time": r.start_time, "end_time": r.end_time, "chord": r.chord} for r in results],
            f,
            indent=2,
        )

    write_simplified_outputs(generate_simplified_options(results), output_dir)

    with open(os.path.join(output_dir, "chord_meta.json"), "w") as f:
        json.dump(beat_meta(beats, downbeats), f, indent=2)

    return results


def beat_meta(beats: list[float], downbeats: list[float]) -> dict:
    """chord_meta.json beat fields. ``bar_starts`` are the tracked downbeats."""
    meta: dict = {"chord_model": CHORD_MODEL, "beat_model": BEAT_MODEL}
    if beats:
        meta["bpm"] = round(tempo_bpm(beats), 2)
        meta["beat_times"] = [round(b, 3) for b in beats]
        meta["downbeat_times"] = [round(d, 3) for d in downbeats]
        meta["beats_per_bar"] = beats_per_bar(beats, downbeats)
        meta["bar_starts"] = [round(d, 3) for d in downbeats]
    return meta

