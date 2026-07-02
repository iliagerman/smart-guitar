"""Additive mixing of separated audio stems into a single accompaniment file.

Demucs stems sum back to the original mix, so summing a subset of them (e.g.
bass + guitar + piano/other, excluding vocals and drums) reconstructs an
"accompaniment" mix — closer to what autochord was trained to recognize than
the full mix with vocals and drums layered on top.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def mix_audio_files(input_paths: list[str], output_path: str) -> None:
    """Sum multiple audio files sample-for-sample and write the result.

    All inputs are expected to be separated stems of the same source track
    (same sample rate and length). Normalizes only if the sum clips.
    """
    import numpy as np
    import soundfile as sf

    if not input_paths:
        raise ValueError("mix_audio_files requires at least one input path")

    mixed: np.ndarray | None = None
    sample_rate: int | None = None
    for path in input_paths:
        data, sr = sf.read(path)
        if sample_rate is None:
            sample_rate = sr
        elif sr != sample_rate:
            raise ValueError(
                f"Sample rate mismatch: {path} is {sr} Hz, expected {sample_rate} Hz"
            )
        mixed = data if mixed is None else mixed + data

    max_val = np.max(np.abs(mixed))
    if max_val > 1.0:
        mixed = mixed / max_val

    sf.write(output_path, mixed, sample_rate)
    logger.info("Mixed %d stems -> %s", len(input_paths), output_path)
