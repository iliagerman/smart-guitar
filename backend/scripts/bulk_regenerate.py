"""Bulk-regenerate lyrics and chords for every song in the local bucket.

For each song:
  * chords: POST /enhance on the chords service — beat-aligns existing
    chords.json, adds slash bass from the bass stem, and regenerates the
    simplified difficulty variants. Cheap (no autochord / demucs re-run).
  * lyrics: deletes lyrics.json / lyrics_quick.json / lyrics_corrected.json
    and re-runs the current transcription pipeline (LRCLIB + WhisperX +
    deterministic sanitizer) via the same `transcribe_lyrics_only` task the
    orchestrator uses. The legacy LLM-merged lyrics_corrected.json is always
    deleted and never regenerated.

Requires the chords (8001) and lyrics (8003) services to be running.
Progress is appended to a JSONL state file; rerunning skips completed songs.

Usage:
    cd backend && APP_ENV=local uv run python scripts/bulk_regenerate.py \
        --concurrency 2 --state-file ../regen_state.jsonl
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from pathlib import Path

from guitar_player.app_state import set_storage
from guitar_player.config import load_settings
from guitar_player.dao.song_dao import SongDAO
from guitar_player.database import close_db, init_db, safe_session
from guitar_player.schemas.records import SongRecord
from guitar_player.services.job_service.lyrics_chords import transcribe_lyrics_only
from guitar_player.services.processing_service import ProcessingService
from guitar_player.storage import StorageBackend, create_storage

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("bulk_regenerate")

LYRICS_FILES = ("lyrics.json", "lyrics_quick.json", "lyrics_corrected.json")


def load_state(state_file: Path) -> dict[str, str]:
    """Map of song_id -> status for songs already processed."""
    state: dict[str, str] = {}
    if not state_file.is_file():
        return state
    with open(state_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                state[entry["song_id"]] = entry["status"]
            except (json.JSONDecodeError, KeyError):
                continue
    return state


def append_state(state_file: Path, song_id: str, song_name: str, status: str, detail: str = "") -> None:
    with open(state_file, "a") as f:
        f.write(json.dumps({
            "song_id": song_id, "song_name": song_name,
            "status": status, "detail": detail,
        }) + "\n")


async def regenerate_chords(
    processing: ProcessingService, storage: StorageBackend, song: SongRecord,
) -> str:
    """Beat-align + slash-bass the existing chords. Returns a summary string."""
    song_name = song.song_name
    audio_key = song.audio_key or f"{song_name}/audio.mp3"
    if not storage.file_exists(audio_key):
        return "chords: skipped (no audio)"
    chords_key = song.chords_key or f"{song_name}/chords.json"
    if not storage.file_exists(chords_key):
        return "chords: skipped (no chords.json)"
    bass_key = song.bass_key or f"{song_name}/bass.mp3"
    bass_path = bass_key if storage.file_exists(bass_key) else ""

    # The chords service resolves inputs in its own storage; pass service
    # paths (absolute locally, raw keys on S3) like the orchestrator does.
    result = await processing.enhance_chords(
        storage.resolve_service_path(audio_key),
        storage.resolve_service_path(chords_key),
        storage.resolve_service_path(bass_path) if bass_path else "",
    )
    return f"chords: beats={result.beats_detected} slash-bass={result.bass_count}"


async def regenerate_lyrics(storage: StorageBackend, song: SongRecord) -> str:
    """Delete existing lyrics artifacts and re-transcribe with the current pipeline."""
    song_name = song.song_name
    vocals_key = song.vocals_key or f"{song_name}/vocals.mp3"
    if not storage.file_exists(vocals_key):
        return "lyrics: skipped (no vocals stem)"

    for fname in LYRICS_FILES:
        storage.delete_file(f"{song_name}/{fname}")

    async with safe_session() as session:
        dao = SongDAO(session)
        await dao.update_by_id(
            song.id,
            lyrics_key=None, lyrics_quick_key=None,
            lyrics_corrected_key=None, lyrics_corrected=False,
            lyrics_failed=False, lyrics_attempted_at=None,
        )
        await dao.commit()

    await transcribe_lyrics_only(song.id)

    produced = [
        fname for fname in ("lyrics.json", "lyrics_quick.json")
        if storage.file_exists(f"{song_name}/{fname}")
    ]
    if "lyrics.json" not in produced:
        raise RuntimeError(f"lyrics.json not produced (got: {produced})")
    return f"lyrics: produced {'+'.join(produced)}"


async def process_song(
    processing: ProcessingService,
    storage: StorageBackend,
    song: SongRecord,
    targets: set[str],
    state_file: Path,
) -> bool:
    parts: list[str] = []
    try:
        # Always drop the legacy LLM-merged file, even in chords-only runs.
        storage.delete_file(f"{song.song_name}/lyrics_corrected.json")
        if "chords" in targets:
            parts.append(await regenerate_chords(processing, storage, song))
        if "lyrics" in targets:
            parts.append(await regenerate_lyrics(storage, song))
        append_state(state_file, str(song.id), song.song_name, "done", "; ".join(parts))
        return True
    except Exception as e:
        logger.warning("FAILED %s: %s", song.song_name, e)
        append_state(state_file, str(song.id), song.song_name, "failed", f"{'; '.join(parts)}; error: {e}")
        return False


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--limit", type=int, default=0, help="0 = all songs")
    parser.add_argument("--targets", default="lyrics,chords")
    parser.add_argument("--state-file", default="../regen_state.jsonl")
    parser.add_argument("--retry-failed", action="store_true",
                        help="Re-attempt songs previously marked failed")
    parser.add_argument("--filter", default="", help="Only songs whose song_name contains this substring")
    args = parser.parse_args()

    targets = {t.strip() for t in args.targets.split(",") if t.strip()}
    state_file = Path(args.state_file).resolve()

    settings = load_settings()
    init_db(settings)
    storage = create_storage(settings)
    storage.init()
    set_storage(storage)
    processing = ProcessingService(settings)

    state = load_state(state_file)
    skip_statuses = {"done"} if args.retry_failed else {"done", "failed"}

    async with safe_session() as session:
        songs = await SongDAO(session).get_all_songs()

    queue = [
        s for s in songs
        if s.song_name
        and str(s.id) not in {sid for sid, st in state.items() if st in skip_statuses}
        and (args.filter in s.song_name)
    ]
    queue.sort(key=lambda s: s.song_name or "")
    if args.limit:
        queue = queue[: args.limit]

    total = len(queue)
    logger.info(
        "Bulk regenerate: %d songs to process (%d already in state file), targets=%s, concurrency=%d",
        total, len(state), sorted(targets), args.concurrency,
    )
    if not total:
        await close_db()
        return

    sem = asyncio.Semaphore(args.concurrency)
    done_count = 0
    fail_count = 0
    t0 = time.monotonic()

    async def worker(song: SongRecord, idx: int) -> None:
        nonlocal done_count, fail_count
        async with sem:
            ok = await process_song(processing, storage, song, targets, state_file)
            if ok:
                done_count += 1
            else:
                fail_count += 1
            completed = done_count + fail_count
            elapsed = time.monotonic() - t0
            rate = completed / elapsed if elapsed > 0 else 0
            eta_min = (total - completed) / rate / 60 if rate > 0 else 0
            logger.info(
                "[%d/%d] %s (%d failed, %.1f songs/min, ETA %.0f min)",
                completed, total, song.song_name, fail_count, rate * 60, eta_min,
            )

    await asyncio.gather(*(worker(s, i) for i, s in enumerate(queue)))

    logger.info(
        "Bulk regenerate finished: %d done, %d failed (state: %s)",
        done_count, fail_count, state_file,
    )
    await close_db()


if __name__ == "__main__":
    asyncio.run(main())
