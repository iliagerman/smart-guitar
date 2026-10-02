"""Which strokes of the bar the rhythm part hits hardest, measured on its stems.

Each bar of the beat grid is split into eighth notes (1 & 2 & 3 & 4 &). A
slot's strength is the peak spectral flux of the guitar + "other" stems
(strummed parts, mandolin, keys) at that eighth, divided by the bar's mean,
so loud and quiet passages count alike. The flux is taken on the linear
magnitude spectrum: on a dB spectrum (librosa's default onset strength) a
stroke five times as hard barely registers as stronger. The quietest quarter of the bars
(intros, breaks) is left out, and each slot's typical strength is its
median over the rest. The strongest slot is an accent when it is typically at
least ACCENT_STRENGTH times the bar's average, and the runner-up too when it
reaches SECOND_ACCENT_STRENGTH. An even strum has none.

Checked by ear on Losing My Religion (2 and the "&" of 3), Wonderwall (2),
Let It Be (1 and 3) and When I Come Around (the "&" of 1).
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

SAMPLE_RATE = 22050
HOP = 256
STEPS_PER_BEAT = 2
ACCENT_STRENGTH = 1.15
# Once one stroke stands out, a second needs less: Losing My Religion's beat 2
# measures 1.12 next to its "&" of 3 at 1.26 on one of its recordings.
SECOND_ACCENT_STRENGTH = 1.10
_SLOT_WINDOW_S = 0.035
_DOWNBEAT_TOLERANCE_S = 0.05
_QUIET_BAR_PERCENTILE = 25
_MIN_BARS = 8


@dataclass(frozen=True)
class StrumAccents:
    beats_per_bar: int
    steps_per_beat: int
    accents: list[bool]
    strength: list[float]  # typical strength per slot, 1.0 = the bar's average
    bars: int  # bars measured

    def to_json(self) -> dict:
        return {
            "beats_per_bar": self.beats_per_bar,
            "steps_per_beat": self.steps_per_beat,
            "accents": self.accents,
            "strength": [round(s, 3) for s in self.strength],
            "bars": self.bars,
        }


def detect_strum_accents(
    stem_paths: list[str], beat_times: list[float], downbeat_times: list[float], beats_per_bar: int,
) -> StrumAccents | None:
    """Accents of the rhythm stems on the beat grid; None with too few full bars to tell."""
    audio = _mixed(stem_paths)
    onset = _linear_flux(audio)
    times = librosa.frames_to_time(np.arange(len(onset)), sr=SAMPLE_RATE, hop_length=HOP)
    bars = np.array([
        [_peak(onset, times, t) for t in slots]
        for slots in _bar_slots(np.asarray(beat_times), np.asarray(downbeat_times), beats_per_bar)
    ])
    if len(bars) < _MIN_BARS:
        return None
    energy = bars.mean(axis=1)
    loud = energy > max(np.percentile(energy, _QUIET_BAR_PERCENTILE), 0.0)
    if loud.sum() < _MIN_BARS:
        return None
    strength = np.median(bars[loud] / energy[loud, None], axis=0)
    return StrumAccents(
        beats_per_bar=beats_per_bar, steps_per_beat=STEPS_PER_BEAT,
        accents=pick_accents([float(x) for x in strength]), strength=[float(x) for x in strength], bars=int(loud.sum()),
    )


def pick_accents(strength: list[float]) -> list[bool]:
    """The strongest slot when it reaches ACCENT_STRENGTH, and the runner-up when it reaches SECOND_ACCENT_STRENGTH."""
    order = sorted(range(len(strength)), key=lambda i: -strength[i])
    accents = [False] * len(strength)
    if not order or strength[order[0]] < ACCENT_STRENGTH:
        return accents
    accents[order[0]] = True
    if len(order) > 1 and strength[order[1]] >= SECOND_ACCENT_STRENGTH:
        accents[order[1]] = True
    return accents


def _mixed(stem_paths: list[str]) -> np.ndarray:
    tracks = [librosa.load(path, sr=SAMPLE_RATE, mono=True)[0] for path in stem_paths]
    mix = np.zeros(max(len(t) for t in tracks))
    for track in tracks:
        mix[:len(track)] += track
    return mix


def _linear_flux(audio: np.ndarray) -> np.ndarray:
    """Summed rise in mel-band magnitude per frame."""
    magnitude = np.sqrt(librosa.feature.melspectrogram(y=audio, sr=SAMPLE_RATE, hop_length=HOP, n_mels=64))
    return np.maximum(0.0, np.diff(magnitude, axis=1, prepend=magnitude[:, :1])).sum(axis=0)


def _bar_slots(beats: np.ndarray, downbeats: np.ndarray, beats_per_bar: int) -> list[list[float]]:
    """Eighth-note times of every bar that has exactly beats_per_bar tracked beats."""
    out = []
    for start, end in zip(downbeats[:-1], downbeats[1:]):
        in_bar = beats[(beats >= start - _DOWNBEAT_TOLERANCE_S) & (beats < end - _DOWNBEAT_TOLERANCE_S)]
        if len(in_bar) != beats_per_bar:
            continue
        edges = [*in_bar, end]
        out.append([t for a, b in zip(edges[:-1], edges[1:]) for t in (a, (a + b) / 2)])
    return out


def _peak(onset: np.ndarray, times: np.ndarray, at: float) -> float:
    window = onset[(times >= at - _SLOT_WINDOW_S) & (times <= at + _SLOT_WINDOW_S)]
    return float(window.max()) if len(window) else 0.0
