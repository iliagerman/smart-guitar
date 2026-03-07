"""Unit tests for chord simplifier — no model or audio files needed."""

import json
import os
import tempfile

from chords_generator.schemas import ChordResult
from chords_generator.simplifier import (
    generate_simplified_options,
    mirex_to_pychord,
    score_open_chords,
    simplify_to_triad,
    to_open_chord,
    transpose_for_capo,
    write_simplified_outputs,
)


# ── mirex_to_pychord ──────────────────────────────────────────


def test_mirex_to_pychord_no_chord():
    assert mirex_to_pychord("N") is None


def test_mirex_to_pychord_major():
    assert mirex_to_pychord("C:maj") == "C"


def test_mirex_to_pychord_minor():
    assert mirex_to_pychord("A:min") == "Am"


def test_mirex_to_pychord_seventh():
    assert mirex_to_pychord("G:7") == "G7"


def test_mirex_to_pychord_minor7():
    assert mirex_to_pychord("D:min7") == "Dm7"


def test_mirex_to_pychord_slash_bass_stripped():
    assert mirex_to_pychord("A:min/b3") == "Am"


def test_mirex_to_pychord_no_colon_passthrough():
    assert mirex_to_pychord("C") == "C"


# ── simplify_to_triad ────────────────────────────────────────


def test_simplify_major_stays():
    assert simplify_to_triad("C") == "C"


def test_simplify_minor_stays():
    assert simplify_to_triad("Am") == "Am"


def test_simplify_7_to_major():
    assert simplify_to_triad("G7") == "G"


def test_simplify_m7_to_minor():
    assert simplify_to_triad("Dm7") == "Dm"


def test_simplify_unparseable_returns_original():
    assert simplify_to_triad("XYZ123") == "XYZ123"


# ── to_open_chord ────────────────────────────────────────────


def test_open_chord_c_stays():
    assert to_open_chord("C") == "C"


def test_open_chord_am_stays():
    assert to_open_chord("Am") == "Am"


def test_open_chord_f_maps_to_e():
    assert to_open_chord("F") == "E"


def test_open_chord_bm_maps_to_am():
    assert to_open_chord("Bm") == "Am"


# ── transpose_for_capo ───────────────────────────────────────


def test_capo_0_no_change():
    assert transpose_for_capo("G", 0) == "G"


def test_capo_2_transposes_down():
    assert transpose_for_capo("G", 2) == "F"


def test_capo_unparseable_returns_original():
    assert transpose_for_capo("XYZ", 3) == "XYZ"


# ── score_open_chords ────────────────────────────────────────


def test_score_all_open():
    assert score_open_chords(["C", "G", "Am", "Em"]) == 4


def test_score_none_open():
    assert score_open_chords(["F#", "Bb", "Cm"]) == 0


def test_score_mixed():
    assert score_open_chords(["C", "F#", "Am", "Bb"]) == 2


# ── generate_simplified_options ───────────────────────────────


def _make_result(chord: str, start: float = 0.0, end: float = 1.0) -> ChordResult:
    return ChordResult(start_time=start, end_time=end, chord=chord)


def test_generate_simplified_options_structure():
    results = [_make_result("C:maj"), _make_result("A:min"), _make_result("G:7")]
    options = generate_simplified_options(results)

    assert "options" in options
    names = [o["name"] for o in options["options"]]
    assert "intermediate" in names
    assert "beginner" in names
    # Should have exactly 2 capo options (best 2 positions)
    capo_names = [n for n in names if n.startswith("beginner_capo_")]
    assert len(capo_names) == 2


def test_generate_simplified_options_n_chord():
    results = [_make_result("N")]
    options = generate_simplified_options(results)
    for option in options["options"]:
        assert option["chords"][0]["chord"] == "N"


def test_generate_simplified_options_empty():
    options = generate_simplified_options([])
    assert "options" in options
    for option in options["options"]:
        assert option["chords"] == []


# ── write_simplified_outputs ──────────────────────────────────


def test_write_simplified_outputs_creates_files():
    results = [_make_result("C:maj"), _make_result("A:min")]
    options = generate_simplified_options(results)

    with tempfile.TemporaryDirectory() as tmpdir:
        written = write_simplified_outputs(options, tmpdir)

        assert "chords_intermediate.json" in written
        assert "chords_beginner.json" in written

        for filename in written:
            filepath = os.path.join(tmpdir, filename)
            assert os.path.isfile(filepath)
            with open(filepath) as f:
                data = json.load(f)
            assert "name" in data
            assert "chords" in data
            assert "capo" in data
