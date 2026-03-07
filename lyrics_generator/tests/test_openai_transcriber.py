"""Unit tests for OpenAI transcription module.

Tests _parse_transcription_response, write_lyrics_json, and transcribe_openai
with mocked OpenAI client.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from lyrics_generator.openai_transcriber import (
    _build_prompt,
    _parse_transcription_response,
    transcribe_openai,
    write_lyrics_json,
)
from lyrics_generator.schemas import SegmentInfo, WordInfo


# -- Fixtures: realistic OpenAI API response shapes --------------------------


def _openai_response_top_level_words() -> dict:
    """OpenAI verbose_json response with words at the top level (standard format)."""
    return {
        "text": "On a dark desert highway, cool wind in my hair,",
        "segments": [
            {
                "id": 0,
                "start": 54.22,
                "end": 56.50,
                "text": "On a dark desert highway,",
            },
            {
                "id": 1,
                "start": 56.50,
                "end": 59.76,
                "text": "cool wind in my hair,",
            },
        ],
        "words": [
            {"word": "On", "start": 54.22, "end": 54.50},
            {"word": "a", "start": 54.50, "end": 54.70},
            {"word": "dark", "start": 54.70, "end": 55.10},
            {"word": "desert", "start": 55.10, "end": 55.60},
            {"word": "highway,", "start": 55.60, "end": 56.50},
            {"word": "cool", "start": 56.50, "end": 56.90},
            {"word": "wind", "start": 56.90, "end": 57.30},
            {"word": "in", "start": 57.30, "end": 57.50},
            {"word": "my", "start": 57.50, "end": 57.80},
            {"word": "hair,", "start": 57.80, "end": 59.76},
        ],
    }


def _openai_response_nested_words() -> dict:
    """Hypothetical response where words are nested inside segments (fallback)."""
    return {
        "text": "Hello world",
        "segments": [
            {
                "start": 0.0,
                "end": 2.0,
                "text": "Hello world",
                "words": [
                    {"word": "Hello", "start": 0.0, "end": 1.0},
                    {"word": "world", "start": 1.0, "end": 2.0},
                ],
            },
        ],
    }


def _openai_response_no_words() -> dict:
    """Response with no word timestamps at all."""
    return {
        "text": "Some text",
        "segments": [
            {"start": 0.0, "end": 3.0, "text": "Some text"},
        ],
    }


# -- Tests: _parse_transcription_response ------------------------------------


class TestParseTranscriptionResponse:
    def test_top_level_words_assigned_to_segments(self):
        data = _openai_response_top_level_words()
        segments = _parse_transcription_response(data)

        assert len(segments) == 2

        seg0 = segments[0]
        assert seg0.text == "On a dark desert highway,"
        assert len(seg0.words) == 5
        assert [w.word for w in seg0.words] == ["On", "a", "dark", "desert", "highway,"]
        assert seg0.words[0].start == 54.22
        assert seg0.words[0].end == 54.50

        seg1 = segments[1]
        assert seg1.text == "cool wind in my hair,"
        assert len(seg1.words) == 5
        assert [w.word for w in seg1.words] == ["cool", "wind", "in", "my", "hair,"]

    def test_words_have_correct_time_ranges(self):
        data = _openai_response_top_level_words()
        segments = _parse_transcription_response(data)

        for seg in segments:
            for word in seg.words:
                assert word.start >= seg.start, (
                    f"Word '{word.word}' start {word.start} < segment start {seg.start}"
                )
                assert word.start < seg.end, (
                    f"Word '{word.word}' start {word.start} >= segment end {seg.end}"
                )

    def test_fallback_to_nested_words(self):
        data = _openai_response_nested_words()
        segments = _parse_transcription_response(data)

        assert len(segments) == 1
        assert len(segments[0].words) == 2
        assert segments[0].words[0].word == "Hello"
        assert segments[0].words[1].word == "world"

    def test_no_words_produces_empty_arrays(self):
        data = _openai_response_no_words()
        segments = _parse_transcription_response(data)

        assert len(segments) == 1
        assert segments[0].words == []

    def test_empty_segments_are_skipped(self):
        data = {
            "segments": [
                {"start": 0.0, "end": 1.0, "text": ""},
                {"start": 1.0, "end": 2.0, "text": "   "},
                {"start": 2.0, "end": 3.0, "text": "Real text"},
            ],
            "words": [
                {"word": "Real", "start": 2.0, "end": 2.5},
                {"word": "text", "start": 2.5, "end": 3.0},
            ],
        }
        segments = _parse_transcription_response(data)
        assert len(segments) == 1
        assert segments[0].text == "Real text"

    def test_empty_word_strings_are_skipped(self):
        data = {
            "segments": [{"start": 0.0, "end": 2.0, "text": "Hello"}],
            "words": [
                {"word": "", "start": 0.0, "end": 0.5},
                {"word": "  ", "start": 0.5, "end": 1.0},
                {"word": "Hello", "start": 1.0, "end": 2.0},
            ],
        }
        segments = _parse_transcription_response(data)
        assert len(segments[0].words) == 1
        assert segments[0].words[0].word == "Hello"

    def test_none_words_and_segments_handled(self):
        """Defensive: data might have None instead of lists."""
        data = {"segments": None, "words": None}
        segments = _parse_transcription_response(data)
        assert segments == []

    def test_top_level_words_take_priority_over_nested(self):
        """When both top-level and nested words exist, top-level wins."""
        data = {
            "segments": [
                {
                    "start": 0.0,
                    "end": 2.0,
                    "text": "Hello world",
                    "words": [
                        {"word": "nested-hello", "start": 0.0, "end": 1.0},
                    ],
                },
            ],
            "words": [
                {"word": "Hello", "start": 0.0, "end": 1.0},
                {"word": "world", "start": 1.0, "end": 2.0},
            ],
        }
        segments = _parse_transcription_response(data)
        assert len(segments[0].words) == 2
        assert segments[0].words[0].word == "Hello"
        assert segments[0].words[1].word == "world"


# -- Tests: _build_prompt ---------------------------------------------------


class TestBuildPrompt:
    def test_title_and_artist(self):
        assert _build_prompt(title="Hotel California", artist="Eagles") == (
            "Song: Hotel California; Artist: Eagles"
        )

    def test_title_only(self):
        assert _build_prompt(title="Hotel California", artist=None) == (
            "Song: Hotel California"
        )

    def test_artist_only(self):
        assert _build_prompt(title=None, artist="Eagles") == "Artist: Eagles"

    def test_empty_returns_none(self):
        assert _build_prompt(title=None, artist=None) is None
        assert _build_prompt(title="", artist="") is None
        assert _build_prompt(title="  ", artist="  ") is None


# -- Tests: write_lyrics_json -----------------------------------------------


class TestWriteLyricsJson:
    def test_round_trip_preserves_words(self, tmp_path: Path):
        segments = [
            SegmentInfo(
                start=54.22,
                end=56.50,
                text="On a dark desert highway,",
                words=[
                    WordInfo(word="On", start=54.22, end=54.50),
                    WordInfo(word="a", start=54.50, end=54.70),
                    WordInfo(word="dark", start=54.70, end=55.10),
                ],
            ),
        ]

        out_path = str(tmp_path / "lyrics.json")
        write_lyrics_json(segments, out_path)

        with open(out_path) as f:
            data = json.load(f)

        assert len(data["segments"]) == 1
        seg = data["segments"][0]
        assert seg["text"] == "On a dark desert highway,"
        assert len(seg["words"]) == 3
        assert seg["words"][0] == {"word": "On", "start": 54.22, "end": 54.5}
        assert seg["words"][1] == {"word": "a", "start": 54.5, "end": 54.7}
        assert seg["words"][2] == {"word": "dark", "start": 54.7, "end": 55.1}


# -- Tests: transcribe_openai (mocked) --------------------------------------


class TestTranscribeOpenAI:
    @pytest.mark.asyncio
    async def test_successful_transcription(self, tmp_path: Path):
        audio_file = tmp_path / "test.mp3"
        audio_file.write_bytes(b"fake audio data")

        mock_response = MagicMock()
        mock_response.model_dump.return_value = _openai_response_top_level_words()

        mock_client = AsyncMock()
        mock_client.audio.transcriptions.create = AsyncMock(return_value=mock_response)

        with patch("openai.AsyncOpenAI", return_value=mock_client):
            segments = await transcribe_openai(
                str(audio_file),
                api_key="test-key",
                model="whisper-1",
                language="en",
                title="Hotel California",
                artist="Eagles",
            )

        assert len(segments) == 2
        assert segments[0].text == "On a dark desert highway,"
        assert segments[1].text == "cool wind in my hair,"

        # Verify the API was called with correct params
        call_kwargs = mock_client.audio.transcriptions.create.call_args
        assert call_kwargs.kwargs["model"] == "whisper-1"
        assert call_kwargs.kwargs["language"] == "en"
        assert call_kwargs.kwargs["response_format"] == "verbose_json"
        assert call_kwargs.kwargs["prompt"] == "Song: Hotel California; Artist: Eagles"

    @pytest.mark.asyncio
    async def test_no_language_passes_none(self, tmp_path: Path):
        audio_file = tmp_path / "test.mp3"
        audio_file.write_bytes(b"fake audio data")

        mock_response = MagicMock()
        mock_response.model_dump.return_value = _openai_response_no_words()

        mock_client = AsyncMock()
        mock_client.audio.transcriptions.create = AsyncMock(return_value=mock_response)

        with patch("openai.AsyncOpenAI", return_value=mock_client):
            segments = await transcribe_openai(
                str(audio_file),
                api_key="test-key",
                language=None,
            )

        call_kwargs = mock_client.audio.transcriptions.create.call_args
        assert call_kwargs.kwargs["language"] is None

    @pytest.mark.asyncio
    async def test_file_not_found_raises(self):
        with pytest.raises(FileNotFoundError):
            await transcribe_openai(
                "/nonexistent/audio.mp3",
                api_key="test-key",
            )

    @pytest.mark.asyncio
    async def test_api_error_propagates(self, tmp_path: Path):
        audio_file = tmp_path / "test.mp3"
        audio_file.write_bytes(b"fake audio data")

        mock_client = AsyncMock()
        mock_client.audio.transcriptions.create = AsyncMock(
            side_effect=RuntimeError("API quota exceeded")
        )

        with patch("openai.AsyncOpenAI", return_value=mock_client):
            with pytest.raises(RuntimeError, match="API quota exceeded"):
                await transcribe_openai(
                    str(audio_file),
                    api_key="test-key",
                )
