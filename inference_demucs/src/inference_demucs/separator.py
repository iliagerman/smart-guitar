"""Demucs-based audio source separation.

Uses the htdemucs_6s model (6 stems: vocals, drums, bass, guitar, piano, other)
via the demucs pretrained/apply API. This model has a dedicated guitar stem,
making it suitable for guitar isolation tasks.

For songs with primarily acoustic guitar (like Bob Dylan), the guitar stem
effectively captures the acoustic guitar.
"""

import gc
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

logger = logging.getLogger(__name__)

DEMUCS_MODEL = "htdemucs_6s"

# Cached model singleton — avoids reloading hundreds of MB on every call.
_cached_model = None
_cached_model_name: str | None = None


def _get_model(model_name: str = DEMUCS_MODEL):
    """Load and cache the Demucs model (singleton, CPU-only)."""
    global _cached_model, _cached_model_name

    if _cached_model is not None and _cached_model_name == model_name:
        return _cached_model

    from demucs.pretrained import get_model

    device = torch.device("cpu")
    logger.info("Loading Demucs model: %s (device=%s)", model_name, device)
    model = get_model(model_name)
    model.eval()
    model.to(device)

    _cached_model = model
    _cached_model_name = model_name
    return model


@dataclass
class SeparationResult:
    """Result of a single separation output."""

    description: str
    output_path: str
    mode: str  # "isolate" or "remove"


def separate_stems(
    audio_path: str,
    output_dir: str,
    model_name: str = DEMUCS_MODEL,
) -> dict[str, str]:
    """Separate audio into stems using Demucs htdemucs_6s.

    Args:
        audio_path: Path to input audio file (MP3 or WAV).
        output_dir: Directory to write output stem files.
        model_name: Demucs model name. Defaults to htdemucs_6s.

    Returns:
        Dict mapping stem name -> output file path.
    """
    from demucs.apply import apply_model
    from demucs.separate import load_track

    os.makedirs(output_dir, exist_ok=True)

    device = torch.device("cpu")
    model = _get_model(model_name)

    logger.info("Model sources: %s", model.sources)
    logger.info("Loading audio: %s", audio_path)
    wav = load_track(audio_path, model.audio_channels, model.samplerate)

    # wav shape: (channels, samples) — add batch dim
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()

    # Always use split mode: htdemucs has a training length of ~7.8 s
    # (343 980 samples at 44.1 kHz), so any real-world track must be chunked.
    duration_seconds = wav.shape[-1] / model.samplerate

    logger.info(
        "Running separation (duration=%.0fs, device=%s)...",
        duration_seconds,
        device,
    )
    # Memory tuning for Lambda (3 GB):
    #   shifts=0 — skip random-shift averaging (~50% less peak memory)
    #   split    — process each source separately for long tracks
    with torch.no_grad():
        sources = apply_model(
            model, wav[None], device=device, progress=False, shifts=0, split=True
        )[0]

    # Free the input tensor immediately.
    del wav
    gc.collect()

    # Undo normalization
    sources = sources * ref.std() + ref.mean()
    del ref
    gc.collect()

    stem_paths: dict[str, str] = {}
    source_names = list(model.sources)
    samplerate = model.samplerate

    # Write each stem and free its tensor immediately.
    for i, stem_name in enumerate(source_names):
        out_path = os.path.join(output_dir, f"{stem_name}.wav")
        stem_audio = sources[i].numpy().T  # (samples, channels)
        sf.write(out_path, stem_audio, samplerate)
        del stem_audio
        stem_paths[stem_name] = out_path
        logger.info("Wrote stem: %s -> %s", stem_name, out_path)

    # Free the large sources tensor.
    del sources
    gc.collect()

    return stem_paths


DEFAULT_OUTPUTS = {
    "guitar_isolated",
    "vocals_isolated",
    "guitar_removed",
    "vocals_removed",
}


def produce_test_outputs(
    audio_path: str,
    output_dir: str,
    requested_outputs: set[str] | None = None,
) -> list[SeparationResult]:
    """Produce requested audio outputs from stem separation.

    Available outputs: guitar_isolated, vocals_isolated, guitar_removed, vocals_removed.

    Args:
        audio_path: Path to input audio file.
        output_dir: Directory to write output files.
        requested_outputs: Which outputs to produce. Defaults to all four.

    Returns:
        List of SeparationResult with paths to output files.
    """
    if requested_outputs is None:
        requested_outputs = DEFAULT_OUTPUTS

    stem_paths = separate_stems(audio_path, output_dir)
    results: list[SeparationResult] = []

    # Isolated guitar
    if "guitar_isolated" in requested_outputs and "guitar" in stem_paths:
        results.append(
            SeparationResult(
                description="guitar_isolated",
                output_path=stem_paths["guitar"],
                mode="isolate",
            )
        )

    # Isolated vocals
    if "vocals_isolated" in requested_outputs and "vocals" in stem_paths:
        results.append(
            SeparationResult(
                description="vocals_isolated",
                output_path=stem_paths["vocals"],
                mode="isolate",
            )
        )

    # Everything except guitar (mix all other stems)
    if "guitar_removed" in requested_outputs:
        non_guitar = {k: v for k, v in stem_paths.items() if k != "guitar"}
        if non_guitar:
            mixed_path = os.path.join(output_dir, "guitar_removed.wav")
            _mix_stems(list(non_guitar.values()), mixed_path)
            results.append(
                SeparationResult(
                    description="guitar_removed",
                    output_path=mixed_path,
                    mode="remove",
                )
            )

    # Everything except vocals (mix all other stems)
    if "vocals_removed" in requested_outputs:
        non_vocals = {k: v for k, v in stem_paths.items() if k != "vocals"}
        if non_vocals:
            mixed_path = os.path.join(output_dir, "vocals_removed.wav")
            _mix_stems(list(non_vocals.values()), mixed_path)
            results.append(
                SeparationResult(
                    description="vocals_removed",
                    output_path=mixed_path,
                    mode="remove",
                )
            )

    # Convert ALL WAV files to MP3.
    #
    # Even if the caller only requested a subset of the derived outputs
    # (guitar_isolated/vocals_isolated/guitar_removed/vocals_removed), Demucs
    # already computed the full 6-stem separation. Keeping and converting the
    # raw stems (drums/bass/piano/other/etc.) enables downstream consumers
    # (backend admin, UI track selector) to serve them without re-running
    # separation.
    #
    # MP3 (CBR) is preferred over OGG Vorbis because browsers report more
    # accurate currentTime for MP3, which is critical for real-time lyrics
    # sync highlighting.
    for wav_file in list(Path(output_dir).glob("*.wav")):
        _wav_to_mp3(str(wav_file))

    # Update result paths to point to MP3 files
    for r in results:
        r.output_path = r.output_path.rsplit(".", 1)[0] + ".mp3"

    return results


def _wav_to_mp3(wav_path: str) -> str:
    """Convert a WAV file to MP3 (CBR 192 kbps) using ffmpeg, delete the WAV, and return the MP3 path.

    CBR is used instead of VBR because constant-bitrate MP3 frames give
    browsers exact byte-to-time mapping, producing highly accurate
    ``currentTime`` values — critical for real-time lyrics sync.
    """
    mp3_path = wav_path.rsplit(".", 1)[0] + ".mp3"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            wav_path,
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            mp3_path,
        ],
        check=True,
        capture_output=True,
    )
    os.remove(wav_path)
    logger.info("Converted %s -> %s", wav_path, mp3_path)
    return mp3_path


def _mix_stems(stem_paths: list[str], output_path: str) -> None:
    """Mix multiple stem audio files by summing them.

    Demucs stems are additive — they sum back to the original signal.
    We normalize only if the result clips.
    """
    mixed: np.ndarray | None = None
    sample_rate: int | None = None

    # Accumulate incrementally instead of collecting all arrays in memory.
    for path in stem_paths:
        data, sr = sf.read(path)
        if sample_rate is None:
            sample_rate = sr
        if mixed is None:
            mixed = data
        else:
            mixed = mixed + data
        del data

    if mixed is None or sample_rate is None:
        return

    # Normalize only if clipping
    max_val = np.max(np.abs(mixed))
    if max_val > 1.0:
        mixed = mixed / max_val

    sf.write(output_path, mixed, sample_rate)
    del mixed
    logger.info("Mixed %d stems -> %s", len(stem_paths), output_path)
