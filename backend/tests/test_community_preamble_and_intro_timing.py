"""Integration test: preamble trimming + intro-anchored timing end to end.

Exercises the full read-time path (`_load_community_chord_options` ->
`_build_option`) with a synthetic Ultimate Guitar sheet that has preamble
prose, an instrumental intro, and a matched lyric line, plus synthetic
whisper segments and autochord/bar anchors.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

from guitar_player.schemas.records import SongRecord
from guitar_player.schemas.song import ChordEntry, LyricsSegment, LyricsWord
from guitar_player.services.song_service.detail import _load_community_chord_options


def test_preamble_dropped_and_intro_anchored_to_detected_start(settings, storage) -> None:
    """The returned ChordOption excludes preamble text/chords, and its leading
    intro chord starts near the first detected anchor rather than 0.0."""
    song_name = f"test_preamble_intro_{uuid.uuid4().hex[:8]}/test_song"
    static_chords_key = f"{song_name}/static_chords.json"

    static_chords = {
        "lines": [
            {"type": "lyric", "text": "Song: Test Song", "chords": []},
            {"type": "lyric", "text": "Tabbed by: someone", "chords": []},
            {"type": "empty", "text": "", "chords": []},
            {"type": "section", "text": "Intro", "chords": []},
            {"type": "instrumental", "text": "", "chords": [{"chord": "G", "position": 0}]},
            {"type": "empty", "text": "", "chords": []},
            {
                "type": "lyric",
                "text": "When I find myself in times of trouble",
                "chords": [{"chord": "C", "position": 0}],
            },
        ],
    }
    lyrics_data = {
        "lyrics": [
            LyricsSegment(
                start=10.0, end=14.0, text="When I find myself in times of trouble",
                words=[
                    LyricsWord(word="when", start=10.0, end=10.5),
                    LyricsWord(word="i", start=10.5, end=10.6),
                    LyricsWord(word="find", start=10.6, end=11.0),
                    LyricsWord(word="myself", start=11.0, end=11.5),
                    LyricsWord(word="in", start=11.5, end=11.6),
                    LyricsWord(word="times", start=11.6, end=12.0),
                    LyricsWord(word="of", start=12.0, end=12.2),
                    LyricsWord(word="trouble", start=12.2, end=13.0),
                ],
            ),
        ],
    }

    song = SongRecord(
        id=uuid.uuid4(),
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
        title="Preamble Intro Test",
        song_name=song_name,
        static_chords_key=static_chords_key,
    )

    try:
        storage.write_json(static_chords_key, static_chords)

        options, _tabs = _load_community_chord_options(
            storage, song, duration=240.0, lyrics_data=lyrics_data,
            autochord_chords=[
                ChordEntry(start_time=6.0, end_time=10.0, chord="G"),
            ],
            bar_starts=[],
        )
        assert options
        option = options[0]

        # Preamble prose never made it into the sheet's lyrics.
        assert all("Song:" not in seg.text and "Tabbed by" not in seg.text for seg in option.lyrics)

        # The leading intro chord (G) anchors to the detected start (6.0),
        # not to 0.0.
        chords_by_name = {c.chord: c for c in option.chords}
        assert chords_by_name["G"].start_time == pytest.approx(6.0)
        assert chords_by_name["C"].start_time == 10.0
    finally:
        base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
        shutil.rmtree(base / song_name.split("/")[0], ignore_errors=True)
