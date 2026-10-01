"""Beats and downbeats with Beat This! (Foscarin et al., ISMIR 2024).

Run on the full mix: the drums are the clearest beat there is, and the
model finds beat 1 of each bar as well as the beats.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache

import numpy as np

logger = logging.getLogger(__name__)

# scripts/download_models.sh fetches the pinned checkpoint.
_CHECKPOINT = os.environ.get(
    "BEAT_THIS_CHECKPOINT",
    os.path.join(os.path.dirname(__file__), "..", "..", "models", "beat_this-final0.ckpt"),
)


@lru_cache(maxsize=1)
def _tracker():
    from beat_this.inference import Audio2Beats

    return Audio2Beats(checkpoint_path=_CHECKPOINT, device="cpu", dbn=False)


def track_beats(y: np.ndarray, sample_rate: int) -> tuple[list[float], list[float]]:
    """Beat and downbeat times (seconds) for mono audio. Downbeats are a subset of beats."""
    beats, downbeats = _tracker()(y, sample_rate)
    return [float(b) for b in beats], [float(d) for d in downbeats]


def track_file_beats(audio_path: str) -> tuple[list[float], list[float]]:
    from chords_generator.chord_model import SAMPLE_RATE, load_mono

    return track_beats(load_mono(audio_path), SAMPLE_RATE)


def tempo_bpm(beats: list[float]) -> float:
    if len(beats) < 2:
        return 0.0
    return float(60.0 / np.median(np.diff(beats)))
