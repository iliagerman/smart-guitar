"""Tests for lyrics text correction (merging quick lyrics text with Whisper timestamps)."""

import json
from unittest.mock import MagicMock, patch

import pytest

from lyrics_generator.schemas import SegmentInfo, WordInfo
from lyrics_generator.text_corrector import correct_lyrics, correct_lyrics_llm


def _seg(start: float, end: float, text: str, words: list[tuple] | None = None) -> SegmentInfo:
    """Helper to build a SegmentInfo."""
    if words is None:
        words_list = [
            WordInfo(word=w, start=start + i * 0.5, end=start + (i + 1) * 0.5)
            for i, w in enumerate(text.split())
        ]
    else:
        words_list = [WordInfo(word=w, start=s, end=e) for w, s, e in words]
    return SegmentInfo(start=start, end=end, text=text, words=words_list)


def _mock_settings():
    """Create a mock settings object with AWS config."""
    settings = MagicMock()
    settings.aws.region = "us-east-1"
    settings.aws.use_iam_role = True
    settings.aws.access_key = None
    settings.aws.secret_key = None
    return settings


class TestCorrectLyricsFallback:
    """Test the sync fallback (simple segment-level timing transfer)."""

    def test_matching_overlap_transfers_segment_timing(self):
        whisper = [
            _seg(10.0, 15.0, "wrong text here", [
                ("wrong", 10.0, 11.0),
                ("text", 11.5, 12.5),
                ("here", 13.0, 15.0),
            ]),
        ]
        quick = [
            _seg(10.2, 14.8, "correct words now"),
        ]
        result = correct_lyrics(whisper, quick, audio=None)
        assert len(result) == 1
        assert result[0].text == "correct words now"
        # Segment timing comes from Whisper
        assert result[0].start == 10.0
        assert result[0].end == 15.0

    def test_empty_quick_returns_whisper(self):
        whisper = [_seg(10.0, 15.0, "text")]
        result = correct_lyrics(whisper, [], audio=None)
        assert result == whisper

    def test_no_whisper_overlap_keeps_quick_timing(self):
        whisper = [
            _seg(10.0, 15.0, "something", [("something", 10.0, 15.0)]),
        ]
        quick = [
            _seg(10.2, 14.8, "correct text"),
            _seg(50.0, 55.0, "chorus part"),  # No Whisper overlap
        ]
        result = correct_lyrics(whisper, quick, audio=None)
        assert len(result) == 2
        assert result[1].text == "chorus part"
        assert result[1].start == 50.0

    def test_preserves_quick_text_structure(self):
        whisper = [
            _seg(10.0, 20.0, "one big segment", [
                ("one", 10.0, 12.0),
                ("big", 13.0, 15.0),
                ("segment", 16.0, 20.0),
            ]),
        ]
        quick = [
            _seg(10.2, 14.8, "first line"),
            _seg(15.0, 19.8, "second line"),
        ]
        result = correct_lyrics(whisper, quick, audio=None)
        assert len(result) == 2
        assert result[0].text == "first line"
        assert result[1].text == "second line"


class TestCorrectLyricsLLM:
    """Test the async LLM-based correction (Bedrock)."""

    @pytest.mark.asyncio
    async def test_llm_correction_parses_response(self):
        """Bedrock response is correctly parsed into SegmentInfo."""
        whisper = [_seg(10.0, 15.0, "garbled", [("garbled", 10.0, 15.0)])]
        quick = [_seg(10.2, 14.8, "correct text")]

        llm_response = json.dumps({
            "segments": [{
                "start": 10.0,
                "end": 14.8,
                "text": "correct text",
                "words": [
                    {"word": "correct", "start": 10.0, "end": 12.0},
                    {"word": "text", "start": 12.5, "end": 14.8},
                ],
            }]
        })

        mock_client = MagicMock()
        mock_client.converse.return_value = {
            "output": {"message": {"content": [{"text": llm_response}]}}
        }

        with patch("lyrics_generator.text_corrector._create_bedrock_client", return_value=mock_client):
            result = await correct_lyrics_llm(whisper, quick, settings=_mock_settings())

        assert len(result) == 1
        assert result[0].text == "correct text"
        assert result[0].words[0].word == "correct"
        assert result[0].words[0].start == 10.0
        assert result[0].words[1].word == "text"
        assert result[0].words[1].start == 12.5

    @pytest.mark.asyncio
    async def test_llm_fallback_on_error(self):
        """On Bedrock error, returns quick segments as-is."""
        whisper = [_seg(10.0, 15.0, "garbled")]
        quick = [_seg(10.2, 14.8, "correct text")]

        with patch("lyrics_generator.text_corrector._create_bedrock_client", side_effect=Exception("Bedrock error")):
            result = await correct_lyrics_llm(whisper, quick, settings=_mock_settings())

        assert len(result) == 1
        assert result[0].text == "correct text"

    @pytest.mark.asyncio
    async def test_llm_empty_quick_returns_whisper(self):
        whisper = [_seg(10.0, 15.0, "text")]
        result = await correct_lyrics_llm(whisper, [], settings=_mock_settings())
        assert result == whisper
