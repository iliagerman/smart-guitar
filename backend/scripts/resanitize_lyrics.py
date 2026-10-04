"""Re-apply the lyrics sanitizer to all existing lyrics.json files.

Fixes Whisper hallucination loops that slipped through the old sanitizer:
segments where the decoder repeated the same phrase impossibly fast
(e.g. 9 words in 0.06 seconds).

Usage:
    cd backend && APP_ENV=prod uv run python scripts/resanitize_lyrics.py
    cd backend && APP_ENV=prod uv run python scripts/resanitize_lyrics.py --apply
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# Add lyrics_generator to path so we can import its sanitizer.
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "lyrics_generator" / "src"))

from lyrics_generator.sanitizer import sanitize_segments
from lyrics_generator.schemas import SegmentInfo, WordInfo

from guitar_player.config import load_settings
from guitar_player.storage import StorageBackend, create_storage

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def _to_segment(raw: dict) -> SegmentInfo:
    """Convert raw JSON segment to SegmentInfo."""
    words = [
        WordInfo(word=w["word"], start=w["start"], end=w["end"])
        for w in raw.get("words", [])
    ]
    return SegmentInfo(
        start=raw["start"],
        end=raw["end"],
        text=raw["text"],
        words=words,
    )


def _from_segment(seg: SegmentInfo) -> dict:
    """Convert SegmentInfo back to JSON-serializable dict."""
    return {
        "start": seg.start,
        "end": seg.end,
        "text": seg.text,
        "words": [{"word": w.word, "start": w.start, "end": w.end} for w in seg.words],
    }


def resanitize_lyrics(storage: StorageBackend, song: str, apply: bool) -> tuple[int, int]:
    """Re-sanitize a song's lyrics.json. Returns (original_count, new_count)."""
    key = f"{song}/lyrics.json"
    if not storage.file_exists(key):
        return 0, 0

    data = storage.read_json(key)
    raw_segments = data.get("segments", [])
    if not raw_segments:
        return 0, 0

    segments = [_to_segment(s) for s in raw_segments]
    cleaned = sanitize_segments(segments)

    original_count = len(segments)
    new_count = len(cleaned)

    if new_count < original_count:
        if apply:
            data["segments"] = [_from_segment(s) for s in cleaned]
            storage.write_json(key, data)
        return original_count, new_count

    return original_count, original_count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    parser.add_argument("--song", help="process a single song (e.g. chris_isaak/wicked_game)")
    args = parser.parse_args()

    storage = create_storage(load_settings())
    storage.init()
    mode = "APPLY" if args.apply else "DRY RUN"
    logger.info("%s\n", mode)

    if args.song:
        songs = [args.song]
    else:
        # List all lyrics.json files and extract song paths
        files = storage.list_files("")
        songs = set()
        for f in files:
            if f.endswith("/lyrics.json"):
                song = f.replace("/lyrics.json", "")
                songs.add(song)
        songs = sorted(songs)

    fixed = 0
    total_removed = 0

    for song in songs:
        original, cleaned = resanitize_lyrics(storage, song, args.apply)
        if cleaned < original:
            removed = original - cleaned
            total_removed += removed
            fixed += 1
            logger.info("  %s: %d -> %d segments (removed %d)", song, original, cleaned, removed)

    logger.info("\n%s complete", mode)
    logger.info("  songs fixed       : %d", fixed)
    logger.info("  segments removed  : %d", total_removed)
    if not args.apply:
        logger.info("  re-run with --apply to write these changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
