"""Tests for snapping community chord change times onto detected beat anchors.

Community (Ultimate Guitar) chord times are derived from lyric timing, which
is close but rarely lands exactly on the beat. When we also have autochord
chord-change times or a bar grid for the same song, nudging a chord start
onto the nearest anchor (within a small tolerance) makes strums land on the
beat without needing a full re-detection.
"""

from __future__ import annotations

from guitar_player.schemas.song import ChordEntry
from guitar_player.services.song_service.chord_time_snap import (
    build_anchor_times,
    snap_chord_times,
)


def _chord(start: float, end: float, name: str = "C") -> ChordEntry:
    return ChordEntry(start_time=start, end_time=end, chord=name)


def test_snaps_to_nearest_anchor_within_tolerance() -> None:
    chords = [_chord(10.42, 12.0, "C"), _chord(12.0, 14.0, "G")]
    result = snap_chord_times(chords, anchors=[10.5, 12.1], tolerance=0.6)
    assert result[0].start_time == 10.5
    assert result[0].end_time == result[1].start_time


def test_does_not_snap_beyond_tolerance() -> None:
    chords = [_chord(10.0, 12.0, "C")]
    result = snap_chord_times(chords, anchors=[11.5], tolerance=0.6)
    assert result[0].start_time == 10.0


def test_no_anchors_is_a_no_op() -> None:
    chords = [_chord(10.42, 12.0, "C"), _chord(12.0, 14.0, "G")]
    result = snap_chord_times(chords, anchors=[], tolerance=0.6)
    assert [c.start_time for c in result] == [10.42, 12.0]
    assert [c.end_time for c in result] == [12.0, 14.0]


def test_snapping_preserves_strict_monotonicity() -> None:
    """If snapping a chord would put it past the next chord's start, the
    unsnapped time is kept instead — the anchor here is much closer to the
    second chord, so only that one is allowed to claim it."""
    chords = [_chord(10.0, 10.3, "C"), _chord(10.3, 12.0, "G")]
    result = snap_chord_times(chords, anchors=[10.35], tolerance=0.6)
    assert result[0].start_time == 10.0  # kept unsnapped: snap would exceed next's start
    assert result[1].start_time == 10.35
    assert result[0].start_time < result[1].start_time


def test_end_times_recomputed_from_snapped_starts() -> None:
    chords = [_chord(10.42, 10.42, "C"), _chord(12.55, 12.55, "G")]
    result = snap_chord_times(chords, anchors=[10.5, 12.5], tolerance=0.6)
    assert result[0].end_time == result[1].start_time == 12.5
    assert result[1].end_time == 12.55  # last chord keeps its original end


def test_build_anchor_times_unions_autochord_starts_and_bar_starts() -> None:
    autochord = [_chord(1.0, 2.0, "C"), _chord(2.0, 3.0, "G")]
    anchors = build_anchor_times(autochord, bar_starts=[2.0, 4.0])
    assert anchors == [1.0, 2.0, 4.0]


def test_build_anchor_times_empty_when_nothing_available() -> None:
    assert build_anchor_times([], []) == []
