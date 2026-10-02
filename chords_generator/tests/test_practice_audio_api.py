"""/practice-audio: lighter mixer copies of the stems and the strum accents (synthetic audio)."""

import json

import numpy as np
import pytest
import soundfile as sf

from chords_generator.strum_accents import pick_accents

SR = 22050
BEAT_S = 0.5
BARS = 24


def _clicks(path, loud_slots: set[int], quiet: float = 0.2) -> None:
    """A click on every eighth note of a 4/4 bar, louder on loud_slots (0 = beat 1, 1 = its "&")."""
    audio = np.zeros(int(SR * (BEAT_S * 4 * BARS + 2)))
    burst = np.random.default_rng(0).standard_normal(int(SR * 0.03)) * np.hanning(int(SR * 0.03))
    for bar in range(BARS):
        for slot in range(8):
            start = int(SR * (1.0 + bar * 4 * BEAT_S + slot * BEAT_S / 2))
            gain = 1.0 if slot in loud_slots else quiet
            audio[start:start + len(burst)] += gain * burst
    sf.write(path, audio * 0.5, SR)


def _song(tmp_path, loud_slots: set[int]) -> dict:
    song = tmp_path / "song"
    song.mkdir()
    _clicks(song / "guitar.wav", loud_slots)
    sf.write(song / "other.wav", np.zeros(SR * 10), SR)
    beats = [1.0 + i * BEAT_S for i in range(BARS * 4 + 1)]
    (song / "chord_meta.json").write_text(json.dumps({"beat_times": beats, "downbeat_times": beats[::4], "beats_per_bar": 4}))
    (song / "chords.json").write_text("[]")
    return {
        "chords_path": str(song / "chords.json"),
        "stems": {"guitar": str(song / "guitar.wav"), "other": str(song / "other.wav")},
    }


@pytest.mark.asyncio
async def test_writes_mixer_copies_and_the_accented_strokes(client, tmp_path):
    """Beat 2 and the "&" of 3 hit hardest in every bar, so they are the accents."""
    request = _song(tmp_path, loud_slots={2, 5})

    resp = await client.post("/practice-audio", json=request)

    assert resp.status_code == 200
    song = tmp_path / "song"
    assert (song / "mixer" / "guitar.mp3").stat().st_size > 0
    assert (song / "mixer" / "other.mp3").stat().st_size > 0
    accents = json.loads((song / "strum_accents.json").read_text())
    assert accents["beats_per_bar"] == 4
    assert accents["steps_per_beat"] == 2
    assert accents["accents"] == [False, False, True, False, False, True, False, False]
    assert resp.json()["accents"] == accents["accents"]


@pytest.mark.asyncio
async def test_no_accents_when_every_stroke_is_as_hard(client, tmp_path):
    """An even strum has nothing to accent."""
    request = _song(tmp_path, loud_slots=set(range(8)))

    resp = await client.post("/practice-audio", json=request)

    assert resp.status_code == 200
    accents = json.loads((tmp_path / "song" / "strum_accents.json").read_text())
    assert accents["accents"] == [False] * 8


@pytest.mark.asyncio
async def test_404_without_the_beat_grid(client, tmp_path):
    """Accents are placed on the recognized beats; without them there is nothing to do."""
    request = _song(tmp_path, loud_slots={2, 5})
    (tmp_path / "song" / "chord_meta.json").unlink()

    resp = await client.post("/practice-audio", json=request)

    assert resp.status_code == 404


def test_a_second_accent_needs_less_to_stand_out_than_the_first():
    """Losing My Religion (YouTube recording): the "&" of 3 at 1.26, beat 2 at 1.12, the "&" of 4 at 1.10."""
    strength = [0.862, 0.5, 1.124, 0.606, 1.007, 1.262, 0.981, 1.103]
    assert pick_accents(strength) == [False, False, True, False, False, True, False, False]
    # Nothing at 1.15 or more: no accent, however the rest compare.
    assert pick_accents([1.12, 0.9, 1.11, 0.9, 1.0, 0.95, 1.0, 1.02]) == [False] * 8
