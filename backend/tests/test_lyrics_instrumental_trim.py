"""Lyric lines must not hold over instrumental breaks.

Upstream lyrics sources have no end timestamps: LRC ends a line where the
next line starts, and Songsterr spreads lines evenly across whole sections.
A line followed by a solo therefore swallows the solo, stays highlighted
over music nobody sings to, and hides the instrumental gap from the
skip-instrumentals feature.

`parse_lyrics_payload` is the single read path every lyrics source reaches
the player through, so it bounds each line to a plausible sung duration.
"""

from guitar_player.services.song_service.helpers import parse_lyrics_payload


def _payload(segments: list[dict]) -> dict:
    return {"segments": segments, "source": "lrclib_quick_synced"}


def _words(pairs: list[tuple[str, float, float]]) -> list[dict]:
    return [{"word": w, "start": s, "end": e} for w, s, e in pairs]


def test_line_stretched_over_a_solo_is_cut_back_to_its_sung_length():
    """A 7-word line running 48s over a guitar solo keeps only its sung part.

    Real case: Eddie Vedder - Society. LRCLIB marks the solo with a blank
    `[01:44.31]` line; the parser dropped it, so "I hope you're not lonely
    without me" ran 96.29 -> 144.82.
    """
    segments, _, _ = parse_lyrics_payload(
        _payload(
            [
                {
                    "start": 96.29,
                    "end": 144.82,
                    "text": "I hope you're not lonely without me",
                    "words": _words(
                        [
                            ("I", 99.9, 100.1),
                            ("hope", 100.1, 105.3),
                            ("you're", 106.3, 107.2),
                            ("not", 107.6, 129.2),
                            ("lonely", 131.2, 132.5),
                            ("without", 132.6, 141.1),
                            ("me", 144.8, 144.82),
                        ]
                    ),
                },
                {"start": 144.82, "end": 149.6, "text": "There's those thinking", "words": []},
            ]
        )
    )

    # 7 words * 2.5s = 17.5s budget, so the line ends around 113.8 instead of 144.82.
    assert segments[0].end < 120.0
    assert segments[0].end > segments[0].start
    # The solo is now a real gap the player can see.
    assert segments[1].start - segments[0].end > 25.0


def test_no_word_stays_highlighted_through_the_break():
    """The word "not" was held 21.6s across the solo; nothing may exceed 5s."""
    segments, _, _ = parse_lyrics_payload(
        _payload(
            [
                {
                    "start": 96.29,
                    "end": 144.82,
                    "text": "I hope you're not lonely without me",
                    "words": _words(
                        [
                            ("I", 99.9, 100.1),
                            ("hope", 100.1, 105.3),
                            ("you're", 106.3, 107.2),
                            ("not", 107.6, 129.2),
                            ("lonely", 131.2, 132.5),
                            ("without", 132.6, 141.1),
                            ("me", 144.8, 144.82),
                        ]
                    ),
                }
            ]
        )
    )

    for word in segments[0].words:
        assert word.end - word.start <= 5.0, f"{word.word!r} held {word.end - word.start:.1f}s"


def test_trimmed_line_keeps_every_word_inside_its_new_bounds():
    """Words stretched past the trim point are refitted, never dropped."""
    segments, _, _ = parse_lyrics_payload(
        _payload(
            [
                {
                    "start": 96.29,
                    "end": 144.82,
                    "text": "I hope you're not lonely without me",
                    "words": _words(
                        [
                            ("I", 99.9, 100.1),
                            ("hope", 100.1, 105.3),
                            ("you're", 106.3, 107.2),
                            ("not", 107.6, 129.2),
                            ("lonely", 131.2, 132.5),
                            ("without", 132.6, 141.1),
                            ("me", 144.8, 144.82),
                        ]
                    ),
                }
            ]
        )
    )

    segment = segments[0]
    assert [w.word for w in segment.words] == [
        "I", "hope", "you're", "not", "lonely", "without", "me",
    ]
    for word in segment.words:
        assert segment.start <= word.start < word.end <= segment.end
    starts = [w.start for w in segment.words]
    assert starts == sorted(starts)


def test_last_line_running_to_the_end_of_the_audio_is_cut_back():
    """LRC gives the final line no end, so it inherits the whole outro."""
    segments, _, _ = parse_lyrics_payload(
        _payload([{"start": 217.7, "end": 236.78, "text": "Without me", "words": []}])
    )

    # 2 words -> the 5s floor applies, not 2 * 2.5s.
    assert segments[0].end == 222.7


def test_wordless_songsterr_line_is_bounded_by_its_text():
    """Songsterr writes no word timings at all; the text still bounds the line."""
    segments, _, _ = parse_lyrics_payload(
        {
            "segments": [
                {"start": 0.0, "end": 326.0, "text": "Come with it now", "words": []}
            ],
            "source": "songsterr",
        }
    )

    # 4 words * 2.5s = 10s.
    assert segments[0].end == 10.0


def test_correctly_timed_lines_are_left_exactly_as_they_are():
    """Whisper lines with real end times must not be touched."""
    raw = [
        {
            "start": 22.8,
            "end": 27.94,
            "text": "And you think you have to want more than you need",
            "words": _words(
                [
                    ("And", 22.8, 23.1), ("you", 23.1, 23.4), ("think", 23.4, 23.8),
                    ("you", 23.8, 24.1), ("have", 24.1, 24.5), ("to", 24.5, 24.7),
                    ("want", 24.7, 25.2), ("more", 25.2, 25.7), ("than", 25.7, 26.1),
                    ("you", 26.1, 26.5), ("need", 26.5, 27.94),
                ]
            ),
        }
    ]
    segments, _, _ = parse_lyrics_payload(_payload(raw))

    assert segments[0].start == 22.8
    assert segments[0].end == 27.94
    assert [(w.word, w.start, w.end) for w in segments[0].words] == [
        (w["word"], w["start"], w["end"]) for w in raw[0]["words"]
    ]


def test_a_single_held_note_is_not_clipped():
    """One word sung over 4s is real singing, not a stuck highlight."""
    segments, _, _ = parse_lyrics_payload(
        _payload(
            [{"start": 10.0, "end": 14.5, "text": "Ohhh", "words": _words([("Ohhh", 10.0, 14.5)])}]
        )
    )

    assert segments[0].end == 14.5
    assert segments[0].words[0].end == 14.5


def test_refitted_words_are_not_themselves_over_held():
    """Refitting the stretched tail must not recreate the stuck highlight.

    A long line trimmed by only a little leaves a lot of room for a single
    orphaned word, which would otherwise be handed a 30s hold.
    """
    words = [("word%d" % i, 10.0 + i * 0.5, 10.5 + i * 0.5) for i in range(20)]
    words.append(("last", 95.0, 100.0))
    segments, _, _ = parse_lyrics_payload(
        _payload(
            [
                {
                    "start": 10.0,
                    "end": 100.0,
                    "text": " ".join(w for w, _, _ in words),
                    "words": _words(words),
                }
            ]
        )
    )

    segment = segments[0]
    assert len(segment.words) == 21
    for word in segment.words:
        assert word.end - word.start <= 5.0, f"{word.word!r} held {word.end - word.start:.1f}s"


def test_empty_payload_still_returns_nothing():
    assert parse_lyrics_payload({"no_segments": True}) == ([], None, None)
