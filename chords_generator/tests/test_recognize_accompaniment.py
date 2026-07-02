"""Tests /recognize's optional accompaniment-stem mixing.

Mocks recognize_chords and mix_audio_files so no real audio/model is needed —
these tests verify the plumbing (which file gets recognized), not autochord
itself (covered by the real end-to-end test in test_api.py).
"""

import pytest

import chords_generator.api as api_mod
from chords_generator.recognizer import ChordResult


@pytest.mark.asyncio
async def test_recognize_uses_accompaniment_mix_when_stems_given(
    client, monkeypatch, tmp_path,
):
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    audio_path = str(song_dir / "audio.mp3")
    bass_path = str(song_dir / "bass.mp3")
    guitar_path = str(song_dir / "guitar.mp3")
    for p in (audio_path, bass_path, guitar_path):
        open(p, "wb").write(b"x")

    recognized_paths: list[str] = []

    def fake_recognize_chords(input_path, output_dir):
        recognized_paths.append(input_path)
        return [ChordResult(start_time=0.0, end_time=1.0, chord="C:maj")]

    mixed_calls: list[tuple[list[str], str]] = []

    def fake_mix_audio_files(input_paths, output_path):
        mixed_calls.append((list(input_paths), output_path))
        open(output_path, "wb").write(b"mixed")

    monkeypatch.setattr(api_mod, "recognize_chords", fake_recognize_chords)
    monkeypatch.setattr(api_mod, "mix_audio_files", fake_mix_audio_files)

    resp = await client.post("/recognize", json={
        "input_path": audio_path,
        "accompaniment_stem_paths": [bass_path, guitar_path],
    })

    assert resp.status_code == 200
    assert len(mixed_calls) == 1
    assert mixed_calls[0][0] == [bass_path, guitar_path]
    # The recognizer ran on the mixed accompaniment file, not the full mix.
    assert recognized_paths == [mixed_calls[0][1]]
    assert recognized_paths[0] != audio_path


@pytest.mark.asyncio
async def test_recognize_falls_back_to_full_mix_when_stems_missing(
    client, monkeypatch, tmp_path,
):
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    audio_path = str(song_dir / "audio.mp3")
    open(audio_path, "wb").write(b"x")
    missing_bass_path = str(song_dir / "bass.mp3")  # never created

    recognized_paths: list[str] = []

    def fake_recognize_chords(input_path, output_dir):
        recognized_paths.append(input_path)
        return [ChordResult(start_time=0.0, end_time=1.0, chord="C:maj")]

    def fake_mix_audio_files(input_paths, output_path):
        raise AssertionError("mix_audio_files should not be called with no existing stems")

    monkeypatch.setattr(api_mod, "recognize_chords", fake_recognize_chords)
    monkeypatch.setattr(api_mod, "mix_audio_files", fake_mix_audio_files)

    resp = await client.post("/recognize", json={
        "input_path": audio_path,
        "accompaniment_stem_paths": [missing_bass_path],
    })

    assert resp.status_code == 200
    assert recognized_paths == [audio_path]


@pytest.mark.asyncio
async def test_recognize_without_stem_paths_uses_full_mix_unchanged(
    client, monkeypatch, tmp_path,
):
    """No accompaniment_stem_paths given -> behavior is unchanged (full mix)."""
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    audio_path = str(song_dir / "audio.mp3")
    open(audio_path, "wb").write(b"x")

    recognized_paths: list[str] = []

    def fake_recognize_chords(input_path, output_dir):
        recognized_paths.append(input_path)
        return [ChordResult(start_time=0.0, end_time=1.0, chord="C:maj")]

    monkeypatch.setattr(api_mod, "recognize_chords", fake_recognize_chords)

    resp = await client.post("/recognize", json={"input_path": audio_path})

    assert resp.status_code == 200
    assert recognized_paths == [audio_path]
