"""Tests for the /fetch-and-align endpoint."""

import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from lyrics_generator.lyrics_fetcher import LyricsResult
from tests.conftest import TEST_BUCKET_DIR


SYNCED_LRC = """\
[00:12.00] She's got a smile it seems to me
[00:17.50] Reminds me of childhood memories
[00:23.00] Where everything was as fresh
"""


def _make_lyrics_result(*, synced: str | None = None, plain: str | None = None) -> LyricsResult:
    return LyricsResult(
        track_name="Sweet Child O' Mine",
        artist_name="Guns N' Roses",
        duration=356.0,
        synced_lyrics=synced,
        plain_lyrics=plain,
    )


@pytest.mark.asyncio
async def test_fetch_and_align_synced_uses_whisperx(client, test_vocals_key):
    """When LRCLIB returns synced lyrics, they are used as WhisperX prompt (not parsed directly)."""
    output_lyrics = str(
        (Path(TEST_BUCKET_DIR) / Path(test_vocals_key).parent / "lyrics.json").resolve()
    )
    if os.path.exists(output_lyrics):
        os.remove(output_lyrics)

    try:
        with patch(
            "lyrics_generator.api.fetch_lyrics",
            new_callable=AsyncMock,
            return_value=_make_lyrics_result(synced=SYNCED_LRC, plain="plain fallback"),
        ):
            resp = await client.post(
                "/fetch-and-align",
                json={
                    "input_path": test_vocals_key,
                    "title": "Sweet Child O' Mine",
                    "artist": "Guns N' Roses",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "done"
        # Synced lyrics used as prompt for WhisperX, not parsed directly
        assert data["source"] == "lrclib_synced+whisper"
        # WhisperX transcribes the actual audio, so segments come from the model
        assert len(data["segments"]) > 0

        # Word timestamps should be present (from WhisperX alignment)
        words = data["segments"][0]["words"]
        assert len(words) > 0
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)


@pytest.mark.asyncio
async def test_fetch_and_align_plain_uses_whisper(client, test_vocals_key):
    """When LRCLIB returns only plain lyrics, Whisper is used with lyrics as prompt."""
    output_lyrics = str(
        (Path(TEST_BUCKET_DIR) / Path(test_vocals_key).parent / "lyrics.json").resolve()
    )
    if os.path.exists(output_lyrics):
        os.remove(output_lyrics)

    try:
        with patch(
            "lyrics_generator.api.fetch_lyrics",
            new_callable=AsyncMock,
            return_value=_make_lyrics_result(plain="She's got a smile\nReminds me of childhood"),
        ):
            resp = await client.post(
                "/fetch-and-align",
                json={
                    "input_path": test_vocals_key,
                    "title": "Sweet Child O' Mine",
                    "artist": "Guns N' Roses",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "done"
        assert data["source"] == "lrclib_plain+whisper"
        assert len(data["segments"]) > 0
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)


@pytest.mark.asyncio
async def test_fetch_and_align_no_lyrics_falls_back(client, test_vocals_key):
    """When LRCLIB finds nothing, falls back to Whisper transcription."""
    output_lyrics = str(
        (Path(TEST_BUCKET_DIR) / Path(test_vocals_key).parent / "lyrics.json").resolve()
    )
    if os.path.exists(output_lyrics):
        os.remove(output_lyrics)

    try:
        with patch(
            "lyrics_generator.api.fetch_lyrics",
            new_callable=AsyncMock,
            return_value=None,
        ):
            resp = await client.post(
                "/fetch-and-align",
                json={
                    "input_path": test_vocals_key,
                    "title": "Sweet Child O' Mine",
                    "artist": "Guns N' Roses",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "done"
        assert data["source"] == "whisper"
        assert len(data["segments"]) > 0
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)


@pytest.mark.asyncio
async def test_fetch_and_align_no_lyrics_no_fallback(client, test_vocals_key):
    """When LRCLIB finds nothing and fallback is disabled, returns 404."""
    with patch(
        "lyrics_generator.api.fetch_lyrics",
        new_callable=AsyncMock,
        return_value=None,
    ):
        resp = await client.post(
            "/fetch-and-align",
            json={
                "input_path": test_vocals_key,
                "title": "Sweet Child O' Mine",
                "artist": "Guns N' Roses",
                "fallback_to_transcription": False,
            },
        )

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_fetch_and_align_lrclib_error_falls_back(client, test_vocals_key):
    """When LRCLIB raises an error, falls back to Whisper."""
    output_lyrics = str(
        (Path(TEST_BUCKET_DIR) / Path(test_vocals_key).parent / "lyrics.json").resolve()
    )
    if os.path.exists(output_lyrics):
        os.remove(output_lyrics)

    try:
        with patch(
            "lyrics_generator.api.fetch_lyrics",
            new_callable=AsyncMock,
            side_effect=RuntimeError("Network error"),
        ):
            resp = await client.post(
                "/fetch-and-align",
                json={
                    "input_path": test_vocals_key,
                    "title": "Sweet Child O' Mine",
                    "artist": "Guns N' Roses",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "whisper"
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)


@pytest.mark.asyncio
async def test_fetch_and_align_missing_file(client):
    """Returns 404 when the input audio file doesn't exist."""
    resp = await client.post(
        "/fetch-and-align",
        json={
            "input_path": "/nonexistent/vocals.mp3",
            "title": "Test",
            "artist": "Test",
        },
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_fetch_and_align_with_openai_key_still_fetches_lrclib(client, test_vocals_key):
    """Even when OpenAI key is provided, LRCLIB is fetched first and used if available."""
    output_lyrics = str(
        (Path(TEST_BUCKET_DIR) / Path(test_vocals_key).parent / "lyrics.json").resolve()
    )
    if os.path.exists(output_lyrics):
        os.remove(output_lyrics)

    try:
        with patch(
            "lyrics_generator.api.fetch_lyrics",
            new_callable=AsyncMock,
            return_value=_make_lyrics_result(synced=SYNCED_LRC, plain="plain fallback"),
        ) as mock_fetch:
            resp = await client.post(
                "/fetch-and-align",
                json={
                    "input_path": test_vocals_key,
                    "title": "Sweet Child O' Mine",
                    "artist": "Guns N' Roses",
                    "openai_api_key": "test-key-123",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        # LRCLIB lyrics used as WhisperX prompt, NOT OpenAI
        assert data["source"] == "lrclib_synced+whisper"
        assert len(data["segments"]) > 0
        mock_fetch.assert_called_once()
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)


@pytest.mark.asyncio
async def test_fetch_and_align_openai_fallback_when_whisperx_fails(client, test_vocals_key):
    """When LRCLIB has no lyrics and local WhisperX fails, OpenAI is used as fallback."""
    from lyrics_generator.schemas import SegmentInfo, WordInfo

    mock_segments = [
        SegmentInfo(
            start=0.0,
            end=2.0,
            text="hello world",
            words=[
                WordInfo(word="hello", start=0.0, end=1.0),
                WordInfo(word="world", start=1.0, end=2.0),
            ],
        )
    ]

    output_lyrics = str(
        (Path(TEST_BUCKET_DIR) / Path(test_vocals_key).parent / "lyrics.json").resolve()
    )
    if os.path.exists(output_lyrics):
        os.remove(output_lyrics)

    try:
        with (
            patch(
                "lyrics_generator.api.fetch_lyrics",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "lyrics_generator.api.transcribe",
                side_effect=RuntimeError("WhisperX model failed"),
            ),
            patch(
                "lyrics_generator.api.transcribe_openai",
                new_callable=AsyncMock,
                return_value=mock_segments,
            ) as mock_openai,
        ):
            resp = await client.post(
                "/fetch-and-align",
                json={
                    "input_path": test_vocals_key,
                    "title": "Sweet Child O' Mine",
                    "artist": "Guns N' Roses",
                    "openai_api_key": "test-key-123",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "openai_whisper"
        assert len(data["segments"]) == 1
        mock_openai.assert_called_once()
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)
