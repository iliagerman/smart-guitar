"""Cleanup local media files that look like live performances.

This script targets *original audio* files stored under repo_root/local_bucket/**
whose filenames suggest a live concert/show recording.

Safety:
- Default is dry-run (no deletions).
- Use --delete to actually remove files / folders / DB rows.
- Always writes a JSONL manifest of actions taken.

Run via just (recommended):
    just cleanup-live-media "--mode contextual"  # dry-run
    just cleanup-live-media "--mode contextual --delete --target song_folder --db-delete"
    just cleanup-live-media "--mode strict --delete --target song_folder --db-delete"
"""

from __future__ import annotations

# pyright: reportMissingImports=false, reportMissingModuleSource=false

# ruff: noqa: E402

import argparse
import asyncio
import json
import shutil
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

# Ensure imports work when running as a standalone script.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _REPO_ROOT / "backend" / "src"
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from guitar_player.utils.youtube_filters import (  # pyright: ignore[reportMissingImports]
    is_probable_live_performance_title,
)


@dataclass(frozen=True)
class ManifestRow:
    matched_path: str
    song_dir: str
    song_name: str
    size_bytes: int
    mtime_epoch: float
    mode: str
    target: str
    action: str


_STEM_LIKE_FILES = {
    "vocals.mp3",
    "drums.mp3",
    "bass.mp3",
    "guitar.mp3",
    "piano.mp3",
    "other.mp3",
    "vocals_removed.mp3",
    "guitar_removed.mp3",
    "vocals_guitar.mp3",
    "guitar_isolated.mp3",
    "vocals_isolated.mp3",
    "full_mix.mp3",
    "mix.mp3",
    "audio.mp3",
}


def _repo_root() -> Path:
    # <repo>/backend/scripts/cleanup_live_media.py
    return Path(__file__).resolve().parents[2]


def _matches_strict(name: str) -> bool:
    s = (name or "").lower()
    return ("live" in s) or ("concert" in s) or ("show" in s)


def _matches_contextual(name: str) -> bool:
    # Evaluate on the title portion (without extension) for better matching.
    title = (name or "").rsplit(".", 1)[0]
    return is_probable_live_performance_title(title)


def _derive_song_name(bucket: Path, song_dir: Path) -> str | None:
    """Derive song_name = '{artist}/{song}' from a directory under the bucket."""
    try:
        rel = song_dir.relative_to(bucket)
    except Exception:
        return None

    parts = list(rel.parts)
    if len(parts) < 2:
        return None
    return f"{parts[0]}/{parts[1]}"


async def _delete_from_db(song_names: set[str]) -> tuple[int, int, int]:
    """Delete songs (and dependent rows) from the DB by song_name.

    Returns (songs_deleted, jobs_deleted, favorites_deleted).
    """
    if not song_names:
        return 0, 0, 0

    from sqlalchemy import delete, select

    from guitar_player.config import load_settings
    from guitar_player.database import close_db, init_db
    from guitar_player.models.favorite import Favorite
    from guitar_player.models.job import Job
    from guitar_player.models.song import Song

    settings = load_settings()
    session_factory = init_db(settings)

    try:
        async with session_factory() as session:
            # Resolve affected song IDs first.
            result = await session.execute(
                select(Song.id).where(Song.song_name.in_(song_names))
            )
            song_ids = [row[0] for row in result.all()]

            if not song_ids:
                await session.commit()
                return 0, 0, 0

            jobs_deleted = 0
            favorites_deleted = 0

            jobs_res = await session.execute(
                delete(Job).where(Job.song_id.in_(song_ids))
            )
            if jobs_res.rowcount is not None:
                jobs_deleted = int(jobs_res.rowcount)

            fav_res = await session.execute(
                delete(Favorite).where(Favorite.song_id.in_(song_ids))
            )
            if fav_res.rowcount is not None:
                favorites_deleted = int(fav_res.rowcount)

            songs_res = await session.execute(delete(Song).where(Song.id.in_(song_ids)))
            songs_deleted = int(songs_res.rowcount or 0)

            await session.commit()
            return songs_deleted, jobs_deleted, favorites_deleted
    finally:
        await close_db()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bucket",
        type=str,
        default=str(_repo_root() / "local_bucket"),
        help="Path to local bucket root (default: <repo>/local_bucket)",
    )
    parser.add_argument(
        "--mode",
        choices=["contextual", "strict"],
        default="contextual",
        help="Matching strategy (default: contextual)",
    )
    parser.add_argument(
        "--target",
        choices=["file", "song_folder"],
        default="file",
        help="What to delete for each match (default: file)",
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Actually delete (default: dry-run)",
    )
    parser.add_argument(
        "--db-delete",
        action="store_true",
        help="Also delete matching songs from the DB (requires --delete)",
    )
    parser.add_argument(
        "--manifest-in",
        type=str,
        default="",
        help=(
            "Optional prior manifest JSONL to drive deletion (useful if offending audio files were already deleted)."
        ),
    )
    parser.add_argument(
        "--manifest",
        type=str,
        default="",
        help="Manifest output path (default: <repo>/cleanup_live_media_manifest_<ts>.jsonl)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Stop after N matches (0 = no limit)",
    )

    args = parser.parse_args(argv)

    bucket = Path(args.bucket).expanduser().resolve()
    if not bucket.is_dir():
        print(f"ERROR: bucket directory not found: {bucket}", file=sys.stderr)
        return 2

    ts = time.strftime("%Y%m%d_%H%M%S")
    manifest_path = (
        Path(args.manifest).expanduser().resolve()
        if args.manifest
        else (_repo_root() / f"cleanup_live_media_manifest_{ts}.jsonl")
    )
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    matcher = _matches_contextual if args.mode == "contextual" else _matches_strict

    matches = 0
    deleted_files = 0
    deleted_song_folders = 0

    matched_song_names: set[str] = set()
    processed_song_dirs: set[Path] = set()

    # If a previous manifest is provided, use it to collect song dirs/names.
    manifest_in_rows: list[dict] = []
    if args.manifest_in:
        manifest_in_path = Path(args.manifest_in).expanduser().resolve()
        if not manifest_in_path.is_file():
            print(f"ERROR: manifest-in not found: {manifest_in_path}", file=sys.stderr)
            return 2
        for line in manifest_in_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                manifest_in_rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    with manifest_path.open("w", encoding="utf-8") as mf:
        # Manifest-driven mode: delete based on prior matches.
        if manifest_in_rows:
            for row in manifest_in_rows:
                song_dir_s = row.get("song_dir") or ""
                song_name = row.get("song_name") or ""
                matched_path = row.get("matched_path") or row.get("path") or ""

                song_dir = Path(song_dir_s) if song_dir_s else None
                if not song_dir:
                    if matched_path:
                        song_dir = Path(matched_path).parent
                    else:
                        continue

                song_name = song_name or (_derive_song_name(bucket, song_dir) or "")
                if not song_name:
                    continue

                if args.target == "song_folder":
                    if song_dir in processed_song_dirs:
                        continue
                    processed_song_dirs.add(song_dir)

                action = "would_delete"
                if args.delete:
                    if args.target == "song_folder":
                        try:
                            shutil.rmtree(song_dir)
                            action = "deleted_song_folder"
                            deleted_song_folders += 1
                        except Exception as exc:
                            action = f"delete_failed:{type(exc).__name__}"
                    else:
                        mp3 = Path(matched_path)
                        try:
                            mp3.unlink(missing_ok=True)
                            action = "deleted_file"
                            deleted_files += 1
                        except Exception as exc:
                            action = f"delete_failed:{type(exc).__name__}"

                matched_song_names.add(song_name)

                out = ManifestRow(
                    matched_path=str(matched_path),
                    song_dir=str(song_dir),
                    song_name=song_name,
                    size_bytes=int(row.get("size_bytes") or 0),
                    mtime_epoch=float(row.get("mtime_epoch") or 0.0),
                    mode=args.mode,
                    target=args.target,
                    action=action,
                )
                mf.write(json.dumps(asdict(out), ensure_ascii=False) + "\n")

                matches += 1
                if args.limit and matches >= args.limit:
                    break

        # Scan mode: find matching original-audio files.
        for mp3 in bucket.rglob("*.mp3"):
            if not mp3.is_file():
                continue

            if mp3.name in _STEM_LIKE_FILES:
                continue

            if not matcher(mp3.name):
                continue

            song_dir = mp3.parent
            song_name = _derive_song_name(bucket, song_dir) or ""
            if not song_name:
                continue

            # If deleting whole folders, de-dupe per song.
            if args.target == "song_folder":
                if song_dir in processed_song_dirs:
                    continue
                processed_song_dirs.add(song_dir)

            st = mp3.stat()
            action = "would_delete"
            if args.delete:
                if args.target == "song_folder":
                    try:
                        shutil.rmtree(song_dir)
                        action = "deleted_song_folder"
                        deleted_song_folders += 1
                    except Exception as exc:
                        action = f"delete_failed:{type(exc).__name__}"
                else:
                    try:
                        mp3.unlink()
                        action = "deleted_file"
                        deleted_files += 1
                    except Exception as exc:
                        action = f"delete_failed:{type(exc).__name__}"

            matched_song_names.add(song_name)

            row = ManifestRow(
                matched_path=str(mp3),
                song_dir=str(song_dir),
                song_name=song_name,
                size_bytes=int(st.st_size),
                mtime_epoch=float(st.st_mtime),
                mode=args.mode,
                target=args.target,
                action=action,
            )
            mf.write(json.dumps(asdict(row), ensure_ascii=False) + "\n")

            matches += 1
            if args.limit and matches >= args.limit:
                break

    print(f"Scanned bucket: {bucket}")
    print(f"Mode: {args.mode}")
    print(f"Target: {args.target}")
    print(f"Matches: {matches}")
    if args.delete:
        if args.target == "song_folder":
            print(f"Deleted song folders: {deleted_song_folders}")
        else:
            print(f"Deleted files: {deleted_files}")
    print(f"Manifest: {manifest_path}")

    if args.db_delete:
        if not args.delete:
            print("DB delete requested but --delete was not set; skipping DB changes.")
        else:
            songs_deleted, jobs_deleted, favorites_deleted = asyncio.run(
                _delete_from_db(matched_song_names)
            )
            print(
                "DB deleted: songs=%d jobs=%d favorites=%d"
                % (songs_deleted, jobs_deleted, favorites_deleted)
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
