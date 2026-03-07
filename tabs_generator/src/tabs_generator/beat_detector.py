"""Beat detection using librosa.

Extracts BPM and beat positions from guitar audio using librosa's
beat_track. These beat positions are used by the strum detector to
generate beat-aligned strumming patterns.
"""

import logging

import librosa
import numpy as np

logger = logging.getLogger(__name__)


def detect_beats(
    audio_path: str,
    sr: int = 22050,
) -> tuple[float, list[float]]:
    """Detect BPM and beat positions from an audio file.

    Args:
        audio_path: Path to the audio file.
        sr: Sample rate for loading audio.

    Returns:
        (bpm, beat_times) where bpm is estimated tempo and beat_times
        is a list of beat positions in seconds, sorted ascending.
    """
    y, sr_actual = librosa.load(audio_path, sr=sr)

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr_actual)

    # librosa may return tempo as an ndarray with one element
    if isinstance(tempo, np.ndarray):
        bpm = float(tempo[0]) if tempo.size > 0 else 120.0
    else:
        bpm = float(tempo)

    beat_times = librosa.frames_to_time(beat_frames, sr=sr_actual).tolist()

    logger.info(
        "Beat detection: bpm=%.1f, %d beats detected",
        bpm,
        len(beat_times),
    )

    return bpm, beat_times
