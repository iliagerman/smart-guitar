"""Whisper invents lyrics over instrumental breaks; the vocals stem vetoes them.

Given silence, Whisper emits confident text — usually a repeat of a line it
already transcribed, or a stock phrase like "Thank you.". Timing-based checks
cannot catch this: the invented segments look perfectly ordinary, they are
just placed where nobody is singing.

Real case: Eddie Vedder - Society has a 40s instrumental between 104.3s and
144.8s. Whisper filled it with four segments. In the separated vocals stem
that whole stretch carries exactly 0% voiced frames, while every genuinely
sung line in the same song carries 53-100%.
"""

import numpy as np

from lyrics_generator.onset_aligner import drop_unvoiced_segments
from lyrics_generator.schemas import SegmentInfo, WordInfo

SR = 16000


def _voice(duration: float) -> np.ndarray:
    """A vocal-band tone standing in for singing."""
    t = np.arange(int(SR * duration)) / SR
    return (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)


def _silence(duration: float) -> np.ndarray:
    return np.zeros(int(SR * duration), dtype=np.float32)


def _segment(start: float, end: float, text: str) -> SegmentInfo:
    return SegmentInfo(
        start=start,
        end=end,
        text=text,
        words=[WordInfo(word=text.split()[0], start=start, end=end)],
    )


def _society_audio() -> np.ndarray:
    """Sung / silent / sung, mirroring Society's instrumental break."""
    return np.concatenate([_voice(10.0), _silence(10.0), _voice(10.0)])


def test_segment_over_silence_is_dropped():
    audio = _society_audio()
    segments = [
        _segment(2.0, 8.0, "I hope you're not lonely without me"),
        _segment(12.0, 18.0, "When you have more than you think"),
        _segment(22.0, 28.0, "There's those thinking more or less"),
    ]

    kept = drop_unvoiced_segments(segments, audio)

    assert [s.text for s in kept] == [
        "I hope you're not lonely without me",
        "There's those thinking more or less",
    ]


def test_sung_segments_are_all_kept():
    audio = _voice(30.0)
    segments = [_segment(float(i * 5), float(i * 5 + 4), f"line {i}") for i in range(6)]

    assert drop_unvoiced_segments(segments, audio) == segments


def test_a_segment_only_partly_over_silence_is_kept():
    """A line that starts just before the break is still sung."""
    audio = _society_audio()
    segments = [_segment(8.0, 13.0, "trailing into the break")]

    assert drop_unvoiced_segments(segments, audio) == segments


def test_a_silent_vocals_stem_drops_nothing():
    """A failed separation would otherwise wipe out every lyric in the song."""
    audio = _silence(30.0)
    segments = [_segment(float(i * 5), float(i * 5 + 4), f"line {i}") for i in range(6)]

    assert drop_unvoiced_segments(segments, audio) == segments


def test_empty_inputs_are_handled():
    assert drop_unvoiced_segments([], _voice(5.0)) == []
    segments = [_segment(0.0, 1.0, "hello")]
    assert drop_unvoiced_segments(segments, np.array([], dtype=np.float32)) == segments
