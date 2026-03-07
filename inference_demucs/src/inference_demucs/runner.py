#!/usr/bin/env python3
"""Run Demucs audio separation locally.

Processes a test audio file and produces three outputs:
1. Guitar isolated (htdemucs_6s guitar stem)
2. Vocals isolated (htdemucs_6s vocals stem)
3. Guitar removed (all stems except guitar mixed)

Usage:
    python -m inference_demucs.runner <audio_file> [--output-dir <dir>]
"""

import argparse
import logging
import os
import sys
import time

from inference_demucs.config import load_settings
from inference_demucs.separator import produce_test_outputs

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run Demucs htdemucs_6s separation locally",
    )
    parser.add_argument(
        "audio_file",
        nargs="?",
        default=None,
        help="Path to input audio file (MP3, OGG, or WAV). "
        "Defaults to local_bucket/bob_dylan/knocking_on_heavens_door/ test file.",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Output directory (default: test_audio/output_demucs/)",
    )
    args = parser.parse_args()

    settings = load_settings()

    if args.audio_file is None:
        base = settings.storage.base_path or "../local_bucket"
        args.audio_file = os.path.join(
            base,
            "bob_dylan",
            "knocking_on_heavens_door",
            "Bob Dylan - Knockin' On Heaven's Door (Official Audio).mp3",
        )

    if not os.path.exists(args.audio_file):
        logger.error("File not found: %s", args.audio_file)
        sys.exit(1)

    if args.output_dir is None:
        # Output alongside the input file: base/artist/song_name/
        input_parent = os.path.dirname(args.audio_file)
        args.output_dir = input_parent

    print(f"Input:  {args.audio_file}")
    print(f"Output: {args.output_dir}")
    print(f"Model:  htdemucs_6s (6 stems: vocals, drums, bass, guitar, piano, other)")
    print()

    start = time.time()
    results = produce_test_outputs(args.audio_file, args.output_dir)
    elapsed = time.time() - start

    print(f"\nSeparation complete in {elapsed:.1f}s")
    print(f"\nResults ({len(results)} files):")
    for r in results:
        size_mb = os.path.getsize(r.output_path) / (1024 * 1024)
        print(f"  [{r.mode:>7}] {r.description}: {r.output_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
