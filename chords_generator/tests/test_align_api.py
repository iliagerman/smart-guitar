"""/align: community sheet chords on the recognized beats (local storage, synthetic probabilities)."""

import json

import numpy as np
import pytest

from chords_generator.chord_model import LABELS

FRAME_S = 0.1
INDEX = {label: i for i, label in enumerate(LABELS)}
PLAYED = ["G:maj", "D:maj", "E:min", "C:maj"] * 3


def _song(tmp_path, sheet_lines: list[str]) -> str:
    song = tmp_path / "song"
    song.mkdir()
    beats = [0.5 * i for i in range(1, 4 * len(PLAYED) + 2)]
    duration = 0.5 + 2.0 * len(PLAYED) + 0.5
    frames = int(round(duration / FRAME_S))
    probs = np.full((frames, len(LABELS)), 0.4 / (len(LABELS) - 1))
    for i, chord in enumerate(PLAYED):
        a, b = int(round((0.5 + 2.0 * i) / FRAME_S)), int(round((2.5 + 2.0 * i) / FRAME_S))
        probs[a:b] = 0.4 / (len(LABELS) - 1)
        probs[a:b, INDEX[chord]] = 0.6
    np.savez_compressed(song / "chord_probs.npz", log_probs=np.log(probs).astype(np.float16), frame_s=FRAME_S)
    (song / "chord_meta.json").write_text(json.dumps({"beat_times": beats, "downbeat_times": beats[::4], "key": "G"}))
    (song / "chords.json").write_text(json.dumps([{"start_time": 0.0, "end_time": duration, "chord": "G:maj"}]))
    (song / "chords_beginner_capo_9.json").write_text("{}")
    lines = [{"type": "lyric", "text": "", "chords": [{"chord": c, "position": 0} for c in line.split()]} for line in sheet_lines]
    (song / "static_chords.json").write_text(json.dumps({"versions": [{"source_url": "https://sheet", "capo": 0, "lines": lines}]}))
    return str(song)


@pytest.mark.asyncio
async def test_align_puts_the_sheets_chords_on_the_beats(client, tmp_path):
    song = _song(tmp_path, ["G D/F# Em C"])

    resp = await client.post("/align", json={"chords_path": f"{song}/chords.json", "sheet_path": f"{song}/static_chords.json"})

    assert resp.status_code == 200
    assert resp.json()["accepted"] is True
    chords = json.load(open(f"{song}/chords.json"))
    named = [(c["chord"], c.get("bass")) for c in chords if c["chord"] != "N"]
    assert named[:4] == [("G", None), ("D", "F#"), ("Em", None), ("C", None)]
    meta = json.load(open(f"{song}/chord_meta.json"))
    assert meta["chord_source"] == "sheet"
    assert meta["sheet_url"] == "https://sheet"
    assert meta["key"] == "G"
    assert not (tmp_path / "song" / "chords_beginner_capo_9.json").exists()


@pytest.mark.asyncio
async def test_align_leaves_the_detected_chords_when_the_sheet_does_not_fit(client, tmp_path):
    song = _song(tmp_path, ["F#dim Bbmaj7 Ebm C#7"])

    resp = await client.post("/align", json={"chords_path": f"{song}/chords.json", "sheet_path": f"{song}/static_chords.json"})

    assert resp.status_code == 200
    assert resp.json()["accepted"] is False
    assert json.load(open(f"{song}/chords.json"))[0]["chord"] == "G:maj"
    assert json.load(open(f"{song}/chord_meta.json"))["chord_source"] == "detected"


@pytest.mark.asyncio
async def test_align_404_without_recognized_chords(client, tmp_path):
    song = tmp_path / "song"
    song.mkdir()
    (song / "static_chords.json").write_text("{}")
    resp = await client.post("/align", json={"chords_path": f"{song}/chords.json", "sheet_path": f"{song}/static_chords.json"})
    assert resp.status_code == 404
