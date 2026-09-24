"""Remove lyric lines Whisper invented over instrumental breaks.

Whisper does not fall silent when the singer does. Over a solo it emits
confident text -- usually a repeat of a line it already transcribed, or a
stock phrase like "Thank you.". Nothing in the timing gives that away, so
the player highlights those lines over music nobody is singing to.

The separated vocals stem does give it away: an invented segment sits over
frames with no vocal energy at all. This rewrites stored lyrics.json files
with those segments removed.

`lyrics_generator.onset_aligner.drop_unvoiced_segments` applies the same rule
to newly transcribed songs; this is the one-off pass over songs transcribed
before that existed.

Usage:
    cd backend && uv run --with numpy python scripts/backfill_unvoiced_lyrics.py           # dry run
    cd backend && uv run --with numpy python scripts/backfill_unvoiced_lyrics.py --apply
    cd backend && APP_ENV=prod uv run --with numpy python scripts/backfill_unvoiced_lyrics.py --apply
"""

import argparse
import logging
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass

import numpy as np

from guitar_player.config import load_settings
from guitar_player.storage import StorageBackend, create_storage

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
HOP_S = 0.010
WIN_S = 0.025
VOCAL_LOW_HZ = 250.0
VOCAL_HIGH_HZ = 4000.0
TRANSITION_HZ = 50.0

# Share of a segment's frames that must carry vocal energy for it to be real
# singing. Measured over 3,659 transcribed segments from 120 songs: genuine
# lines sit at 41% and above (10th percentile), while 5.5% score exactly 0%.
MIN_VOICED_RATIO = 0.05

# Below this the stem carries no usable signal (failed separation, or a
# full-mix fallback). Gating on it would delete the song's entire lyrics.
MIN_USABLE_VOICED_RATIO = 0.02

# Untouched copy written beside each rewritten lyrics.json.
BACKUP_NAME = "lyrics.pre_vad.json"


@dataclass
class SongResult:
    key: str
    total: int
    dropped: list[tuple[float, float, str]]
    skipped: str | None = None


def _decode_mono_16k(path: str) -> np.ndarray:
    """Decode any audio file to mono float32 at 16kHz via ffmpeg."""
    result = subprocess.run(
        ["ffmpeg", "-v", "quiet", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"],
        capture_output=True,
    )
    return np.frombuffer(result.stdout, dtype=np.float32)


def _bandpass(samples: np.ndarray) -> np.ndarray:
    """Keep the vocal band, so guitar bleed doesn't read as singing."""
    n = len(samples)
    freqs = np.fft.rfftfreq(n, d=1.0 / SAMPLE_RATE)
    fft = np.fft.rfft(samples)

    low_start = max(0.0, VOCAL_LOW_HZ - TRANSITION_HZ)
    high_end = VOCAL_HIGH_HZ + TRANSITION_HZ
    gain = np.ones_like(freqs)
    gain[freqs < low_start] = 0.0
    taper = (freqs >= low_start) & (freqs < VOCAL_LOW_HZ)
    gain[taper] = 0.5 * (1.0 - np.cos(np.pi * (freqs[taper] - low_start) / TRANSITION_HZ))
    taper = (freqs > VOCAL_HIGH_HZ) & (freqs <= high_end)
    gain[taper] = 0.5 * (1.0 + np.cos(np.pi * (freqs[taper] - VOCAL_HIGH_HZ) / TRANSITION_HZ))
    gain[freqs > high_end] = 0.0

    return np.fft.irfft(fft * gain, n=n).astype(np.float32)


def _voiced_mask(samples: np.ndarray) -> np.ndarray:
    """Per-10ms-frame mask of where the vocals stem actually carries voice."""
    filtered = _bandpass(samples)
    hop = int(HOP_S * SAMPLE_RATE)
    win = int(WIN_S * SAMPLE_RATE)
    if len(filtered) < win:
        return np.array([], dtype=bool)

    n_frames = (len(filtered) - win) // hop + 1
    frames = np.lib.stride_tricks.sliding_window_view(filtered, win)[np.arange(n_frames) * hop]
    rms = np.sqrt(np.mean(np.square(frames), axis=1, dtype=np.float64) + 1e-10)
    energy = 20.0 * np.log10(rms + 1e-10)

    threshold = float(np.median(energy)) + 0.3 * (float(np.mean(energy)) - float(np.median(energy)))
    return energy >= threshold


def _voiced_ratio(mask: np.ndarray, start: float, end: float) -> float:
    first = max(0, min(int(start / HOP_S), len(mask)))
    last = max(first + 1, min(int(end / HOP_S), len(mask)))
    if first >= len(mask):
        return 0.0
    return float(mask[first:last].mean())


def _process_song(storage: StorageBackend, lyrics_key: str, apply: bool) -> SongResult:
    song_dir = os.path.dirname(lyrics_key)
    vocals_key = f"{song_dir}/vocals.mp3"
    backup_key = f"{song_dir}/{BACKUP_NAME}"

    # A backup means an earlier run already rewrote this song. Skip before
    # downloading the stem, so an interrupted pass resumes cheaply.
    if apply and storage.file_exists(backup_key):
        return SongResult(lyrics_key, 0, [], skipped="already done")

    if not storage.file_exists(vocals_key):
        return SongResult(lyrics_key, 0, [], skipped="no vocals stem")

    payload = storage.read_json(lyrics_key)
    if not isinstance(payload, dict) or not payload.get("segments"):
        return SongResult(lyrics_key, 0, [], skipped="no segments")
    segments = payload["segments"]

    with tempfile.TemporaryDirectory() as tmp:
        local_vocals = os.path.join(tmp, "vocals.mp3")
        storage.download_to_local(vocals_key, local_vocals)
        audio = _decode_mono_16k(local_vocals)

    if len(audio) == 0:
        return SongResult(lyrics_key, len(segments), [], skipped="undecodable vocals")

    mask = _voiced_mask(audio)
    if len(mask) < 2 or float(mask.mean()) < MIN_USABLE_VOICED_RATIO:
        return SongResult(lyrics_key, len(segments), [], skipped="vocals stem has no usable signal")

    kept = []
    dropped = []
    for segment in segments:
        if _voiced_ratio(mask, segment["start"], segment["end"]) >= MIN_VOICED_RATIO:
            kept.append(segment)
        else:
            dropped.append((segment["start"], segment["end"], segment["text"]))

    if dropped and apply:
        # The audio bucket is not versioned, so keep the original alongside —
        # restoring a song is then a copy, not a re-transcription.
        storage.write_json(backup_key, payload)
        payload["segments"] = kept
        storage.write_json(lyrics_key, payload)

    return SongResult(lyrics_key, len(segments), dropped)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    parser.add_argument("--limit", type=int, default=0, help="process at most N songs")
    parser.add_argument("--song", default="", help="only songs whose key contains this substring")
    parser.add_argument("--verbose", action="store_true", help="print every dropped line")
    args = parser.parse_args()

    settings = load_settings()
    storage = create_storage(settings)
    storage.init()

    # Storage, not the song table: the prod database sits inside the VPC and
    # is unreachable from a developer machine, while the bucket is not.
    keys = sorted(k for k in storage.list_files("") if k.endswith("/lyrics.json"))
    if args.song:
        keys = [k for k in keys if args.song in k]
    if args.limit:
        keys = keys[: args.limit]

    mode = "APPLY" if args.apply else "DRY RUN"
    logger.info("%s: %d songs with lyrics.json", mode, len(keys))

    songs_changed = 0
    total_dropped = 0
    total_segments = 0
    skipped: dict[str, int] = {}
    # Ratios, so a song losing most of its lyrics is visible rather than
    # buried in the per-song log.
    ratios: list[tuple[float, str, int, int]] = []

    for i, key in enumerate(keys, 1):
        try:
            result = _process_song(storage, key, args.apply)
        except Exception:
            logger.exception("Failed on %s", key)
            skipped["error"] = skipped.get("error", 0) + 1
            continue

        if result.skipped:
            skipped[result.skipped] = skipped.get(result.skipped, 0) + 1
            continue

        total_segments += result.total
        if result.dropped:
            songs_changed += 1
            total_dropped += len(result.dropped)
            ratios.append((len(result.dropped) / result.total, key, len(result.dropped), result.total))
            logger.info(
                "[%d/%d] %s: dropping %d/%d", i, len(keys), key, len(result.dropped), result.total,
            )
            if args.verbose:
                for start, end, text in result.dropped:
                    logger.info("        %7.2f-%7.2f | %s", start, end, text[:60])

    logger.info("")
    logger.info("%s complete", mode)
    logger.info("  songs changed : %d", songs_changed)
    logger.info("  lines dropped : %d of %d (%.1f%%)",
                total_dropped, total_segments, 100.0 * total_dropped / max(total_segments, 1))
    for reason, count in sorted(skipped.items()):
        logger.info("  skipped (%s): %d", reason, count)

    ratios.sort(reverse=True)
    if ratios:
        logger.info("  songs losing the largest share (inspect these):")
        for ratio, key, dropped, total in ratios[:10]:
            logger.info("    %5.1f%%  %4d/%-4d  %s", ratio * 100, dropped, total, key)
    if not args.apply:
        logger.info("  re-run with --apply to write these changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
