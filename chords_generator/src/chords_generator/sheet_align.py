"""Line a chord sheet up with the audio: chord names from the sheet, timing from the beats.

A community chord sheet knows which chords a song plays and in what order,
but not when. The chord model's per-beat probabilities know roughly when.
This walks the song beat by beat through the sheet's chord sequence
(Viterbi): each beat either stays on the current sheet chord, moves on to the
next one, or jumps to the start of any sheet line, so a chorus written once
and played three times, or a skipped verse, still lines up. Moves cost what
chord changes cost in beat_decode (cheapest on beat 1); jumps cost more.

Every transposition is tried, since sheets are often written for a capo.
A sheet is only used when it explains the audio nearly as well as the
unconstrained detection does; otherwise it is the wrong song, version or key.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np

from chords_generator.beat_decode import BeatSteps, decode_steps
from chords_generator.schemas import ChordResult

# Extra log-probability a jump to another sheet line costs, on top of a change.
JUMP_COST = 3.0
# Accept the sheet when its alignment loses at most this much log-probability
# per beat against the unconstrained detection.
MAX_LOSS_PER_BEAT = 0.35

_PITCH = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_CHORD_RE = re.compile(r"^([A-G])([#b]?)([^/]*)(?:/([A-G][#b]?))?$")
# Sheet chord suffix -> the model's qualities that sound like it (best first).
_QUALITY_FOR_SUFFIX: list[tuple[str, tuple[str, ...]]] = [
    ("m7b5", ("hdim7",)), ("ø", ("hdim7",)), ("dim7", ("dim7", "dim")), ("dim", ("dim", "dim7")), ("°", ("dim",)),
    ("mmaj7", ("minmaj7", "min")), ("mM7", ("minmaj7", "min")), ("maj7", ("maj7", "maj")), ("M7", ("maj7", "maj")),
    ("m7", ("min7", "min")), ("m9", ("min7", "min")), ("m11", ("min7", "min")), ("m6", ("min6", "min")),
    ("madd9", ("min",)), ("m", ("min", "min7")), ("min", ("min", "min7")),
    ("7sus4", ("sus4", "7")), ("7sus2", ("sus2", "7")), ("sus4", ("sus4", "maj")), ("sus2", ("sus2", "maj")),
    ("sus", ("sus4", "maj")), ("aug", ("aug", "maj")), ("+", ("aug", "maj")),
    ("13", ("7", "maj")), ("11", ("7", "sus4")), ("9", ("7", "maj")), ("7", ("7", "maj")),
    ("6", ("maj6", "maj")), ("add9", ("maj", "sus2")), ("5", ("maj", "min")),
    # Israeli sheets (Tab4U) write sus4 / sus2 as a bare 4 / 2: "B4".
    ("4", ("sus4", "maj")), ("2", ("sus2", "maj")), ("", ("maj", "maj7")),
]


@dataclass(frozen=True)
class SheetChord:
    name: str  # as written, e.g. "D7sus2", "C/G"
    line: int  # index of the sheet line it is on


@dataclass
class Alignment:
    chords: list[ChordResult]
    transpose: int  # semitones from the sheet as written to the recording
    loss_per_beat: float  # log-probability per beat given up against free detection

    @property
    def accepted(self) -> bool:
        return self.loss_per_beat <= MAX_LOSS_PER_BEAT


def parse_chord(name: str) -> tuple[int, str, int | None] | None:
    """(root pitch class, suffix, bass pitch class) for a written chord, None if unreadable."""
    match = _CHORD_RE.match(name.strip())
    if not match:
        return None
    letter, accidental, suffix, bass = match.groups()
    root = (_PITCH[letter] + {"#": 1, "b": -1, "": 0}[accidental]) % 12
    bass_pc = None
    if bass:
        bass_pc = (_PITCH[bass[0]] + {"#": 1, "b": -1, "": 0}[bass[1:]]) % 12
    return root, suffix.strip(), bass_pc


def transpose_name(name: str, semitones: int) -> tuple[str, str | None]:
    """(chord without bass, bass note) of a written chord moved by ``semitones``, spelled with sharps."""
    parsed = parse_chord(name)
    if parsed is None:
        return name, None
    root, suffix, bass = parsed
    bass_name = _SHARPS[(bass + semitones) % 12] if bass is not None else None
    return _SHARPS[(root + semitones) % 12] + suffix, bass_name


def _label_columns(name: str, labels: list[str]) -> list[int]:
    """Model labels a written chord can be heard as (transposition 0)."""
    parsed = parse_chord(name)
    if parsed is None:
        return []
    root, suffix, _ = parsed
    qualities = next((q for s, q in _QUALITY_FOR_SUFFIX if suffix.startswith(s)), ("maj",))
    index = {label: i for i, label in enumerate(labels)}
    return [index[f"{_SHARPS[root]}:{q}"] for q in qualities if f"{_SHARPS[root]}:{q}" in index]


def _sheet_emissions(steps_log_probs: np.ndarray, sheet: list[SheetChord], labels: list[str], shift: int) -> np.ndarray:
    """(steps, sheet chords) log-probability of each sheet chord, moved ``shift`` semitones, at each step."""
    out = np.full((steps_log_probs.shape[0], len(sheet)), -30.0)
    shifted_labels = _shift_labels(labels, -shift)
    for j, chord in enumerate(sheet):
        cols = _label_columns(chord.name, shifted_labels)
        if cols:
            out[:, j] = steps_log_probs[:, cols].max(axis=1)
    return out


def _shift_labels(labels: list[str], semitones: int) -> list[str]:
    """Labels renamed as if every root moved ``semitones``; column order is kept."""
    out = []
    for label in labels:
        if ":" not in label:
            out.append(label)
            continue
        root, quality = label.split(":", 1)
        out.append(f"{_SHARPS[(_SHARPS.index(root) + semitones) % 12]}:{quality}")
    return out


def _walk(emissions: np.ndarray, no_chord: np.ndarray, change_cost: np.ndarray, line_starts: np.ndarray):
    """Viterbi over [no chord before, sheet chords..., no chord after]. Returns (path, score)."""
    steps, chords = emissions.shape
    pre, post = 0, chords + 1
    states = chords + 2
    em = np.concatenate([no_chord[:, None], emissions, no_chord[:, None]], axis=1)
    jump_target = np.zeros(states, dtype=bool)
    jump_target[1 + line_starts] = True
    score = np.full(states, -np.inf)
    score[pre] = em[0, pre]
    score[1 + line_starts] = em[0, 1 + line_starts] - JUMP_COST
    back = np.zeros((steps, states), dtype=np.int32)
    for k in range(1, steps):
        cost = change_cost[k]
        stay = score.copy()
        stay_from = np.arange(states)
        # Move on to the next sheet chord (pre -> first chord, last chord -> post).
        advance = np.full(states, -np.inf)
        advance[1:] = score[:-1] - cost
        # Jump to the start of any line, from anywhere in the sheet (or the intro).
        best = int(np.argmax(score[:post]))
        jump = np.where(jump_target, score[best] - cost - JUMP_COST, -np.inf)
        # The outro can be entered from any chord.
        last_chord = int(np.argmax(score[1:post])) + 1
        to_post = score[last_chord] - cost
        candidates = np.stack([stay, advance, jump])
        choice = candidates.argmax(axis=0)
        new = candidates.max(axis=0)
        frm = np.where(choice == 0, stay_from, np.where(choice == 1, stay_from - 1, best))
        if to_post > new[post]:
            new[post], frm[post] = to_post, last_chord
        back[k] = frm
        score = new + em[k]
    path = np.empty(steps, dtype=np.int32)
    path[-1] = int(np.argmax(score))
    final = float(score[path[-1]])
    for k in range(steps - 1, 0, -1):
        path[k - 1] = back[k, path[k]]
    return path, final


def sheet_sequence(lines: list[dict]) -> list[SheetChord]:
    """Chords of a static_chords.json version, in reading order."""
    out: list[SheetChord] = []
    for i, line in enumerate(lines):
        for chord in line.get("chords") or []:
            name = (chord.get("chord") or "").strip()
            if parse_chord(name):
                out.append(SheetChord(name=name, line=i))
    return out


def align_sheet(
    steps: BeatSteps, steps_log_probs: np.ndarray, sheet: list[SheetChord], labels: list[str],
) -> Alignment | None:
    """Best alignment of ``sheet`` over all transpositions; None for an empty sheet."""
    if len(sheet) < 2:
        return None
    weights = steps.weights()
    weighted = steps_log_probs * weights
    change_cost = steps.change_cost()
    no_chord = weighted[:, labels.index("N")]
    line_starts = np.array(sorted({j for j, c in enumerate(sheet) if j == 0 or sheet[j - 1].line != c.line}))

    best: tuple[float, int, np.ndarray] | None = None
    for shift in range(12):
        em = _sheet_emissions(weighted, sheet, labels, shift)
        path, score = _walk(em, no_chord, change_cost, line_starts)
        if best is None or score > best[0]:
            best = (score, shift, path)
    score, shift, path = best

    free = decode_steps(steps, labels, steps_log_probs)
    free_score = _path_score(free, steps, weighted, labels, change_cost)
    beats = max(len(path) - 1, 1)

    chords: list[ChordResult] = []
    for k, state in enumerate(path):
        if state == 0 or state == len(sheet) + 1:
            name, bass = "N", None
        else:
            name, bass = transpose_name(sheet[state - 1].name, shift)
        start, end = steps.edges[k], steps.edges[k + 1]
        if chords and chords[-1].chord == name and chords[-1].bass == bass:
            chords[-1].end_time = end
        else:
            chords.append(ChordResult(start_time=start, end_time=end, chord=name, bass=bass))
    return Alignment(chords=chords, transpose=shift, loss_per_beat=(free_score - score) / beats)


def _path_score(chords: list[ChordResult], steps: BeatSteps, weighted: np.ndarray, labels: list[str], change_cost: np.ndarray) -> float:
    index = {label: i for i, label in enumerate(labels)}
    total, previous = 0.0, None
    for k, start in enumerate(steps.edges[:-1]):
        chord = next(c for c in chords if c.start_time <= start < c.end_time)
        total += weighted[k, index[chord.chord]]
        if previous is not None and chord.chord != previous:
            total -= change_cost[k]
        previous = chord.chord
    return total


def best_alignment(
    log_probs: np.ndarray, frame_s: float, meta: dict, versions: list[dict], labels: list[str],
) -> tuple[Alignment, dict] | None:
    """The best-fitting sheet version, by loss per beat, with that version; None without a beat grid or sheet."""
    from chords_generator.beat_decode import beat_steps, share_repeats

    duration = len(log_probs) * frame_s
    steps = beat_steps(log_probs, frame_s, meta.get("beat_times") or [], meta.get("downbeat_times") or [], duration)
    if steps is None:
        return None
    shared = share_repeats(steps)
    best: tuple[Alignment, dict] | None = None
    for version in versions:
        alignment = align_sheet(steps, shared, sheet_sequence(version.get("lines") or []), labels)
        if alignment and (best is None or alignment.loss_per_beat < best[0].loss_per_beat):
            best = (alignment, version)
    return best
