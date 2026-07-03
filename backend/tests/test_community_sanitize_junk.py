"""End-to-end: mid-sheet tab lines and tabber commentary never reach the
served ChordOption, mirroring the user-reported screenshot (commentary
prose highlighted as lyrics, followed by an ASCII tab block).
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from guitar_player.schemas.records import SongRecord
from guitar_player.schemas.song import LyricsSegment, LyricsWord
from guitar_player.services.song_service.detail import _load_community_chord_options


def test_mid_sheet_commentary_and_tab_lines_are_excluded_from_the_served_sheet(
    settings, storage,
) -> None:
    song_name = f"test_sanitize_junk_{uuid.uuid4().hex[:8]}/test_song"
    static_chords_key = f"{song_name}/static_chords.json"

    static_chords = {
        "lines": [
            {
                "type": "lyric",
                "text": "and yet i find and yet i find",
                "chords": [{"chord": "Em", "position": 0}],
            },
            {"type": "lyric", "text": "that's pretty much the song, he does some", "chords": []},
            {"type": "lyric", "text": "hammer ons on the C looks something like", "chords": []},
            {"type": "lyric", "text": "e|----------------------------|--------------------------|", "chords": []},
            {"type": "lyric", "text": "B|----------------------------|--------------------------|", "chords": []},
            {"type": "lyric", "text": "G|-8--8-8-8-8-8-8-------------|--------------------------|", "chords": []},
            {
                "type": "lyric",
                "text": "repeating in my head",
                "chords": [{"chord": "Dm", "position": 0}, {"chord": "C", "position": 10}],
            },
        ],
    }
    lyrics_data = {
        "lyrics": [
            LyricsSegment(
                start=10.0, end=14.0, text="and yet i find and yet i find",
                words=[
                    LyricsWord(word=w, start=10.0 + i, end=10.5 + i)
                    for i, w in enumerate("and yet i find and yet i find".split())
                ],
            ),
            LyricsSegment(
                start=20.0, end=23.0, text="repeating in my head",
                words=[
                    LyricsWord(word=w, start=20.0 + i * 0.7, end=20.5 + i * 0.7)
                    for i, w in enumerate("repeating in my head".split())
                ],
            ),
        ],
    }

    song = SongRecord(
        id=uuid.uuid4(),
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
        title="Sanitize Junk Test",
        song_name=song_name,
        static_chords_key=static_chords_key,
    )

    try:
        storage.write_json(static_chords_key, static_chords)

        options, _tabs = _load_community_chord_options(
            storage, song, duration=240.0, lyrics_data=lyrics_data,
            autochord_chords=[], bar_starts=[],
        )
        assert options
        option = options[0]

        texts = [seg.text for seg in option.lyrics]
        assert "and yet i find and yet i find" in texts
        assert "repeating in my head" in texts
        assert not any("pretty much the song" in t or "hammer ons" in t for t in texts)
        assert not any(t.startswith(("e|", "e |", "B|", "G|")) for t in texts)

        # Chords from both the real lyric lines survive, in order, and the
        # commentary/tab junk contributes no extra chords or lyric segments
        # in between them.
        chord_names = [c.chord for c in option.chords]
        assert chord_names == ["Em", "Dm", "C"]
        assert len(option.lyrics) == 2
    finally:
        base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
        shutil.rmtree(base / song_name.split("/")[0], ignore_errors=True)
