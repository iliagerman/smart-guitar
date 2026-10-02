"""Processing jobs line the community sheet up with the recognized chords."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from guitar_player.services.job_service import external_data, stem_processing


@pytest.mark.asyncio
async def test_alignment_runs_after_the_sheet_fetch_finishes(monkeypatch):
    order: list[str] = []

    async def fetch():
        await asyncio.sleep(0.01)
        order.append("fetched")

    async def align(storage, song_name):
        order.append(f"aligned {song_name}")

    monkeypatch.setattr(external_data, "align_song_chords", align)
    await stem_processing._align_sheet_after(asyncio.create_task(fetch()), MagicMock(), "a/b")

    assert order == ["fetched", "aligned a/b"]


@pytest.mark.asyncio
async def test_alignment_is_skipped_without_recognized_chord_probabilities(monkeypatch):
    storage = MagicMock()
    storage.file_exists.side_effect = lambda key: key.endswith("static_chords.json")
    service = MagicMock(return_value=MagicMock(align_chords=AsyncMock()))
    monkeypatch.setattr("guitar_player.services.processing_service.ProcessingService", service)

    assert await external_data.align_song_chords(storage, "a/b") is None
    service.assert_not_called()
