"""Frame-level chord probabilities from the BTC large-vocabulary model.

BTC hears 24 major/minor triads plus 7ths, 6ths, sus2/sus4, dim, aug and
half-diminished chords on every root. Its frames are 10/108 s long.
"""

from __future__ import annotations

import os
from functools import lru_cache

import numpy as np

SAMPLE_RATE = 22050
FRAME_S = 10.0 / 108
_HOP = 2048
_CHUNK_S = 10.0
# scripts/download_models.sh fetches the pinned weights.
_MODEL_PATH = os.environ.get(
    "BTC_MODEL_PATH",
    os.path.join(os.path.dirname(__file__), "..", "..", "models", "btc_model_large_voca.pt"),
)

_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_QUALITIES = [
    "min", "maj", "dim", "aug", "min6", "maj6", "min7", "minmaj7",
    "maj7", "7", "dim7", "hdim7", "sus2", "sus4",
]
NO_CHORD = "N"
# 12 roots x 14 qualities, then "unknown chord" and "no chord". Unknown is
# folded into no chord: nothing in the sheet can show it.
LABELS: list[str] = [f"{root}:{quality}" for root in _ROOTS for quality in _QUALITIES] + [NO_CHORD]


@lru_cache(maxsize=1)
def _model():
    import torch

    from chords_generator.btc_model import BTCModel

    checkpoint = torch.load(_MODEL_PATH, map_location="cpu", weights_only=False)
    model = BTCModel()
    model.load_state_dict(checkpoint["model"])
    model.eval()
    return model, float(checkpoint["mean"]), float(checkpoint["std"])


def _cqt(y: np.ndarray) -> np.ndarray:
    import librosa

    # BTC was trained on CQTs computed in 10 s chunks; match it.
    chunk = int(SAMPLE_RATE * _CHUNK_S)
    parts = [
        librosa.cqt(y[start : start + chunk], sr=SAMPLE_RATE, n_bins=144, bins_per_octave=24, hop_length=_HOP)
        for start in range(0, len(y), chunk)
    ]
    return np.log(np.abs(np.concatenate(parts, axis=1)) + 1e-6).T


def chord_log_probs(y: np.ndarray) -> np.ndarray:
    """Per-frame log-probabilities over ``LABELS`` for mono audio at ``SAMPLE_RATE``."""
    import torch

    from chords_generator.btc_model import TIMESTEP

    model, mean, std = _model()
    features = (_cqt(y) - mean) / std
    frames = features.shape[0]
    features = np.pad(features, ((0, (-frames) % TIMESTEP), (0, 0)))
    with torch.no_grad():
        blocks = torch.tensor(features, dtype=torch.float32).view(-1, TIMESTEP, features.shape[1])
        logits = model(blocks).reshape(-1, len(LABELS) + 1)[:frames]
        log_probs = torch.log_softmax(logits, dim=-1).numpy()
    # Fold "unknown chord" (168) into "no chord" (169).
    folded = np.logaddexp(log_probs[:, 168], log_probs[:, 169])
    return np.concatenate([log_probs[:, :168], folded[:, None]], axis=1)


def load_mono(path: str) -> np.ndarray:
    import librosa

    y, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    return y
