"""Tests that word-level chord/lyric timing auto-recovers from bad whisper anchors.

Whisper transcription can disagree with a sheet's actual words (mishearings,
dropped/extra words, wrong occurrence of a repeated chorus line). A matched
whisper word is untrusted input: it's only used as an anchor when it falls
inside (or near) its line's window, stays monotonic within the line, and
doesn't violate ordering against neighboring lines. The guiding invariant is
that word-level anchoring must never be worse than today's plain
interpolation — it's an opportunistic improvement only.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

from guitar_player.schemas.records import SongRecord
from guitar_player.schemas.song import ChordEntry, LyricsSegment, LyricsWord
from guitar_player.services.song_service.detail import (
    _load_community_chord_options,
    _static_lines_to_chord_option,
)
from guitar_player.services.song_service.sheet_alignment import TimedWord


def _lyric(text: str, chords: list[dict] | None = None) -> dict:
    return {"type": "lyric", "text": text, "chords": chords or []}


def test_outlier_whisper_word_is_rejected_and_interpolated() -> None:
    """A single badly-mispaired whisper word must not yank a chord across the song."""
    lines = [_lyric("one two three four", chords=[{"chord": "C", "position": 8}])]
    # "three" is bound to a wildly out-of-window time (a bad SequenceMatcher
    # pairing) while its neighbors are correctly anchored inside the window.
    words_for_line = [
        TimedWord(token="one", start=10.0, end=10.3),
        TimedWord(token="two", start=10.3, end=10.6),
        TimedWord(token="three", start=999.0, end=999.3),
        TimedWord(token="four", start=13.5, end=14.0),
    ]
    option = _static_lines_to_chord_option(
        lines, duration=240.0, name="Sheet 1",
        line_windows=[(10.0, 14.0)],
        line_words=[words_for_line],
    )
    assert option.lyrics_synced is True
    words = option.lyrics[0].words
    assert words[0].start == 10.0
    assert words[1].start == 10.3
    assert words[3].start == 13.5
    # "three" fell back to interpolation between its accepted neighbors,
    # nowhere near the rejected 999.0 anchor.
    assert 10.6 <= words[2].start < words[2].end <= 13.5
    # The chord riding on "three" (char position 8) must follow suit.
    assert option.chords[0].start_time < 999.0


def test_low_quality_line_falls_back_to_current_interpolation() -> None:
    """A line where under 40% of words got an accepted anchor behaves like today."""
    text = "completely garbled whisper output here today"
    raw_lines = [_lyric(text, chords=[{"chord": "G", "position": 0}])]
    # Only "here" (1 of 6 words = ~17%) has a matching whisper token; the rest
    # of the whisper words for this window are unrelated tokens.
    words_for_line = [
        TimedWord(token="xxxxx", start=20.0, end=20.3),
        TimedWord(token="yyyyy", start=20.3, end=20.6),
        TimedWord(token="here", start=20.6, end=20.9),
        TimedWord(token="zzzzz", start=20.9, end=21.2),
    ]
    with_words = _static_lines_to_chord_option(
        raw_lines, duration=240.0, name="Sheet 1",
        line_windows=[(20.0, 21.5)],
        line_words=[words_for_line],
    )
    without_words = _static_lines_to_chord_option(
        raw_lines, duration=240.0, name="Sheet 1",
        line_windows=[(20.0, 21.5)],
    )
    assert [w.start for w in with_words.lyrics[0].words] == [
        w.start for w in without_words.lyrics[0].words
    ]
    assert [w.end for w in with_words.lyrics[0].words] == [
        w.end for w in without_words.lyrics[0].words
    ]
    assert with_words.chords[0].start_time == without_words.chords[0].start_time


def test_repeated_chorus_line_matched_out_of_order_is_demoted() -> None:
    """A line whose accepted anchors would run backwards relative to the
    previous line (classic repeated-chorus mismatch) is demoted to window
    interpolation so global time stays non-decreasing."""
    lines = [
        _lyric("let it be", chords=[{"chord": "C", "position": 0}]),
        _lyric("let it be", chords=[{"chord": "G", "position": 0}]),
    ]
    line1_words = [
        TimedWord(token="let", start=10.0, end=10.3),
        TimedWord(token="it", start=10.3, end=10.6),
        TimedWord(token="be", start=10.6, end=11.0),
    ]
    # Individually valid for line2's own window+margin and internally
    # monotonic, but these times land *before* line1's already-accepted
    # anchors — the transcript matched the wrong occurrence of the chorus.
    line2_words = [
        TimedWord(token="let", start=10.6, end=10.7),
        TimedWord(token="it", start=10.7, end=10.8),
        TimedWord(token="be", start=10.8, end=10.9),
    ]
    option = _static_lines_to_chord_option(
        lines, duration=240.0, name="Sheet 1",
        line_windows=[(10.0, 11.0), (11.0, 12.0)],
        line_words=[line1_words, line2_words],
    )
    line1_lyrics, line2_lyrics = option.lyrics
    # Line 2 was demoted: its words land inside its own window (11.0-12.0),
    # not on the bad whisper times that overlap with line 1.
    assert line2_lyrics.words[0].start >= 11.0
    # Global monotonicity holds across the line boundary.
    assert line1_lyrics.words[-1].end <= line2_lyrics.words[0].start
    assert option.chords[0].start_time < option.chords[1].start_time


@pytest.mark.asyncio
async def test_recovered_times_are_still_snapped_to_beat_anchors(settings, storage):
    """Recovery (interpolation) happens first; beat snapping is the last
    step and still applies to whatever time recovery produced."""
    song_name = f"test_recovery_snap_{uuid.uuid4().hex[:8]}/test_song"
    static_chords_key = f"{song_name}/static_chords.json"

    # "three" (position 8) is the chord-carrying word; give it a wildly
    # out-of-window whisper time so recovery must reject and interpolate it
    # between "two" (ends 10.6) and "four" (starts 13.5), landing at 10.6.
    static_chords = {
        "lines": [
            {
                "type": "lyric",
                "text": "one two three four",
                "chords": [{"chord": "C", "position": 8}],
            },
        ],
    }
    lyrics_data = {
        "lyrics": [
            LyricsSegment(
                start=10.0, end=14.0, text="one two three four",
                words=[
                    LyricsWord(word="one", start=10.0, end=10.3),
                    LyricsWord(word="two", start=10.3, end=10.6),
                    LyricsWord(word="three", start=999.0, end=999.3),
                    LyricsWord(word="four", start=13.5, end=14.0),
                ],
            ),
        ],
    }

    song = SongRecord(
        id=uuid.uuid4(),
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
        title="Recovery Snap Test",
        song_name=song_name,
        static_chords_key=static_chords_key,
    )

    try:
        storage.write_json(static_chords_key, static_chords)

        # A beat anchor sits right next to where the recovered (interpolated)
        # chord time naturally lands (10.6) — it should snap there, and must
        # not be anywhere near the rejected 999.0 outlier.
        options, _tabs = _load_community_chord_options(
            storage, song, duration=240.0, lyrics_data=lyrics_data,
            autochord_chords=[
                ChordEntry(start_time=10.5, end_time=13.0, chord="C"),
            ],
            bar_starts=[],
        )
        assert options
        chord = options[0].chords[0]
        assert chord.start_time == 10.5
    finally:
        base = Path(settings.storage.base_path or "../local_bucket_test").resolve()
        shutil.rmtree(base / song_name.split("/")[0], ignore_errors=True)
