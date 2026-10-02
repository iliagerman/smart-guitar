"""Strum patterns and beat emphasis read from Songsterr tabs.

Runs the real Songsterr fetch against synthetic tabs served by a mock
transport: a lead track (single notes), a strummed rhythm track, and drums.
"""

from __future__ import annotations

import httpx
import pytest

from guitar_player.services import external_strum_fetcher as fetcher

SNARE, KICK, HIHAT = 38, 36, 42
FULL_CHORD = [{"string": s, "fret": 2} for s in range(6)]
HIGH_STRINGS = [{"string": s, "fret": 0} for s in range(3)]


def _beat(sixteenths: int, notes: list[dict] | None = None) -> dict:
    if notes is None:
        return {"type": 16, "duration": [sixteenths, 16], "rest": True, "notes": [{"rest": True}]}
    return {"type": 16, "duration": [sixteenths, 16], "notes": notes}


def _measure(beats: list[dict], marker: str | None = None, signature: list[int] | None = None) -> dict:
    measure: dict = {"voices": [{"beats": beats}]}
    if marker:
        measure["marker"] = {"text": marker}
    if signature:
        measure["signature"] = signature
    return measure


# 4/4, eighths: D . D U . U D U  (slots in 16ths: 0, 4, 6, 10, 12, 14)
DDU_UDU = [
    _beat(4, FULL_CHORD), _beat(2, FULL_CHORD), _beat(4, HIGH_STRINGS),
    _beat(2, HIGH_STRINGS), _beat(2, FULL_CHORD), _beat(2, HIGH_STRINGS),
]
# 4/4, quarter-note downstrokes: D . D . D . D .
QUARTERS = [_beat(4, FULL_CHORD) for _ in range(4)]
# A tied chord is held, not strummed again: the fourth quarter is not a stroke.
HELD = [_beat(4, FULL_CHORD)] * 3 + [_beat(4, [dict(n, tie=True) for n in FULL_CHORD])]
RIFF = [_beat(2, [{"string": 5, "fret": f}]) for f in (0, 3, 5, 3, 0, 3, 5, 3)]
BACKBEAT = [
    _beat(4, [{"fret": KICK, "string": 0}, {"fret": HIHAT, "string": 1}]),
    _beat(4, [{"fret": SNARE, "string": 0}, {"fret": HIHAT, "string": 1}]),
    _beat(4, [{"fret": KICK, "string": 0}, {"fret": HIHAT, "string": 1}]),
    _beat(4, [{"fret": SNARE, "string": 0}, {"fret": HIHAT, "string": 1}]),
]


def _tab(measures: list[dict]) -> dict:
    return {"automations": {"tempo": [{"measure": 0, "bpm": 100}]}, "strings": 6, "measures": measures}


SONG = {"songId": 7, "artist": "Test Band", "title": "Test Song", "tracks": [
    {"instrument": "Electric Guitar (distortion)", "name": "Lead"},
    {"instrument": "Electric Guitar (clean)", "name": "Rhythm"},
    {"instrument": "Drums", "name": "Drums"},
]}


async def _fetch(monkeypatch, tracks: dict[int, dict]) -> fetcher.SongsterrResult:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/songs":
            return httpx.Response(200, json=[SONG])
        if request.url.path == "/api/meta/7":
            return httpx.Response(200, json={"revisionId": 1, "image": "img"})
        track = int(request.url.path.rsplit("/", 1)[-1].removesuffix(".json"))
        return httpx.Response(200, json=tracks[track]) if track in tracks else httpx.Response(404)

    real_client = httpx.AsyncClient

    def mock_client(*args, **kwargs):
        return real_client(*args, transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(fetcher.httpx, "AsyncClient", mock_client)
    result = await fetcher.fetch_songsterr_data("Test Band", "Test Song")
    assert result is not None
    return result


def _arrows(pattern) -> str:
    return " ".join({"down": "D", "up": "U", "miss": "."}[s.direction] for s in pattern.steps)


@pytest.mark.asyncio
async def test_pattern_comes_from_the_strummed_track_not_the_lead(monkeypatch):
    """The track with strummed chords is read even when the lead track ranks first."""
    result = await _fetch(monkeypatch, {
        0: _tab([_measure(RIFF, "Verse")] * 4),
        1: _tab([_measure(DDU_UDU, "Verse")] * 4),
    })

    rhythm = result.tab_rhythm
    assert rhythm.beats_per_bar == 4
    (pattern,) = rhythm.strum_patterns
    assert pattern.name == "Verse"
    assert pattern.subdivision == 2
    assert _arrows(pattern) == "D . D U . U D U"
    assert pattern.bar_share == 1.0


@pytest.mark.asyncio
async def test_sections_get_their_own_patterns(monkeypatch):
    """Verse 1 and Verse 2 group together; a chorus with a different pattern is listed too."""
    result = await _fetch(monkeypatch, {
        0: _tab(
            [_measure(DDU_UDU, "Verse 1")] + [_measure(DDU_UDU)] * 2
            + [_measure(QUARTERS, "Chorus")] + [_measure(QUARTERS)] * 2
            + [_measure(DDU_UDU, "Verse 2")] + [_measure(QUARTERS)]
        ),
    })

    names = [(p.name, _arrows(p)) for p in result.tab_rhythm.strum_patterns]
    assert names == [("Verse", "D . D U . U D U"), ("Chorus", "D . D . D . D .")]
    assert result.tab_rhythm.strum_patterns[0].bar_share == 0.8


@pytest.mark.asyncio
async def test_sections_with_the_same_pattern_are_merged(monkeypatch):
    result = await _fetch(monkeypatch, {
        0: _tab([_measure(QUARTERS, "Verse"), _measure(QUARTERS), _measure(QUARTERS, "Chorus"), _measure(QUARTERS)]),
    })

    (pattern,) = result.tab_rhythm.strum_patterns
    assert pattern.name == "Verse / Chorus"


@pytest.mark.asyncio
async def test_held_chords_are_not_restrummed(monkeypatch):
    result = await _fetch(monkeypatch, {0: _tab([_measure(HELD, "Intro")] * 3)})

    assert _arrows(result.tab_rhythm.strum_patterns[0]) == "D . D . D . . ."


@pytest.mark.asyncio
async def test_no_pattern_when_bars_rarely_repeat(monkeypatch):
    """A section whose most common bar is under 30% of its bars is not trusted."""
    varied = [
        [_beat(4, FULL_CHORD)] * 4,
        [_beat(8, FULL_CHORD), _beat(4, FULL_CHORD), _beat(4, FULL_CHORD)],
        [_beat(2, FULL_CHORD)] * 8,
        [_beat(4, FULL_CHORD), _beat(4, FULL_CHORD), _beat(8, FULL_CHORD)],
    ]
    result = await _fetch(monkeypatch, {0: _tab([_measure(b, "Verse" if i == 0 else None) for i, b in enumerate(varied)])})

    assert result.tab_rhythm.strum_patterns == []


@pytest.mark.asyncio
async def test_no_pattern_from_single_note_riffs(monkeypatch):
    result = await _fetch(monkeypatch, {0: _tab([_measure(RIFF, "Verse")] * 4)})

    assert result.tab_rhythm.strum_patterns == []


@pytest.mark.asyncio
async def test_snare_beats_become_the_emphasis_and_accent_the_strum(monkeypatch):
    """A snare on 2 and 4 in the drum part accents beats 2 and 4."""
    result = await _fetch(monkeypatch, {
        0: _tab([_measure(QUARTERS, "Verse")] * 4),
        2: _tab([_measure(BACKBEAT)] * 4),
    })

    rhythm = result.tab_rhythm
    assert rhythm.beat_accents == [0.0, 1.0, 0.0, 1.0]
    steps = rhythm.strum_patterns[0].steps
    assert [i for i, s in enumerate(steps) if s.accent] == [2, 6]


@pytest.mark.asyncio
async def test_six_eight_is_strummed_in_eighths(monkeypatch):
    six_eight = [_beat(2, FULL_CHORD), _beat(2, HIGH_STRINGS), _beat(2, FULL_CHORD)] * 2
    result = await _fetch(monkeypatch, {0: _tab([_measure(six_eight, "Verse", [6, 8])] + [_measure(six_eight)] * 3)})

    rhythm = result.tab_rhythm
    assert rhythm.beats_per_bar == 6
    assert rhythm.strum_patterns[0].subdivision == 1
    assert _arrows(rhythm.strum_patterns[0]) == "D U D U D U"


DOUBLE_STOPS = [_beat(2, [{"string": 4, "fret": f}, {"string": 5, "fret": f}]) for f in (0, 3, 5, 3, 0, 3, 5, 3)]
SPARSE = [_beat(14, FULL_CHORD), _beat(2, HIGH_STRINGS)]


@pytest.mark.asyncio
async def test_no_pattern_from_double_stop_riffs(monkeypatch):
    """Two-string riff notes are not strumming unless the bar also strums full chords."""
    result = await _fetch(monkeypatch, {0: _tab([_measure(DOUBLE_STOPS, "Verse")] * 4)})

    assert result.tab_rhythm.strum_patterns == []


@pytest.mark.asyncio
async def test_no_pattern_from_one_or_two_hits_a_bar(monkeypatch):
    """A chord struck once a bar (plus a pickup) is a picked or held part, not a pattern."""
    result = await _fetch(monkeypatch, {0: _tab([_measure(SPARSE, "Chorus")] * 4)})

    assert result.tab_rhythm.strum_patterns == []


@pytest.mark.asyncio
async def test_section_names_are_tidied_and_solos_skipped(monkeypatch):
    result = await _fetch(monkeypatch, {0: _tab(
        [_measure(DDU_UDU, "[A] Verse 1: Drums enter"), _measure(DDU_UDU)]
        + [_measure(QUARTERS, "Guitar Solo (Slash)"), _measure(QUARTERS)]
        + [_measure(QUARTERS, "Chorus (x2)"), _measure(QUARTERS)]
    )})

    assert [p.name for p in result.tab_rhythm.strum_patterns] == ["Verse", "Chorus"]


@pytest.mark.asyncio
async def test_bars_that_rest_on_beat_one_are_riffs_not_strumming(monkeypatch):
    offbeat = [_beat(4), _beat(2, FULL_CHORD), _beat(2, FULL_CHORD), _beat(4, FULL_CHORD), _beat(4, FULL_CHORD)]
    result = await _fetch(monkeypatch, {0: _tab([_measure(offbeat, "Verse")] * 4)})

    assert result.tab_rhythm.strum_patterns == []


def test_a_meter_stated_once_holds_for_the_measures_after_it():
    """Songsterr writes the signature only where it changes: a 3/4 song states it on bar 1."""
    beat = {"duration": [1, 4], "type": 4, "notes": [{"string": 0, "fret": 3}]}
    measures = [{"signature": [3, 4], "voices": [{"beats": [beat] * 3}]}] + [{"voices": [{"beats": [beat] * 3}]}] * 7
    measures.append({})  # an empty bar lasts a 3/4 bar too

    *_, signature = fetcher._parse_tab_json({"measures": measures}, source_bpm=60.0)

    assert signature == (3, 4)
