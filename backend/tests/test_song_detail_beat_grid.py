"""Song detail beat grid: detected beats, tempo, and meter-aware bar starts."""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from guitar_player.app_state import set_storage
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db
from guitar_player.schemas.song import SongDetailResponse
from guitar_player.services.song_service import SongService

CHORD_META = "chord_meta.json"
CHORDS = "chords.json"
SONGSTERR = "songsterr.json"
TABS = "tabs.json"

# Song fields that point at the fixture file of the same name.
_KEY_FIELDS = {CHORDS: "chords_key", SONGSTERR: "external_strums_key", TABS: "tabs_key"}


def _chord_changes(*starts: float) -> list[dict]:
    ends = [*starts[1:], starts[-1] + 2.0]
    return [
        {"start_time": start, "end_time": end, "chord": name}
        for start, end, name in zip(starts, ends, ["C:maj", "G:maj", "A:min", "F:maj"] * 4)
    ]


async def _fetch_detail(settings, storage, files: dict[str, object]) -> SongDetailResponse:
    """Write fixture files under a fresh song folder and return its detail."""
    factory = init_db(settings)
    set_storage(storage)
    song_name = f"test_beat_grid_{uuid.uuid4().hex[:8]}/test_song"
    base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
    song_dir = base / song_name
    song_dir.mkdir(parents=True)
    for file_name, data in files.items():
        (song_dir / file_name).write_text(json.dumps(data))
    keys = {_KEY_FIELDS[name]: f"{song_name}/{name}" for name in files if name in _KEY_FIELDS}

    try:
        async with factory() as session:
            song_dao = SongDAO(session)
            song = await song_dao.create(
                title="Beat Grid Song", artist="Test Artist", song_name=song_name,
                audio_key=f"{song_name}/audio.mp3", **keys,
            )
            await song_dao.commit()
        async with factory() as session:
            service = SongService(session, storage, MagicMock(), MagicMock(), MagicMock())
            return await service.get_song_detail(song.id)
    finally:
        async with factory() as session:
            await SongDAO(session).delete_by_id(song.id)
            await session.commit()
        shutil.rmtree(song_dir.parent, ignore_errors=True)
        await close_db()


@pytest.mark.asyncio
async def test_bars_follow_the_songs_three_four_time_signature(settings, storage):
    """A 3/4 song gets 3-beat bars whose downbeats land on the chord changes."""
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 120.0, "beat_times": [i * 0.5 for i in range(24)], "bar_starts": [0.0, 2.0, 4.0]},
        CHORDS: _chord_changes(0.5, 2.0, 3.5, 5.0, 6.5),
        SONGSTERR: {"source_bpm": 120, "time_signature": [3, 4]},
    })

    assert detail.bar_starts[:4] == [0.5, 2.0, 3.5, 5.0]
    assert detail.beat_times[:3] == [0.5, 1.0, 1.5]
    assert detail.detected_bpm == 120.0


@pytest.mark.asyncio
async def test_doubled_detected_tempo_is_halved_to_the_tab_tempo(settings, storage):
    """Beat tracking at 240 BPM for a song tabbed at 120 keeps every other beat."""
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 240.0, "beat_times": [i * 0.25 for i in range(48)]},
        CHORDS: _chord_changes(1.0, 3.0, 5.0, 7.0),
        SONGSTERR: {"source_bpm": 120, "time_signature": [4, 4]},
    })

    assert detail.detected_bpm == 120.0
    assert detail.beat_times[:3] == [1.0, 1.5, 2.0]
    assert detail.bar_starts[:3] == [1.0, 3.0, 5.0]


@pytest.mark.asyncio
async def test_fast_detected_tempo_without_a_tab_is_counted_in_half_time(settings, storage):
    """A 74 BPM ballad tracked at 148 BPM, with no tab tempo, gets a 74 BPM grid on its bars."""
    beat = 60 / 148
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 148.0, "beat_times": [0.3 + i * beat for i in range(64)]},
        # Chords change every 8 tracked beats, starting on the second one.
        CHORDS: _chord_changes(*(0.3 + (1 + 8 * i) * beat for i in range(6))),
    })

    assert detail.detected_bpm == pytest.approx(74.0, abs=0.1)
    assert detail.beat_times[0] == pytest.approx(0.3 + beat, abs=0.001)
    assert detail.bar_starts[1] - detail.bar_starts[0] == pytest.approx(8 * beat, abs=0.002)


@pytest.mark.asyncio
async def test_half_time_grid_keeps_a_fast_songs_quick_chord_changes(settings, storage):
    """Chords held two tracked beats at 160 BPM are real changes, not flashes to clean away."""
    beat = 60 / 160
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 160.0, "beat_times": [i * beat for i in range(40)]},
        CHORDS: _chord_changes(*(i * 2 * beat for i in range(8))),
    })

    assert detail.detected_bpm == pytest.approx(80.0, abs=0.1)
    assert len([c for c in detail.chords if c.chord != "N"]) == 8


@pytest.mark.asyncio
async def test_moderate_detected_tempo_without_a_tab_is_kept(settings, storage):
    """116 BPM with no tab tempo is left alone."""
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 116.0, "beat_times": [i * 60 / 116 for i in range(32)]},
        CHORDS: _chord_changes(0.0, 2.07, 4.14),
    })

    assert detail.detected_bpm == pytest.approx(116.0, abs=0.1)


@pytest.mark.asyncio
async def test_halved_detected_tempo_gets_half_beats(settings, storage):
    """Beat tracking at 60 BPM for a song tabbed at 120 adds the missing beats."""
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 60.0, "beat_times": [float(i) for i in range(12)]},
        CHORDS: _chord_changes(0.0, 2.0, 4.0),
        SONGSTERR: {"source_bpm": 120, "time_signature": [4, 4]},
    })

    assert detail.detected_bpm == 120.0
    assert detail.beat_times[:3] == [0.0, 0.5, 1.0]
    assert detail.bar_starts[:3] == [0.0, 2.0, 4.0]


@pytest.mark.asyncio
async def test_older_songs_split_their_stored_bars_into_beats(settings, storage):
    """Songs processed before beats were stored rebuild beats from 4/4 bar starts."""
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 120.0, "bar_starts": [1.0, 3.0, 5.0, 7.0]},
        CHORDS: _chord_changes(1.0, 3.0),
    })

    assert detail.beat_times == [1.0 + i * 0.5 for i in range(13)]
    assert detail.bar_starts == [1.0, 3.0, 5.0, 7.0]
    assert detail.detected_bpm == 120.0


@pytest.mark.asyncio
async def test_guitar_stem_beats_are_used_without_chord_beats(settings, storage):
    """Without chord-pipeline beats, the guitar-stem beats from tabs.json form the grid."""
    guitar_beats = [0.5 + i * 0.5 for i in range(9)]
    detail = await _fetch_detail(settings, storage, {
        TABS: {"notes": [], "strums": [], "rhythm": {"bpm": 118.0, "beat_times": guitar_beats}},
    })

    assert detail.beat_times == guitar_beats
    assert detail.bar_starts == [0.5, 2.5, 4.5]
    assert detail.detected_bpm == 120.0


@pytest.mark.asyncio
async def test_no_detected_beats_means_no_grid(settings, storage):
    """A tempo guess without detected beats is not reported as the detected tempo."""
    detail = await _fetch_detail(settings, storage, {CHORD_META: {"bpm": 97, "capo": 2}})

    assert detail.beat_times == []
    assert detail.bar_starts == []
    assert detail.detected_bpm is None
    assert detail.recommended_capo == 2
