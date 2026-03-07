"""Note transcription wrapper around basic-pitch.

Lazy-imports basic-pitch to avoid loading TensorFlow at import time
and to enable easy test mocking.
"""

import logging
import os
import io
from contextlib import redirect_stderr, redirect_stdout

from tabs_generator.schemas import NoteResult

logger = logging.getLogger(__name__)

_model = None


def _get_model():
    global _model
    if _model is None:
        from basic_pitch import ICASSP_2022_MODEL_PATH

        _model = ICASSP_2022_MODEL_PATH
    return _model


def transcribe_notes(
    audio_path: str,
    output_dir: str,
    onset_threshold: float = 0.5,
    frame_threshold: float = 0.3,
    min_confidence: float = 0.5,
) -> list[NoteResult]:
    """Run basic-pitch note detection on an audio file.

    Args:
        audio_path: Path to the input audio file (guitar stem).
        output_dir: Directory for intermediate outputs.
        onset_threshold: Minimum probability for note onset detection.
        frame_threshold: Minimum probability for frame-level activation.
        min_confidence: Minimum amplitude to keep a detected note.

    Returns:
        List of NoteResult with timing and MIDI pitch (string/fret unassigned).
    """
    from basic_pitch.inference import predict

    os.makedirs(output_dir, exist_ok=True)

    model_path = _get_model()
    logger.info("Running basic-pitch on: %s", audio_path)

    # basic-pitch is quite chatty and prints directly to stdout/stderr (not logging),
    # which becomes unbearable in a long-running API. Capture that output.
    buf = io.StringIO()
    with redirect_stdout(buf), redirect_stderr(buf):
        model_output, midi_data, note_events = predict(
            audio_path,
            model_or_model_path=model_path,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
    suppressed = buf.getvalue().strip()
    if suppressed:
        logger.debug(
            "Suppressed basic-pitch console output (%d chars)", len(suppressed)
        )

    results: list[NoteResult] = []
    for event in note_events:
        start_time = float(event[0])
        end_time = float(event[1])
        midi_pitch = int(event[2])
        amplitude = float(event[3])

        if amplitude < min_confidence:
            continue

        results.append(
            NoteResult(
                start_time=round(start_time, 3),
                end_time=round(end_time, 3),
                midi_pitch=midi_pitch,
                amplitude=round(amplitude, 3),
                string=-1,
                fret=-1,
                confidence=round(amplitude, 3),
            )
        )

    results.sort(key=lambda n: n.start_time)
    logger.info("Detected %d notes above confidence %.2f", len(results), min_confidence)
    return results
