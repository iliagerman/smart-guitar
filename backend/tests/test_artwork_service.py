"""Integration test: ArtworkService — MusicBrainz + Cover Art Archive.

Requires network access (musicbrainz.org, coverartarchive.org).
"""

import os
import shutil
import tempfile

import pytest

from guitar_player.services.artwork_service import ArtworkService


@pytest.mark.asyncio
@pytest.mark.timeout(60)
async def test_fetch_artwork_eagles_hotel_california():
    """Fetch official artwork for a well-known song."""
    service = ArtworkService()
    tmp_dir = tempfile.mkdtemp(prefix="test_artwork_")

    try:
        # Use snake_case names as the LLM parser would produce
        path = await service.fetch_artwork("eagles", "hotel_california", tmp_dir)

        assert path is not None, "Expected artwork to be found for Eagles - Hotel California"
        assert os.path.isfile(path), f"Artwork file not found at {path}"
        size = os.path.getsize(path)
        assert size > 5000, f"Artwork file too small ({size} bytes), likely not a real image"

        print(f"\n  Downloaded artwork: {path} ({size / 1024:.1f} KB)", flush=True)

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@pytest.mark.asyncio
@pytest.mark.timeout(60)
async def test_fetch_artwork_bob_dylan_knockin_on_heavens_door():
    """Fetch official artwork for Bob Dylan — Knockin' on Heaven's Door."""
    service = ArtworkService()
    tmp_dir = tempfile.mkdtemp(prefix="test_artwork_")

    try:
        path = await service.fetch_artwork(
            "bob_dylan", "knockin_on_heavens_door", tmp_dir
        )

        assert path is not None, "Expected artwork for Bob Dylan - Knockin' on Heaven's Door"
        assert os.path.isfile(path), f"Artwork file not found at {path}"
        size = os.path.getsize(path)
        assert size > 5000, f"Artwork file too small ({size} bytes)"

        print(f"\n  Downloaded artwork: {path} ({size / 1024:.1f} KB)", flush=True)

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@pytest.mark.asyncio
@pytest.mark.timeout(15)
async def test_fetch_artwork_returns_none_for_nonsense():
    """Verify graceful fallback when no artwork is found."""
    service = ArtworkService()
    tmp_dir = tempfile.mkdtemp(prefix="test_artwork_")

    try:
        path = await service.fetch_artwork(
            "zzznonexistent_artist_12345", "zzznonexistent_song_67890", tmp_dir
        )
        assert path is None, "Expected None for a nonsense query"

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@pytest.mark.asyncio
@pytest.mark.timeout(15)
async def test_search_release_mbids_returns_results():
    """Verify MusicBrainz search returns release MBIDs."""
    service = ArtworkService()
    mbids = await service._search_release_mbids("eagles", "hotel_california")

    assert len(mbids) > 0, "Expected at least one release MBID for Eagles - Hotel California"
    # MBIDs are UUID format: 8-4-4-4-12 hex chars
    assert len(mbids[0]) == 36, f"MBID has unexpected length: {mbids[0]}"
    print(f"\n  Found {len(mbids)} release MBIDs, first: {mbids[0]}", flush=True)
