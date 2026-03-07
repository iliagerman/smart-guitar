"""End-to-end tests for the chords_generator API."""

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
    assert data["service"] == "chords_generator-api"


@pytest.mark.asyncio
async def test_recognize(client, test_song_path):
    song_dir = Path(test_song_path).parent

    # All output files that chord recognition produces
    output_files = [
        song_dir / "chords.json",
        song_dir / "chords.lab",
        song_dir / "chords_intermediate.json",
        song_dir / "chords_beginner.json",
    ]
    capo_files = [song_dir / f"chords_beginner_capo_{n}.json" for n in range(1, 8)]
    all_output_files = output_files + capo_files

    # Clean up any previous test output
    for f in all_output_files:
        if f.exists():
            f.unlink()

    try:
        resp = await client.post("/recognize", json={"input_path": test_song_path})
        assert resp.status_code == 200

        data = resp.json()
        assert data["status"] == "done"
        assert data["input_path"] == test_song_path

        # Chords should be non-empty for a real song
        chords = data["chords"]
        assert len(chords) > 0

        # Each chord must have the required structure
        for chord in chords:
            assert "start_time" in chord
            assert "end_time" in chord
            assert "chord" in chord
            assert isinstance(chord["start_time"], (int, float))
            assert isinstance(chord["end_time"], (int, float))
            assert chord["end_time"] >= chord["start_time"]

        # output_path should point to the song directory
        assert "output_path" in data
        assert os.path.isdir(data["output_path"])

        # chords.json and chords.lab should have been written
        assert (song_dir / "chords.json").is_file(), "chords.json was not created"
        assert (song_dir / "chords.lab").is_file(), "chords.lab was not created"

        # Simplified chord option files should exist
        assert (song_dir / "chords_intermediate.json").is_file(), (
            "chords_intermediate.json was not created"
        )
        assert (song_dir / "chords_beginner.json").is_file(), (
            "chords_beginner.json was not created"
        )

        # At least one capo file should have been created (top 2 capo positions)
        capo_found = [f for f in capo_files if f.exists()]
        assert len(capo_found) >= 1, "No capo variation files were created"

        # Original song file must still exist (not deleted)
        assert os.path.isfile(test_song_path), "Test song file was deleted!"

    finally:
        # Only clean up generated outputs, never the source song
        for f in all_output_files:
            if f.exists():
                f.unlink()


@pytest.mark.asyncio
async def test_recognize_not_found(client):
    resp = await client.post(
        "/recognize", json={"input_path": "/nonexistent/file.mp3"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_recognize_empty_path(client):
    resp = await client.post("/recognize", json={"input_path": ""})
    assert resp.status_code in (404, 422)
