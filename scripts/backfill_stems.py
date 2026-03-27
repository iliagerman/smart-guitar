#!/usr/bin/env python3
"""Backfill missing stems (drums, bass, piano, other) for existing songs in S3.

Scans the S3 bucket for song folders that have guitar.mp3 but are missing one or
more of the new stems. Downloads the original audio, runs Demucs separation, and
uploads only the missing stems back to S3.

The backend admin-heal loop will automatically detect the new files in S3 and
update the DB keys on next access — no direct DB writes needed here.

Usage:
    python scripts/backfill_stems.py --dry-run
    python scripts/backfill_stems.py --limit 5
    python scripts/backfill_stems.py
"""

import argparse
import logging
import os
import shutil
import subprocess
import tempfile

import boto3

BUCKET = "smart-guitar-audio-prod"
AWS_PROFILE = "smart-guitar"

# Stems that should exist for every processed song.
TARGET_STEMS = {"drums", "bass", "piano", "other"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def get_s3_client(profile: str = AWS_PROFILE):
    session = boto3.Session(profile_name=profile)
    return session.client("s3")


def find_incomplete_songs(s3) -> list[dict]:
    """Find song folders that have guitar.mp3 but are missing target stems.

    Works at any folder depth by scanning for all guitar.mp3 keys and deriving
    the parent folder from each. Then checks siblings for missing stems.
    """
    paginator = s3.get_paginator("list_objects_v2")

    # Step 1: find every guitar.mp3 in the bucket to locate song folders.
    logger.info("Scanning for all guitar.mp3 files...")
    song_folders: list[str] = []
    for page in paginator.paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/guitar.mp3"):
                # Parent folder is everything before the last filename
                folder = key.rsplit("/", 1)[0] + "/"
                song_folders.append(folder)

    logger.info("Found %d processed song folders", len(song_folders))

    # Step 2: for each song folder, list files and check for missing stems.
    incomplete: list[dict] = []

    for i, prefix in enumerate(song_folders):
        if i > 0 and i % 200 == 0:
            logger.info(
                "Checked %d/%d folders, found %d incomplete so far",
                i, len(song_folders), len(incomplete),
            )

        # List direct children of this folder
        filenames: set[str] = set()
        for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix, Delimiter="/"):
            for obj in page.get("Contents", []):
                filename = obj["Key"][len(prefix):]
                if filename:
                    filenames.add(filename)

        missing = set()
        for stem in TARGET_STEMS:
            if f"{stem}.mp3" not in filenames:
                missing.add(stem)

        if missing:
            has_audio = "audio.mp3" in filenames
            song_name = prefix.rstrip("/")
            incomplete.append({
                "prefix": prefix,
                "song_name": song_name,
                "missing": missing,
                "has_audio": has_audio,
            })

    return incomplete


def download_audio(s3, song_name: str, tmp_dir: str) -> str:
    """Download the original audio.mp3 from S3 to a temp directory."""
    key = f"{song_name}/audio.mp3"
    local_path = os.path.join(tmp_dir, "audio.mp3")
    logger.info("Downloading s3://%s/%s", BUCKET, key)
    s3.download_file(BUCKET, key, local_path)
    return local_path


def run_demucs(audio_path: str, output_dir: str) -> dict[str, str]:
    """Run Demucs separation with MPS (Apple Silicon) if available."""
    import gc

    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    from demucs.separate import load_track

    # Use MPS on Apple Silicon, fall back to CPU
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")

    model_name = "htdemucs_6s"
    model = get_model(model_name)
    model.eval()
    model.to(device)

    os.makedirs(output_dir, exist_ok=True)

    wav = load_track(audio_path, model.audio_channels, model.samplerate)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()

    logger.info("Running demucs on %s (device=%s)", audio_path, device)
    with torch.no_grad():
        sources = apply_model(
            model, wav[None], device=device, progress=False, shifts=0, split=True
        )[0]

    del wav
    gc.collect()
    sources = sources * ref.std() + ref.mean()
    del ref
    gc.collect()

    stem_paths: dict[str, str] = {}
    for i, stem_name in enumerate(model.sources):
        out_path = os.path.join(output_dir, f"{stem_name}.wav")
        stem_audio = sources[i].cpu().numpy().T
        sf.write(out_path, stem_audio, model.samplerate)
        del stem_audio
        stem_paths[stem_name] = out_path

    del sources
    gc.collect()

    # Convert WAV stems to MP3 (CBR 192 kbps)
    mp3_paths: dict[str, str] = {}
    for stem_name, wav_path in stem_paths.items():
        mp3_path = wav_path.rsplit(".", 1)[0] + ".mp3"
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", wav_path,
                "-codec:a", "libmp3lame", "-b:a", "192k",
                mp3_path,
            ],
            check=True,
            capture_output=True,
        )
        os.remove(wav_path)
        mp3_paths[stem_name] = mp3_path

    return mp3_paths


def upload_missing_stems(
    s3, song_name: str, stem_paths: dict[str, str], missing: set[str]
) -> list[str]:
    """Upload only the missing stems to S3. Returns list of uploaded stem names."""
    uploaded: list[str] = []

    for stem_name in missing:
        if stem_name not in stem_paths:
            logger.warning("Demucs did not produce stem '%s' for %s", stem_name, song_name)
            continue

        local_path = stem_paths[stem_name]
        s3_key = f"{song_name}/{stem_name}.mp3"

        logger.info("Uploading %s -> s3://%s/%s", local_path, BUCKET, s3_key)
        s3.upload_file(local_path, BUCKET, s3_key)
        uploaded.append(stem_name)

    return uploaded


def process_song(s3, song_info: dict, dry_run: bool) -> bool:
    """Process a single song. Returns True on success."""
    song_name = song_info["song_name"]
    missing = song_info["missing"]

    if not song_info["has_audio"]:
        logger.warning("SKIP %s: no audio.mp3 found", song_name)
        return False

    logger.info(
        "Processing: %s (missing: %s)",
        song_name,
        ", ".join(sorted(missing)),
    )

    if dry_run:
        logger.info("DRY RUN — would re-separate and upload %d stems", len(missing))
        return True

    tmp_dir = tempfile.mkdtemp(prefix="backfill_")
    try:
        audio_path = download_audio(s3, song_name, tmp_dir)

        stem_output_dir = os.path.join(tmp_dir, "stems")
        os.makedirs(stem_output_dir, exist_ok=True)

        stem_paths = run_demucs(audio_path, stem_output_dir)
        uploaded = upload_missing_stems(s3, song_name, stem_paths, missing)

        logger.info("Uploaded %d stems for %s: %s", len(uploaded), song_name, uploaded)
        return True

    except Exception:
        logger.exception("FAILED processing %s", song_name)
        return False

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _worker(song_info: dict, profile: str) -> tuple[str, bool]:
    """Standalone worker for parallel processing. Runs in a separate process."""
    s3 = get_s3_client(profile)
    song_name = song_info["song_name"]
    ok = process_song(s3, song_info, dry_run=False)
    return song_name, ok


def main():
    parser = argparse.ArgumentParser(
        description="Backfill missing stems (drums, bass, piano, other) in S3"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan and report only, do not download/process/upload",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Max number of songs to process (0 = unlimited)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Number of parallel workers (default: 4)",
    )
    parser.add_argument(
        "--profile",
        default=AWS_PROFILE,
        help=f"AWS profile name (default: {AWS_PROFILE})",
    )
    args = parser.parse_args()

    profile = args.profile
    s3 = get_s3_client(profile)

    logger.info("Scanning bucket %s for incomplete songs...", BUCKET)
    incomplete = find_incomplete_songs(s3)

    if not incomplete:
        logger.info("All songs have complete stems. Nothing to do.")
        return

    logger.info("Found %d songs with missing stems", len(incomplete))

    # Summary before processing
    no_audio = [s for s in incomplete if not s["has_audio"]]
    processable = [s for s in incomplete if s["has_audio"]]

    if no_audio:
        logger.warning("%d songs have no audio.mp3 and will be skipped:", len(no_audio))
        for s in no_audio[:10]:
            logger.warning("  %s", s["song_name"])
        if len(no_audio) > 10:
            logger.warning("  ... and %d more", len(no_audio) - 10)

    logger.info("%d songs are processable", len(processable))

    if args.limit > 0:
        processable = processable[:args.limit]
        logger.info("Limited to %d songs", len(processable))

    success = 0
    failed = 0

    if args.dry_run:
        for i, song_info in enumerate(processable):
            logger.info("--- [%d/%d] ---", i + 1, len(processable))
            process_song(s3, song_info, dry_run=True)
            success += 1
    else:
        from concurrent.futures import ProcessPoolExecutor, as_completed

        workers = min(args.workers, len(processable))
        logger.info("Processing %d songs with %d parallel workers", len(processable), workers)

        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_worker, song_info, profile): song_info
                for song_info in processable
            }

            for i, future in enumerate(as_completed(futures), 1):
                song_info = futures[future]
                song_name = song_info["song_name"]
                try:
                    _, ok = future.result()
                    if ok:
                        success += 1
                    else:
                        failed += 1
                except Exception:
                    logger.exception("Worker crashed for %s", song_name)
                    failed += 1

                if i % 10 == 0 or i == len(processable):
                    logger.info(
                        "Progress: %d/%d done (success=%d, failed=%d)",
                        i, len(processable), success, failed,
                    )

    logger.info(
        "Done. Total: %d, Success: %d, Failed: %d",
        success + failed,
        success,
        failed,
    )

    if not args.dry_run and success > 0:
        logger.info(
            "NOTE: The backend admin-heal will automatically detect the new "
            "stem files and update DB keys on next song access."
        )


if __name__ == "__main__":
    main()
