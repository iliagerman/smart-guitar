"""End-to-end tests for the tabs_generator API."""

import os
from pathlib import Path

import pytest

from tests.conftest import TEST_BUCKET_DIR


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "tabs_generator-api"


@pytest.mark.asyncio
async def test_transcribe_tabs(client, test_guitar_key):
    output_tabs = str(
        (Path(TEST_BUCKET_DIR) / Path(test_guitar_key).parent / "tabs.json").resolve()
    )

    # Clean up any previous test output
    if os.path.exists(output_tabs):
        os.remove(output_tabs)

    try:
        resp = await client.post("/transcribe-tabs", json={"input_path": test_guitar_key})
        assert resp.status_code == 200

        data = resp.json()
        assert data["status"] == "done"
        assert data["input_path"] == test_guitar_key

        # Tuning should be standard guitar
        assert data["tuning"] == ["E2", "A2", "D3", "G3", "B3", "E4"]

        # Notes should be non-empty for a real guitar track
        notes = data["notes"]
        assert len(notes) > 0

        # Each note must have the required structure
        for note in notes:
            assert "start_time" in note
            assert "end_time" in note
            assert "string" in note
            assert "fret" in note
            assert "midi_pitch" in note
            assert "confidence" in note

        # tabs.json should have been written alongside the input file
        assert os.path.isfile(output_tabs), "tabs.json was not created"

        # Original guitar file must still exist (not deleted)
        assert os.path.isfile(
            str((Path(TEST_BUCKET_DIR) / test_guitar_key).resolve())
        ), "Test guitar file was deleted!"

    finally:
        # Only clean up the generated output, never the source file
        if os.path.exists(output_tabs):
            os.remove(output_tabs)


@pytest.mark.asyncio
async def test_transcribe_tabs_not_found(client):
    resp = await client.post(
        "/transcribe-tabs", json={"input_path": "/nonexistent/file.mp3"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_transcribe_tabs_empty_path(client):
    resp = await client.post("/transcribe-tabs", json={"input_path": ""})
    assert resp.status_code == 422
