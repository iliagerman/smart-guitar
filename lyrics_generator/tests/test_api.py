"""End-to-end tests for the lyrics_generator API."""

import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from tests.conftest import TEST_BUCKET_DIR


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "lyrics_generator-api"
    assert "model" in data


@pytest.mark.asyncio
async def test_transcribe(client, test_vocals_key):
    output_lyrics = str(
        (Path(TEST_BUCKET_DIR) / Path(test_vocals_key).parent / "lyrics.json").resolve()
    )

    # Clean up any previous test output
    if os.path.exists(output_lyrics):
        os.remove(output_lyrics)

    try:
        resp = await client.post("/transcribe", json={"input_path": test_vocals_key})
        assert resp.status_code == 200

        data = resp.json()
        assert data["status"] == "done"
        assert data["input_path"] == test_vocals_key
        assert "source" in data

        # Segments should be non-empty for a real vocal track
        segments = data["segments"]
        assert len(segments) > 0

        # Each segment must have the required structure
        for seg in segments:
            assert "start" in seg
            assert "end" in seg
            assert "text" in seg
            assert "words" in seg
            assert isinstance(seg["words"], list)
            for word in seg["words"]:
                assert "word" in word
                assert "start" in word
                assert "end" in word

        # lyrics.json should have been written alongside the input file
        assert os.path.isfile(output_lyrics), "lyrics.json was not created"

        # Original vocals file must still exist (not deleted)
        assert os.path.isfile(
            str((Path(TEST_BUCKET_DIR) / test_vocals_key).resolve())
        ), "Test vocals file was deleted!"

    finally:
        # Only clean up the generated output, never the source vocals
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)


@pytest.mark.asyncio
async def test_transcribe_not_found(client):
    resp = await client.post(
        "/transcribe", json={"input_path": "/nonexistent/file.mp3"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_transcribe_empty_path(client):
    resp = await client.post("/transcribe", json={"input_path": ""})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_transcribe_whisperx_primary_even_with_openai_key(client, test_vocals_key):
    """Local WhisperX is always primary, even when openai_api_key is provided."""
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
                "lyrics_generator.api.transcribe_openai",
                new_callable=AsyncMock,
            ) as mock_openai,
        ):
            resp = await client.post(
                "/transcribe",
                json={
                    "input_path": test_vocals_key,
                    "openai_api_key": "test-key-123",
                    "openai_model": "whisper-1",
                    "title": "שיר בדיקה",
                    "artist": "אמן בדיקה",
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "done"
            assert len(data["segments"]) > 0

            # OpenAI should NOT be called because local WhisperX succeeded
            mock_openai.assert_not_called()
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)


@pytest.mark.asyncio
async def test_transcribe_english_uses_local_whisper(client, test_vocals_key):
    """Local WhisperX is used for English content."""
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
                "lyrics_generator.api.transcribe_openai",
                new_callable=AsyncMock,
            ) as mock_openai,
        ):
            resp = await client.post(
                "/transcribe",
                json={
                    "input_path": test_vocals_key,
                    "openai_api_key": "test-key-123",
                    "title": "Test Song",
                    "artist": "Test Artist",
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "done"
            assert len(data["segments"]) > 0

            # OpenAI should NOT have been called
            mock_openai.assert_not_called()
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)


@pytest.mark.asyncio
async def test_transcribe_openai_fallback_when_whisperx_fails(client, test_vocals_key):
    """When local WhisperX fails, falls back to OpenAI if key is provided."""
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
                "/transcribe",
                json={
                    "input_path": test_vocals_key,
                    "openai_api_key": "test-key-123",
                    "title": "Test Song",
                    "artist": "Test Artist",
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "done"
            assert data["source"] == "openai_whisper"
            assert len(data["segments"]) == 1

            # Verify OpenAI was called as fallback
            mock_openai.assert_called_once()
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)


@pytest.mark.asyncio
async def test_transcribe_fetches_lyrics_when_metadata_available(client, test_vocals_key):
    """When title+artist are provided, /transcribe fetches LRCLIB and uses lyrics as WhisperX prompt."""
    from lyrics_generator.lyrics_fetcher import LyricsResult

    synced_lrc = """\
[00:12.00] She's got a smile it seems to me
[00:17.50] Reminds me of childhood memories
"""

    output_lyrics = str(
        (Path(TEST_BUCKET_DIR) / Path(test_vocals_key).parent / "lyrics.json").resolve()
    )
    if os.path.exists(output_lyrics):
        os.remove(output_lyrics)

    try:
        with patch(
            "lyrics_generator.api.fetch_lyrics",
            new_callable=AsyncMock,
            return_value=LyricsResult(
                track_name="Sweet Child O' Mine",
                artist_name="Guns N' Roses",
                duration=356.0,
                synced_lyrics=synced_lrc,
                plain_lyrics="plain fallback",
            ),
        ):
            resp = await client.post(
                "/transcribe",
                json={
                    "input_path": test_vocals_key,
                    "title": "Sweet Child O' Mine",
                    "artist": "Guns N' Roses",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        # Synced lyrics used as WhisperX prompt, WhisperX transcribes the audio
        assert data["source"] == "lrclib_synced+whisper"
        assert len(data["segments"]) > 0
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)


@pytest.mark.asyncio
async def test_transcribe_uses_plain_lyrics_as_prompt(client, test_vocals_key):
    """When LRCLIB returns plain lyrics only, they are used as WhisperX prompt."""
    from lyrics_generator.lyrics_fetcher import LyricsResult

    output_lyrics = str(
        (Path(TEST_BUCKET_DIR) / Path(test_vocals_key).parent / "lyrics.json").resolve()
    )
    if os.path.exists(output_lyrics):
        os.remove(output_lyrics)

    try:
        with patch(
            "lyrics_generator.api.fetch_lyrics",
            new_callable=AsyncMock,
            return_value=LyricsResult(
                track_name="Sweet Child O' Mine",
                artist_name="Guns N' Roses",
                duration=356.0,
                synced_lyrics=None,
                plain_lyrics="She's got a smile\nReminds me of childhood",
            ),
        ):
            resp = await client.post(
                "/transcribe",
                json={
                    "input_path": test_vocals_key,
                    "title": "Sweet Child O' Mine",
                    "artist": "Guns N' Roses",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "lrclib_plain+whisper"
        assert len(data["segments"]) > 0
    finally:
        if os.path.exists(output_lyrics):
            os.remove(output_lyrics)
