"""Song detail cleans detected chords: no one-beat flashes, no lone wrong chords."""

from __future__ import annotations

import pytest

from tests.test_song_detail_beat_grid import CHORD_META, CHORDS, _fetch_detail

# 120 BPM: one beat every 0.5s, a 4/4 bar every 2s.
BEATS = [i * 0.5 for i in range(80)]


def _timeline(*chords: tuple[str, float]) -> list[dict]:
    """Contiguous chords from (name, duration) pairs starting at 0."""
    out, start = [], 0.0
    for name, duration in chords:
        out.append({"start_time": start, "end_time": start + duration, "chord": name})
        start += duration
    return out


def _names(chords) -> list[str]:
    return [c.chord for c in chords]


def _autochord_option(detail):
    return next(o for o in detail.chord_options if o.name == "Detected")


@pytest.mark.asyncio
async def test_one_beat_chord_is_absorbed_into_its_longer_neighbour(settings, storage):
    """A chord lasting a single beat is a detection flash and is merged away."""
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 120.0, "beat_times": BEATS},
        CHORDS: _timeline(("C:maj", 4.0), ("D:min", 0.5), ("A:min", 3.5)),
    })

    assert _names(detail.chords) == ["C:maj", "A:min"]
    assert detail.chords[0].end_time == 4.5
    assert detail.chords[1].start_time == 4.5


@pytest.mark.asyncio
async def test_one_beat_chord_between_the_same_chord_joins_them(settings, storage):
    """C - G(1 beat) - C becomes one continuous C."""
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 120.0, "beat_times": BEATS},
        CHORDS: _timeline(("C:maj", 2.0), ("G:maj", 0.5), ("C:maj", 1.5), ("F:maj", 2.0)),
    })

    assert _names(detail.chords) == ["C:maj", "F:maj"]
    assert detail.chords[0].end_time == 4.0


@pytest.mark.asyncio
async def test_half_bar_chord_is_kept(settings, storage):
    """A two-beat chord is a real change and stays."""
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 120.0, "beat_times": BEATS},
        CHORDS: _timeline(("C:maj", 2.0), ("G:maj", 1.0), ("A:min", 2.0)),
    })

    assert _names(detail.chords) == ["C:maj", "G:maj", "A:min"]


@pytest.mark.asyncio
async def test_lone_out_of_key_chord_in_a_repeating_progression_is_corrected(settings, storage):
    """C G Am F repeats; the single C#m where Am always sits is replaced by Am."""
    progression = [("C:maj", 2.0), ("G:maj", 2.0), ("A:min", 2.0), ("F:maj", 2.0)]
    wrong = [("C:maj", 2.0), ("G:maj", 2.0), ("C#:min", 2.0), ("F:maj", 2.0)]
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 120.0, "beat_times": BEATS},
        CHORDS: _timeline(*progression, *progression, *wrong, *progression),
    })

    assert "C#:min" not in _names(detail.chords)
    assert _names(detail.chords)[8:12] == ["C:maj", "G:maj", "A:min", "F:maj"]
    assert "C#:min" not in _names(_autochord_option(detail).chords)


@pytest.mark.asyncio
async def test_out_of_key_chord_that_repeats_is_kept(settings, storage):
    """A borrowed chord used in every repetition is part of the song."""
    progression = [("C:maj", 2.0), ("A#:maj", 2.0), ("F:maj", 2.0), ("C:maj", 2.0)]
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 120.0, "beat_times": BEATS},
        CHORDS: _timeline(*progression, *progression, *progression),
    })

    assert _names(detail.chords).count("A#:maj") == 3


@pytest.mark.asyncio
async def test_out_of_key_chord_without_a_matching_repetition_is_kept(settings, storage):
    """With no repeated context to copy from, a rare chord is left alone."""
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 120.0, "beat_times": BEATS},
        CHORDS: _timeline(
            ("C:maj", 2.0), ("G:maj", 2.0), ("A:min", 2.0), ("F:maj", 2.0),
            ("E:maj", 2.0), ("A:min", 2.0), ("F:maj", 2.0), ("G:maj", 2.0),
        ),
    })

    assert "E:maj" in _names(detail.chords)


@pytest.mark.asyncio
async def test_silence_around_a_chord_is_not_evidence_for_replacing_it(settings, storage):
    """No-chord gaps surround many different chords, so they never justify a swap."""
    phrase = [("N", 2.0), ("C:maj", 2.0), ("N", 2.0), ("G:maj", 2.0)]
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 120.0, "beat_times": BEATS},
        CHORDS: _timeline(*phrase, *phrase, ("N", 2.0), ("C#:maj", 2.0), ("N", 2.0), ("A:min", 2.0)),
    })

    assert "C#:maj" in _names(detail.chords)


@pytest.mark.asyncio
async def test_chords_from_a_sheet_keep_their_one_beat_passing_chords(settings, storage):
    """Sheet chords (chord_source "sheet") are what the song plays: no flash cleanup."""
    detail = await _fetch_detail(settings, storage, {
        CHORD_META: {"bpm": 120.0, "beat_times": BEATS, "chord_source": "sheet"},
        CHORDS: _timeline(("Am", 2.0), ("Am/B", 0.5), ("Am/C", 0.5), ("Am/D", 0.5), ("Am", 2.5)),
    })

    assert _names(detail.chords) == ["Am", "Am/B", "Am/C", "Am/D", "Am"]
