"""Unit tests for chord_eval.py's scoring plumbing — tiny synthetic fixtures."""

from __future__ import annotations

import json

import pytest

from scripts.chord_eval import aggregate, find_song_pairs, load_generated_chords, score_song


def _write_lab(path, rows: list[tuple[float, float, str]]) -> None:
    with open(path, "w") as f:
        for start, end, chord in rows:
            f.write(f"{start} {end} {chord}\n")


def _write_chords_json(path, entries: list[dict]) -> None:
    with open(path, "w") as f:
        json.dump(entries, f)


def test_load_generated_chords_reads_intervals_and_labels(tmp_path):
    chords_path = tmp_path / "chords.json"
    _write_chords_json(chords_path, [
        {"start_time": 0.0, "end_time": 2.0, "chord": "C:maj", "bass": None},
        {"start_time": 2.0, "end_time": 4.0, "chord": "G:maj", "bass": "B"},
    ])

    intervals, labels = load_generated_chords(chords_path)

    assert intervals.tolist() == [[0.0, 2.0], [2.0, 4.0]]
    assert labels == ["C:maj", "G:maj"]


def test_score_song_perfect_match_gives_full_marks(tmp_path):
    lab_path = tmp_path / "song1.lab"
    chords_path = tmp_path / "chords.json"
    _write_lab(lab_path, [(0.0, 2.0, "C:maj"), (2.0, 4.0, "G:maj")])
    _write_chords_json(chords_path, [
        {"start_time": 0.0, "end_time": 2.0, "chord": "C:maj", "bass": None},
        {"start_time": 2.0, "end_time": 4.0, "chord": "G:maj", "bass": None},
    ])

    scores = score_song(lab_path, chords_path)

    assert scores["majmin"] == pytest.approx(1.0)
    assert scores["root"] == pytest.approx(1.0)


def test_score_song_wrong_chord_lowers_majmin_score(tmp_path):
    lab_path = tmp_path / "song1.lab"
    chords_path = tmp_path / "chords.json"
    _write_lab(lab_path, [(0.0, 2.0, "C:maj"), (2.0, 4.0, "G:maj")])
    _write_chords_json(chords_path, [
        {"start_time": 0.0, "end_time": 2.0, "chord": "C:maj", "bass": None},
        {"start_time": 2.0, "end_time": 4.0, "chord": "D:maj", "bass": None},
    ])

    scores = score_song(lab_path, chords_path)

    assert scores["majmin"] == pytest.approx(0.5)


def test_find_song_pairs_matches_lab_files_to_chords_json(tmp_path):
    lab_dir = tmp_path / "labs"
    chords_root = tmp_path / "songs"
    lab_dir.mkdir()
    (chords_root / "song_a").mkdir(parents=True)
    (chords_root / "song_b").mkdir(parents=True)

    _write_lab(lab_dir / "song_a.lab", [(0.0, 1.0, "N")])
    _write_lab(lab_dir / "song_missing.lab", [(0.0, 1.0, "N")])
    _write_chords_json(chords_root / "song_a" / "chords.json", [
        {"start_time": 0.0, "end_time": 1.0, "chord": "N", "bass": None},
    ])
    _write_chords_json(chords_root / "song_b" / "chords.json", [
        {"start_time": 0.0, "end_time": 1.0, "chord": "N", "bass": None},
    ])

    pairs = find_song_pairs(lab_dir, chords_root)

    song_ids = [song_id for song_id, _, _ in pairs]
    assert song_ids == ["song_a"]  # song_missing has no chords.json, song_b has no .lab


def test_aggregate_averages_metrics_across_songs():
    per_song = {
        "song_a": {"majmin": 1.0, "root": 1.0},
        "song_b": {"majmin": 0.5, "root": 0.0},
    }

    agg = aggregate(per_song)

    assert agg["majmin"] == pytest.approx(0.75)
    assert agg["root"] == pytest.approx(0.5)


def test_aggregate_empty_returns_empty_dict():
    assert aggregate({}) == {}
