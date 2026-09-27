"""Song detail returns the strum patterns and beat emphasis saved from the tab."""

from __future__ import annotations

import pytest

from tests.test_song_detail_beat_grid import SONGSTERR, _fetch_detail

TAB_RHYTHM = {
    "beats_per_bar": 4,
    "beat_accents": [0.0, 0.93, 0.0, 0.85],
    "strum_patterns": [{
        "name": "Verse",
        "subdivision": 2,
        "bar_share": 0.8,
        "steps": [
            {"direction": d, "accent": i in (2, 6)}
            for i, d in enumerate(["down", "miss", "down", "up", "miss", "up", "down", "up"])
        ],
    }],
}


@pytest.mark.asyncio
async def test_detail_includes_the_tab_rhythm(settings, storage):
    detail = await _fetch_detail(settings, storage, {
        SONGSTERR: {"source_bpm": 100, "time_signature": [4, 4], "tab_rhythm": TAB_RHYTHM},
    })

    assert detail.tab_rhythm is not None
    assert detail.tab_rhythm.beat_accents == [0.0, 0.93, 0.0, 0.85]
    (pattern,) = detail.tab_rhythm.strum_patterns
    assert pattern.name == "Verse"
    assert [s.direction for s in pattern.steps][:4] == ["down", "miss", "down", "up"]
    assert [i for i, s in enumerate(pattern.steps) if s.accent] == [2, 6]


@pytest.mark.asyncio
async def test_detail_without_tab_rhythm(settings, storage):
    detail = await _fetch_detail(settings, storage, {SONGSTERR: {"source_bpm": 100, "time_signature": [4, 4]}})

    assert detail.tab_rhythm is None
