"""Audio pre-processing to clean guitar stems before transcription.

Applies bandpass filtering and noise gating to reduce artifacts
from Demucs stem separation, improving basic-pitch accuracy.
"""

import logging
import os

import librosa
import numpy as np
import soundfile as sf
from scipy import signal

logger = logging.getLogger(__name__)

# Guitar fundamental range: ~80Hz (low E2) to ~1200Hz (high E fret 24)
# Include harmonics up to ~5kHz for timbre and attack transients
DEFAULT_LOW_CUT = 75.0
DEFAULT_HIGH_CUT = 5000.0
DEFAULT_NOISE_GATE_DB = -40.0


def bandpass_filter(
    audio: np.ndarray,
    sr: int,
    low_cut: float = DEFAULT_LOW_CUT,
    high_cut: float = DEFAULT_HIGH_CUT,
    order: int = 4,
) -> np.ndarray:
    """Apply a Butterworth bandpass filter.

    Removes sub-bass bleed (e.g. from bass guitar or kick drum leaking
    through Demucs) and high-frequency artifacts above the guitar's
    harmonic range.
    """
    nyquist = sr / 2
    low = low_cut / nyquist
    high = min(high_cut / nyquist, 0.99)

    sos = signal.butter(order, [low, high], btype="band", output="sos")
    return signal.sosfilt(sos, audio)


def noise_gate(
    audio: np.ndarray,
    threshold_db: float = DEFAULT_NOISE_GATE_DB,
    sr: int = 22050,
) -> np.ndarray:
    """Suppress audio segments below an RMS threshold.

    Low-energy bleed from Demucs separation (quiet instrument leakage
    between guitar notes) tends to sit well below the real guitar signal.
    This gates those quiet sections to silence.
    """
    threshold_linear = 10 ** (threshold_db / 20)

    frame_length = int(sr * 0.02)  # 20ms analysis window
    hop_length = frame_length // 4

    rms = librosa.feature.rms(y=audio, frame_length=frame_length, hop_length=hop_length)[0]

    # Build a per-sample gate mask from the frame-level RMS
    gate_mask = np.zeros_like(audio)
    for i, rms_val in enumerate(rms):
        start = i * hop_length
        end = min(start + frame_length, len(audio))
        if rms_val > threshold_linear:
            gate_mask[start:end] = 1.0

    # Smooth the gate transitions to avoid clicks (5ms attack/release)
    smooth_samples = max(int(sr * 0.005), 1)
    kernel = np.ones(smooth_samples) / smooth_samples
    gate_mask = np.convolve(gate_mask, kernel, mode="same")
    gate_mask = np.clip(gate_mask, 0.0, 1.0)

    return audio * gate_mask


def clean_guitar_audio(
    input_path: str,
    output_path: str,
    low_cut: float = DEFAULT_LOW_CUT,
    high_cut: float = DEFAULT_HIGH_CUT,
    noise_gate_db: float = DEFAULT_NOISE_GATE_DB,
) -> str:
    """Clean a guitar stem for better transcription accuracy.

    Pipeline:
        1. Bandpass filter — removes sub-bass bleed and high-frequency artifacts
        2. Noise gate — suppresses low-energy bleed between notes

    Args:
        input_path: Path to input guitar audio file.
        output_path: Path to write cleaned audio.
        low_cut: Highpass cutoff frequency in Hz.
        high_cut: Lowpass cutoff frequency in Hz.
        noise_gate_db: Noise gate threshold in dB (e.g. -40).

    Returns:
        Path to the cleaned audio file.
    """
    logger.info("Cleaning guitar audio: %s", input_path)

    audio, sr = librosa.load(input_path, sr=None, mono=True)

    audio = bandpass_filter(audio, sr, low_cut, high_cut)
    logger.info("Applied bandpass filter: %.0f-%.0f Hz", low_cut, high_cut)

    audio = noise_gate(audio, threshold_db=noise_gate_db, sr=sr)
    logger.info("Applied noise gate: %.0f dB", noise_gate_db)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    sf.write(output_path, audio, sr)
    logger.info("Wrote cleaned audio: %s", output_path)

    return output_path
