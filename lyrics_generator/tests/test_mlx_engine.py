"""MLX (Apple GPU) transcription engine routing.

The default engine stays "whisperx" (faster-whisper, CPU/CUDA) so the x86
production Lambda is unaffected. When `whisper.engine: mlx` is configured,
Step 1 transcription runs on the Apple GPU via mlx-whisper, and the rest of
the pipeline (wav2vec2 alignment, onset refinement, sanitizer) is unchanged.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

from lyrics_generator.config import WhisperConfig
from lyrics_generator import transcriber


def _fake_mlx_module(captured: dict):
    mod = types.ModuleType("mlx_whisper")

    def fake_transcribe(audio_path, **kwargs):
        captured["audio_path"] = audio_path
        captured.update(kwargs)
        return {
            "language": "en",
            "segments": [
                {
                    "start": 1.0, "end": 3.0, "text": " Hello world",
                    "words": [
                        {"word": " Hello", "start": 1.0, "end": 1.8},
                        {"word": " world", "start": 2.0, "end": 2.9},
                    ],
                },
            ],
        }

    mod.transcribe = fake_transcribe
    return mod


def test_mlx_engine_routes_and_maps_options(tmp_path, monkeypatch):
    captured: dict = {}
    monkeypatch.setitem(sys.modules, "mlx_whisper", _fake_mlx_module(captured))

    cfg = WhisperConfig(
        engine="mlx",
        model_name="large-v3",
        language=None,
        temperature=[0.0, 0.2, 0.4],
        condition_on_previous_text=False,
        initial_prompt="Song: Test; Artist: Tester.",
        enable_alignment=False,  # alignment tested separately; not under test here
    )
    segments = transcriber.transcribe(
        "fake.mp3", str(tmp_path), whisper_config=cfg,
    )

    # Routed to mlx with the config mapped through.
    assert captured["audio_path"] == "fake.mp3"
    assert captured["path_or_hf_repo"] == "mlx-community/whisper-large-v3-mlx"
    assert captured["temperature"] == (0.0, 0.2, 0.4)
    assert captured["condition_on_previous_text"] is False
    assert captured["initial_prompt"] == "Song: Test; Artist: Tester."
    assert captured["word_timestamps"] is True

    # Output mapped into the standard SegmentInfo shape.
    assert len(segments) == 1
    assert segments[0].text == "Hello world"
    assert [w.word for w in segments[0].words] == ["Hello", "world"]
    assert segments[0].words[0].start == 1.0


def test_default_engine_does_not_import_mlx(tmp_path, monkeypatch):
    """engine=whisperx must never touch mlx_whisper (absent on x86 prod)."""
    boom = MagicMock(side_effect=AssertionError("mlx_whisper must not be imported"))
    monkeypatch.setitem(sys.modules, "mlx_whisper", None)  # import would raise

    fake_whisperx = types.ModuleType("whisperx")
    model = MagicMock()
    model.transcribe.return_value = {"language": "en", "segments": []}
    model.options = MagicMock()
    fake_whisperx.load_model = MagicMock(return_value=model)
    fake_whisperx.load_audio = boom
    monkeypatch.setitem(sys.modules, "whisperx", fake_whisperx)
    monkeypatch.setattr(transcriber, "_transcription_model", None)

    cfg = WhisperConfig(model_name="tiny", language="en", enable_alignment=False)
    segments = transcriber.transcribe("fake.mp3", str(tmp_path), whisper_config=cfg)
    assert segments == []
    assert model.transcribe.called
