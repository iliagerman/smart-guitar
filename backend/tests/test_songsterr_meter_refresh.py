"""Refreshing a stored Songsterr file's meter without re-running the strum-pattern lookup."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from guitar_player.services.job_service import external_data


@pytest.mark.asyncio
async def test_refresh_fixes_the_meter_and_keeps_everything_else(monkeypatch, storage):
    """A 3/4 tab stored as 4/4 gets 3/4; sections and tutorials stay; the old file is kept."""
    song_name = f"test_meter_{uuid.uuid4().hex[:8]}/song"
    stored = {"tabs": [], "sections": [{"name": "Verse"}], "tutorial_url": "https://t", "time_signature": [4, 4]}
    storage.write_json(f"{song_name}/songsterr_data.json", stored)

    async def fetch(artist, title, ext_cfg):
        return SimpleNamespace(time_signature=(3, 4), tab_rhythm=None)

    monkeypatch.setattr(external_data, "_fetch_songsterr_result", fetch)

    outcome = await external_data.refresh_songsterr_meter(storage, song_name, "Artist", "Title")

    assert outcome == "changed"
    refreshed = storage.read_json(f"{song_name}/songsterr_data.json")
    assert refreshed["time_signature"] == [3, 4]
    assert refreshed["sections"] == [{"name": "Verse"}]
    assert refreshed["tutorial_url"] == "https://t"
    assert "tab_rhythm" in refreshed
    assert storage.read_json(f"{song_name}/songsterr_data.pre_meter.json") == stored
    storage.delete_prefix(song_name.split("/")[0])


@pytest.mark.asyncio
async def test_refresh_leaves_a_song_without_a_tab(monkeypatch, storage):
    song_name = f"test_meter_{uuid.uuid4().hex[:8]}/song"
    storage.write_json(f"{song_name}/songsterr_data.json", {"time_signature": [4, 4]})

    async def fetch(artist, title, ext_cfg):
        return None

    monkeypatch.setattr(external_data, "_fetch_songsterr_result", fetch)

    assert await external_data.refresh_songsterr_meter(storage, song_name, "Artist", "Title") == "no_tab"
    assert storage.read_json(f"{song_name}/songsterr_data.json") == {"time_signature": [4, 4]}
    storage.delete_prefix(song_name.split("/")[0])
