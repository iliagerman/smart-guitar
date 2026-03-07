"""Tests for the LRC parser."""

from lyrics_generator.lrc_parser import parse_lrc
from lyrics_generator.schemas import SegmentInfo


LRC_SAMPLE = """\
[00:12.34] First line of the song
[00:17.89] Second line here
[00:23.00] Third and final line
"""


def test_parse_lrc_basic():
    segments = parse_lrc(LRC_SAMPLE, total_duration=30.0)
    assert len(segments) == 3

    # First segment: 12.34 -> 17.89
    assert segments[0].start == 12.34
    assert segments[0].end == 17.89
    assert segments[0].text == "First line of the song"
    assert len(segments[0].words) == 5

    # Second segment: 17.89 -> 23.0
    assert segments[1].start == 17.89
    assert segments[1].end == 23.0
    assert segments[1].text == "Second line here"

    # Third segment: 23.0 -> 30.0 (total_duration)
    assert segments[2].start == 23.0
    assert segments[2].end == 30.0
    assert segments[2].text == "Third and final line"


def test_parse_lrc_word_distribution():
    segments = parse_lrc("[00:10.00] Hello world\n[00:15.00] Next line\n", total_duration=20.0)
    seg = segments[0]
    assert len(seg.words) == 2
    assert seg.words[0].word == "Hello"
    assert seg.words[0].start == 10.0
    assert seg.words[0].end == 12.5
    assert seg.words[1].word == "world"
    assert seg.words[1].start == 12.5
    assert seg.words[1].end == 15.0


def test_parse_lrc_no_total_duration():
    """Last line gets a 5s window when total_duration is not provided."""
    segments = parse_lrc("[00:10.00] Only line\n")
    assert len(segments) == 1
    assert segments[0].end == 15.0


def test_parse_lrc_milliseconds():
    """Handles 3-digit fractional seconds (milliseconds)."""
    segments = parse_lrc("[01:05.123] Millisecond precision\n", total_duration=70.0)
    assert len(segments) == 1
    assert segments[0].start == 65.123


def test_parse_lrc_empty_lines_skipped():
    lrc = "[00:01.00] Real line\n[00:05.00]  \n[00:10.00] Another real line\n"
    segments = parse_lrc(lrc, total_duration=15.0)
    # The empty line at 00:05 should be skipped
    assert len(segments) == 2
    assert segments[0].text == "Real line"
    assert segments[1].text == "Another real line"


def test_parse_lrc_empty_string():
    assert parse_lrc("") == []


def test_parse_lrc_no_valid_lines():
    assert parse_lrc("This is just plain text\nNo timestamps here\n") == []


def test_parse_lrc_single_word_line():
    segments = parse_lrc("[00:05.00] Hey\n", total_duration=10.0)
    assert len(segments) == 1
    assert len(segments[0].words) == 1
    assert segments[0].words[0].word == "Hey"
    assert segments[0].words[0].start == 5.0
    assert segments[0].words[0].end == 10.0
