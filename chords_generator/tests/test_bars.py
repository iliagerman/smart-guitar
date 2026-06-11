"""Bar (measure) grid computation from the detected beat grid.

Bars assume 4/4 (the overwhelming default for the catalog) but the phase —
which beat is beat 1 — is chosen so that the most chord changes land on bar
starts, since chords overwhelmingly change on downbeats.
"""

from chords_generator.bars import compute_bar_starts
from chords_generator.schemas import ChordResult


def chord(start: float, end: float, name: str = "C:maj") -> ChordResult:
    return ChordResult(start_time=start, end_time=end, chord=name)


def test_phase_chosen_so_chord_changes_land_on_bar_starts():
    # Beats every 0.5s starting at 0.0; the song's downbeats are at phase 2
    # (1.0, 3.0, 5.0, ...) because that's where the chords change.
    beats = [i * 0.5 for i in range(40)]  # 0.0 .. 19.5
    chords = [
        chord(1.0, 3.0, "C:maj"),
        chord(3.0, 5.0, "G:maj"),
        chord(5.0, 7.0, "A:min"),
        chord(7.0, 9.0, "F:maj"),
    ]
    bars = compute_bar_starts(beats, chords)
    assert bars[:4] == [1.0, 3.0, 5.0, 7.0]
    # Bars are every 4 beats (2.0s at 120bpm-with-0.5s-beats).
    assert all(abs((b2 - b1) - 2.0) < 1e-6 for b1, b2 in zip(bars, bars[1:]))


def test_phase_zero_when_chords_align_with_first_beat():
    beats = [i * 0.5 for i in range(16)]
    chords = [chord(0.0, 2.0, "C:maj"), chord(2.0, 4.0, "G:maj")]
    bars = compute_bar_starts(beats, chords)
    assert bars[0] == 0.0
    assert bars[1] == 2.0


def test_no_beats_returns_empty():
    assert compute_bar_starts([], [chord(0.0, 2.0)]) == []


def test_no_chords_still_produces_bars_from_phase_zero():
    beats = [i * 0.5 for i in range(8)]
    bars = compute_bar_starts(beats, [])
    assert bars == [0.0, 2.0]
