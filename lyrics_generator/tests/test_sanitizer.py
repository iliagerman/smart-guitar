"""Deterministic lyrics sanitizer tests.

The sanitizer is the last step before lyrics JSON is written. It enforces
structural integrity ONLY — ordering, overlap clamping, duplicate-region
collapse, word containment — and never rewrites transcribed text. This is
what guarantees the player's highlight can never jump backward.
"""

from lyrics_generator.sanitizer import sanitize_segments
from lyrics_generator.schemas import SegmentInfo, WordInfo


def seg(start: float, end: float, text: str, words: list[WordInfo] | None = None) -> SegmentInfo:
    return SegmentInfo(start=start, end=end, text=text, words=words or [])


def test_clean_input_passes_through_verbatim():
    segments = [
        seg(0.0, 2.0, "hello world", [WordInfo("hello", 0.0, 0.9), WordInfo("world", 1.0, 1.9)]),
        seg(2.5, 4.0, "second line", [WordInfo("second", 2.5, 3.0), WordInfo("line", 3.1, 3.9)]),
    ]
    out = sanitize_segments(segments)
    assert [(s.start, s.end, s.text) for s in out] == [
        (0.0, 2.0, "hello world"),
        (2.5, 4.0, "second line"),
    ]
    assert [(w.word, w.start, w.end) for w in out[0].words] == [
        ("hello", 0.0, 0.9), ("world", 1.0, 1.9),
    ]


def test_out_of_order_segments_are_sorted():
    segments = [
        seg(10.0, 12.0, "later line"),
        seg(0.0, 2.0, "first line"),
        seg(5.0, 7.0, "middle line"),
    ]
    out = sanitize_segments(segments)
    assert [s.text for s in out] == ["first line", "middle line", "later line"]
    starts = [s.start for s in out]
    assert starts == sorted(starts)


def test_overlapping_segments_are_clamped_monotonic():
    segments = [
        seg(0.0, 5.0, "first"),
        seg(3.0, 8.0, "second"),  # starts before previous ends
    ]
    out = sanitize_segments(segments)
    assert len(out) == 2
    assert out[1].start >= out[0].end
    assert out[1].end >= out[1].start


def test_duplicate_text_same_time_region_collapsed():
    """The same audio region transcribed twice is an artifact — keep one."""
    segments = [
        seg(10.0, 14.0, "Knocking on heaven's door"),
        seg(10.2, 14.1, "knocking on heaven's door"),
    ]
    out = sanitize_segments(segments)
    assert len(out) == 1
    assert out[0].text == "Knocking on heaven's door"


def test_duplicate_text_at_different_times_preserved():
    """A chorus line legitimately repeats — never drop content."""
    segments = [
        seg(10.0, 13.0, "knocking on heaven's door"),
        seg(20.0, 23.0, "knocking on heaven's door"),
    ]
    out = sanitize_segments(segments)
    assert len(out) == 2


def test_empty_text_segments_dropped():
    segments = [seg(0.0, 2.0, "   "), seg(3.0, 4.0, "real line"), seg(5.0, 6.0, "")]
    out = sanitize_segments(segments)
    assert [s.text for s in out] == ["real line"]


def test_inverted_segment_times_fixed():
    segments = [seg(5.0, 2.0, "backwards segment")]
    out = sanitize_segments(segments)
    assert len(out) == 1
    assert out[0].end >= out[0].start


def test_words_sorted_and_clamped_into_segment():
    segments = [
        seg(10.0, 14.0, "one two three", [
            WordInfo("two", 11.0, 11.5),
            WordInfo("one", 10.0, 10.5),
            WordInfo("three", 13.0, 99.0),  # end way outside the segment
        ]),
    ]
    out = sanitize_segments(segments)
    words = out[0].words
    assert [w.word for w in words] == ["two", "one", "three"] or [w.word for w in words] == ["one", "two", "three"]
    # Words must be time-sorted and contained in the segment.
    starts = [w.start for w in words]
    assert starts == sorted(starts)
    for w in words:
        assert out[0].start <= w.start <= out[0].end
        assert out[0].start <= w.end <= out[0].end
        assert w.end >= w.start


def test_overlapping_words_made_monotonic():
    segments = [
        seg(0.0, 4.0, "aa bb", [WordInfo("aa", 0.0, 2.0), WordInfo("bb", 1.0, 3.0)]),
    ]
    out = sanitize_segments(segments)
    w = out[0].words
    assert w[1].start >= w[0].end


def test_degenerate_token_runs_are_thinned_to_singable_rate():
    """221 'you's in 15s (~14 words/sec) is decoder degeneration, not singing.
    The run must be thinned to a plausible rate across the same time window."""
    n = 221
    start, end = 11.8, 27.3
    dur = (end - start) / n
    words = [WordInfo("you", start + i * dur, start + (i + 1) * dur) for i in range(n)]
    segments = [seg(start, end, " ".join(["you"] * n), words)]

    out = sanitize_segments(segments)
    assert len(out) == 1
    thinned = out[0].words
    # Capped to a sane rate (<= ~4 tokens/sec over 15.5s ≈ 62) but not erased.
    assert 4 <= len(thinned) <= 65
    # Window preserved.
    assert thinned[0].start == start
    assert abs(thinned[-1].end - end) < 0.5
    # Text rebuilt to match the thinned words.
    assert out[0].text == " ".join(w.word for w in thinned)


def test_real_chant_runs_are_preserved():
    """'La la la' sung at ~300ms per word is real content — never thinned."""
    n = 20
    start = 10.0
    words = [WordInfo("la", start + i * 0.3, start + (i + 1) * 0.3) for i in range(n)]
    segments = [seg(start, start + n * 0.3, " ".join(["la"] * n), words)]

    out = sanitize_segments(segments)
    assert len(out[0].words) == n
    assert out[0].text == " ".join(["la"] * n)


def test_sanitize_is_idempotent():
    segments = [
        seg(10.0, 12.0, "later"),
        seg(0.0, 5.0, "first"),
        seg(3.0, 8.0, "overlapping"),
        seg(0.0, 0.0, ""),
    ]
    once = sanitize_segments(segments)
    twice = sanitize_segments(once)
    assert [(s.start, s.end, s.text) for s in once] == [
        (s.start, s.end, s.text) for s in twice
    ]


def test_write_lyrics_json_applies_sanitizer(tmp_path):
    """write_lyrics_json is the single output choke point — it must sanitize."""
    import json

    from lyrics_generator.openai_transcriber import write_lyrics_json

    segments = [
        seg(10.0, 12.0, "second line"),
        seg(0.0, 2.0, "first line"),
    ]
    out_file = tmp_path / "lyrics.json"
    write_lyrics_json(segments, str(out_file), source="whisper")
    data = json.loads(out_file.read_text())
    texts = [s["text"] for s in data["segments"]]
    assert texts == ["first line", "second line"]
    assert data["source"] == "whisper"
