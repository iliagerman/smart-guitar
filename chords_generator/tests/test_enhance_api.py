"""Tests for the /enhance endpoint (beat-align + slash bass on existing chords).

Mocks the librosa-backed functions so no audio/model is required.
"""

import json

import pytest

import chords_generator.api as api_mod


def _write_chords(path: str, chords: list[dict]) -> None:
    with open(path, "w") as f:
        json.dump(chords, f)


@pytest.mark.asyncio
async def test_enhance_beat_aligns_and_adds_bass(client, monkeypatch, tmp_path):
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    chords_path = str(song_dir / "chords.json")
    audio_path = str(song_dir / "audio.mp3")
    bass_path = str(song_dir / "bass.mp3")
    _write_chords(chords_path, [
        {"start_time": 0.07, "end_time": 1.9, "chord": "C:maj"},
        {"start_time": 1.9, "end_time": 3.8, "chord": "G:maj"},
    ])
    open(audio_path, "wb").write(b"x")
    open(bass_path, "wb").write(b"x")

    monkeypatch.setattr(api_mod, "detect_beats", lambda p: ([0.0, 1.0, 2.0, 3.0, 4.0], 120.0))

    def fake_bass(_bass_path, chords):
        for c in chords:
            c.bass = "G" if c.chord.startswith("C") else None
        return chords

    monkeypatch.setattr(api_mod, "detect_bass_for_chords", fake_bass)

    resp = await client.post("/enhance", json={
        "audio_path": audio_path, "chords_path": chords_path, "bass_path": bass_path,
    })
    assert resp.status_code == 200
    data = resp.json()

    assert data["beats_detected"] == 5
    assert data["bass_count"] == 1
    # Beat-aligned: C's 0.07 start snapped to beat 0.0.
    assert data["chords"][0]["start_time"] == 0.0
    assert data["chords"][0]["bass"] == "G"
    assert data["chords"][1]["bass"] is None

    # chords.json was rewritten in place with the enhanced data.
    with open(chords_path) as f:
        written = json.load(f)
    assert written[0]["start_time"] == 0.0
    assert written[0]["bass"] == "G"


@pytest.mark.asyncio
async def test_enhance_beat_aligns_without_bass_when_no_bass_path(client, monkeypatch, tmp_path):
    song_dir = tmp_path / "song2"
    song_dir.mkdir()
    chords_path = str(song_dir / "chords.json")
    audio_path = str(song_dir / "audio.mp3")
    _write_chords(chords_path, [{"start_time": 0.07, "end_time": 1.9, "chord": "C:maj"}])
    open(audio_path, "wb").write(b"x")

    monkeypatch.setattr(api_mod, "detect_beats", lambda p: ([0.0, 1.0, 2.0], 120.0))

    def _should_not_run(*_a, **_k):
        raise AssertionError("detect_bass_for_chords must not run without a bass path")

    monkeypatch.setattr(api_mod, "detect_bass_for_chords", _should_not_run)

    resp = await client.post("/enhance", json={
        "audio_path": audio_path, "chords_path": chords_path, "bass_path": "",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["bass_count"] == 0
    assert data["chords"][0]["start_time"] == 0.0


@pytest.mark.asyncio
async def test_enhance_regenerates_simplified_variants(client, monkeypatch, tmp_path):
    """Enhance must rewrite the simplified difficulty variants too, so
    beginner/capo sheets carry the same beat-aligned timing as chords.json."""
    song_dir = tmp_path / "song3"
    song_dir.mkdir()
    chords_path = str(song_dir / "chords.json")
    audio_path = str(song_dir / "audio.mp3")
    _write_chords(chords_path, [
        {"start_time": 0.07, "end_time": 1.9, "chord": "C:maj"},
        {"start_time": 1.9, "end_time": 3.8, "chord": "G:maj"},
    ])
    open(audio_path, "wb").write(b"x")

    monkeypatch.setattr(api_mod, "detect_beats", lambda p: ([0.0, 1.0, 2.0, 3.0, 4.0], 120.0))

    resp = await client.post("/enhance", json={
        "audio_path": audio_path, "chords_path": chords_path, "bass_path": "",
    })
    assert resp.status_code == 200

    for variant in ("chords_intermediate.json", "chords_beginner.json"):
        variant_path = song_dir / variant
        assert variant_path.exists(), f"{variant} not regenerated"
        with open(variant_path) as f:
            data = json.load(f)
        # Variant timing must match the beat-aligned main chords.
        assert data["chords"][0]["start_time"] == 0.0


@pytest.mark.asyncio
async def test_enhance_404_when_chords_missing(client, tmp_path):
    audio_path = str(tmp_path / "audio.mp3")
    open(audio_path, "wb").write(b"x")
    resp = await client.post("/enhance", json={
        "audio_path": audio_path, "chords_path": str(tmp_path / "missing.json"), "bass_path": "",
    })
    assert resp.status_code == 404
