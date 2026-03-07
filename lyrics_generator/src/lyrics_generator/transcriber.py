"""WhisperX transcription wrapper (faster-whisper + wav2vec2 forced alignment).

Lazy-imports whisperx to avoid loading models at import time
and to enable easy test mocking.
"""

import gc
import json
import logging
import os
import warnings
from pathlib import Path

# Suppress pyannote warning about torchcodec — we intentionally exclude it
# (ABI mismatch with torch 2.8) and pyannote falls back to torchaudio fine.
warnings.filterwarnings("ignore", message="torchcodec is not installed correctly")

from .config import WhisperConfig
from .schemas import SegmentInfo, WordInfo

logger = logging.getLogger(__name__)

# CPU-only for both transcription and alignment to avoid MPS memory leaks.
_TRANSCRIBE_DEVICE = "cpu"
_ALIGN_DEVICE = "cpu"

_transcription_model = None
_alignment_models: dict[str, tuple] = {}


def _get_transcription_model(model_name: str = "base", compute_type: str = "int8", asr_options: dict | None = None):
    """Load and cache the whisperx transcription model (singleton).

    On first call, loads the model with the given asr_options.
    Subsequent calls return the cached model (asr_options ignored).
    Per-request config like initial_prompt is updated via model.options.
    """
    global _transcription_model
    if _transcription_model is None:
        import whisperx  # type: ignore[import-not-found]

        logger.info("Loading whisperx model: %s (compute_type=%s, device=%s)", model_name, compute_type, _TRANSCRIBE_DEVICE)
        _transcription_model = whisperx.load_model(
            model_name, device=_TRANSCRIBE_DEVICE, compute_type=compute_type,
            asr_options=asr_options,
        )
    return _transcription_model


def _get_alignment_model(language_code: str = "en"):
    """Load and cache the wav2vec2 alignment model (per-language)."""
    if language_code not in _alignment_models:
        import whisperx  # type: ignore[import-not-found]

        logger.info("Loading whisperx alignment model for language: %s", language_code)
        model, metadata = whisperx.load_align_model(
            language_code=language_code, device=_ALIGN_DEVICE
        )
        _alignment_models[language_code] = (model, metadata)
    return _alignment_models[language_code]


def transcribe(
    audio_path: str,
    output_dir: str,
    model_name: str = "base",
    language: str | None = "en",
    whisper_config: WhisperConfig | None = None,
) -> list[SegmentInfo]:
    """Run WhisperX transcription + forced alignment on an audio file.

    Args:
        audio_path: Path to the input audio file.
        output_dir: Directory to write lyrics.json.
        model_name: Whisper model size to use.
        language: Language code or None for auto-detect.

    Returns:
        List of SegmentInfo with word-level timestamps.
    """
    import whisperx  # type: ignore[import-not-found]

    cfg = whisper_config
    if cfg is None:
        cfg = WhisperConfig(model_name=model_name, language=language)

    # Build asr_options from config for model initialization
    asr_options: dict = {
        "beam_size": cfg.beam_size or 5,
        "patience": cfg.patience or 1.0,
        "condition_on_previous_text": cfg.condition_on_previous_text,
        "no_speech_threshold": cfg.no_speech_threshold,
        "log_prob_threshold": cfg.logprob_threshold,
        "compression_ratio_threshold": cfg.compression_ratio_threshold,
        "initial_prompt": cfg.initial_prompt,
    }

    temperature = cfg.temperature
    if isinstance(temperature, list):
        asr_options["temperatures"] = tuple(temperature)
    else:
        asr_options["temperatures"] = (temperature,) if temperature else (0.0,)

    if cfg.best_of is not None:
        asr_options["best_of"] = cfg.best_of

    model = _get_transcription_model(cfg.model_name, cfg.compute_type, asr_options=asr_options)

    # Update per-request options on the cached model (safe with concurrency=1)
    model.options.initial_prompt = cfg.initial_prompt
    model.options.condition_on_previous_text = cfg.condition_on_previous_text
    model.options.no_speech_threshold = cfg.no_speech_threshold
    model.options.log_prob_threshold = cfg.logprob_threshold
    model.options.compression_ratio_threshold = cfg.compression_ratio_threshold

    os.makedirs(output_dir, exist_ok=True)

    try:
        p = Path(audio_path)
        size = p.stat().st_size if p.is_file() else None
    except Exception:
        size = None

    logger.info(
        "Running WhisperX transcription on: %s (language=%s, size_bytes=%s)",
        audio_path,
        cfg.language,
        size,
    )

    # Step 1: Transcription via whisperx pipeline (wraps faster-whisper)
    result = model.transcribe(audio_path, language=cfg.language)

    detected_lang = result.get("language", cfg.language or "en")
    logger.info("WhisperX detected language: %s", detected_lang)

    # Step 2: Forced alignment via wav2vec2 (if enabled)
    if cfg.enable_alignment and result.get("segments"):
        audio = None
        try:
            audio = whisperx.load_audio(audio_path)
            model_a, metadata = _get_alignment_model(language_code=detected_lang)
            result = whisperx.align(
                result["segments"], model_a, metadata, audio,
                device=_ALIGN_DEVICE, return_char_alignments=False,
            )
            logger.info("WhisperX alignment completed for %s", audio_path)
        except Exception as e:
            logger.warning("WhisperX alignment failed, using raw timestamps: %s", e)
        finally:
            del audio
            gc.collect()

    # Convert whisperx result dict to SegmentInfo list
    segments: list[SegmentInfo] = []
    for seg in result.get("segments", []):
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        words = []
        for w in seg.get("words", []):
            word_text = (w.get("word") or "").strip()
            if not word_text:
                continue
            # whisperx alignment may produce words without start/end if alignment failed
            w_start = w.get("start")
            w_end = w.get("end")
            if w_start is None or w_end is None:
                continue
            words.append(
                WordInfo(
                    word=word_text,
                    start=round(w_start, 3),
                    end=round(w_end, 3),
                )
            )
        segments.append(
            SegmentInfo(
                start=round(seg.get("start", 0.0), 3),
                end=round(seg.get("end", 0.0), 3),
                text=text,
                words=words,
            )
        )

    # Write lyrics.json to output_dir
    json_path = os.path.join(output_dir, "lyrics.json")
    with open(json_path, "w") as f:
        json.dump(
            {
                "segments": [
                    {
                        "start": s.start,
                        "end": s.end,
                        "text": s.text,
                        "words": [
                            {"word": w.word, "start": w.start, "end": w.end}
                            for w in s.words
                        ],
                    }
                    for s in segments
                ]
            },
            f,
            indent=2,
        )

    logger.debug("Transcribed %d segments, output in: %s", len(segments), output_dir)
    return segments
