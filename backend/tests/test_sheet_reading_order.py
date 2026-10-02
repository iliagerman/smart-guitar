"""Hebrew chord-sheet lines in reading order."""

from guitar_player.services.sheet_reading_order import to_reading_order


def test_a_hebrew_lyric_rows_chords_are_reversed_and_measured_from_the_start_of_the_text():
    text = "אבא, אני רוצה לעמוד מולך"  # 24 characters; reads right to left
    line = {"type": "lyric", "text": text, "chords": [{"chord": "Am", "position": 2}, {"chord": "Em", "position": 20}]}

    [out] = to_reading_order([line])

    assert [c["chord"] for c in out["chords"]] == ["Em", "Am"]
    assert [c["position"] for c in out["chords"]] == [3, 21]


def test_english_lines_and_chord_only_lines_are_left_as_written():
    lines = [
        {"type": "lyric", "text": "Hello darkness", "chords": [{"chord": "Am", "position": 0}, {"chord": "G", "position": 6}]},
        {"type": "instrumental", "text": "", "chords": [{"chord": "Am", "position": 0}, {"chord": "G", "position": 4}]},
    ]
    assert to_reading_order(lines) == lines
