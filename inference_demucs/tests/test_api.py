"""End-to-end tests for the inference_demucs API.

WARNING: test_separate runs actual Demucs model separation, which requires
a GPU or takes several minutes on CPU. Use pytest -k to skip it in fast
CI runs: pytest -k "not test_separate"
"""

import os
from pathlib import Path

import pytest

from tests.conftest import TEST_BUCKET_DIR

# The 6 raw stems that Demucs htdemucs_6s always produces
RAW_STEMS = {"vocals.mp3", "drums.mp3", "bass.mp3", "guitar.mp3", "piano.mp3", "other.mp3"}

# Derived outputs that the API can produce on request
DERIVED_OUTPUTS = {"guitar_removed.mp3", "vocals_removed.mp3"}

ALL_OUTPUTS = RAW_STEMS | DERIVED_OUTPUTS


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "model" in data
    assert data["model"] == "htdemucs_6s"


@pytest.mark.asyncio
async def test_separate(client, test_song_path):
    """Happy-path test: separate a full mix into stems.

    Uses requested_outputs=["guitar_isolated", "vocals_isolated"] to limit
    derived outputs. The 6 raw stems are always produced regardless.
    """
    song_dir = Path(test_song_path).parent

    # Identify output files to clean up in the song directory
    output_files_in_song_dir = [song_dir / f for f in ALL_OUTPUTS]

    # inference_demucs also stores outputs via base_path/output_name/
    # output_name = "the_white_buffalo/the_house_of_the_rising_sun"
    output_under_base = TEST_BUCKET_DIR / "the_white_buffalo" / "the_house_of_the_rising_sun"

    # Clean up any previous test output
    for f in output_files_in_song_dir:
        if f.exists():
            f.unlink()
    if output_under_base.exists():
        for f in output_under_base.iterdir():
            if f.name in ALL_OUTPUTS:
                f.unlink()

    try:
        resp = await client.post(
            "/separate",
            json={
                "input_path": test_song_path,
                "requested_outputs": ["guitar_isolated", "vocals_isolated"],
            },
            timeout=600,
        )
        assert resp.status_code == 200

        data = resp.json()
        assert data["status"] == "done"
        assert data["input_path"] == test_song_path

        # Stems should be non-empty
        stems = data["stems"]
        assert len(stems) > 0

        # Each stem must have the required structure
        stem_names = set()
        for stem in stems:
            assert "name" in stem
            assert "path" in stem
            stem_names.add(stem["name"])

        # Should include the 6 raw stems
        for expected in ["vocals", "drums", "bass", "guitar", "piano", "other"]:
            assert expected in stem_names, f"Missing raw stem: {expected}"

        # output_path should be returned
        assert "output_path" in data

        # Raw stem files should exist in the output directory
        output_path = Path(data["output_path"])
        for stem_file in RAW_STEMS:
            assert (output_path / stem_file).is_file(), (
                f"{stem_file} was not created in {output_path}"
            )

        # Original song file must still exist (not deleted)
        assert os.path.isfile(test_song_path), "Test song file was deleted!"

    finally:
        # Clean up generated outputs, never the source song
        for f in output_files_in_song_dir:
            if f.exists():
                f.unlink()
        if output_under_base.exists():
            for f in output_under_base.iterdir():
                if f.name in ALL_OUTPUTS:
                    f.unlink()


@pytest.mark.asyncio
async def test_separate_not_found(client):
    resp = await client.post(
        "/separate", json={"input_path": "/nonexistent/file.mp3"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_separate_empty_path(client):
    resp = await client.post("/separate", json={"input_path": ""})
    assert resp.status_code in (404, 422)
