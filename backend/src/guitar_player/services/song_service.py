"""Song service — orchestrates song lifecycle."""

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
import time as _time
import uuid
from datetime import datetime, timezone
from typing import Any

import boto3

from guitar_player.services.audio_normalize import (
    ensure_canonical_audio_mp3,
    transcode_audio_to_mp3_cbr192,
)

from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.exceptions import (
    BadRequestError,
    NotFoundError,
)
from guitar_player.schemas.song import (
    ChordEntry,
    ChordOption,
    EnrichedSearchResult,
    GenreCount,
    LyricsSegment,
    LyricsWord,
    PaginatedSongsResponse,
    SongDetailResponse,
    SongResponse,
    SongSection,
    StemType,
    StemUrls,
    StrumEvent,
    TabNote,
    RhythmInfo,
)
from guitar_player.services.artwork_service import ArtworkService
from guitar_player.services.llm_service import LlmService
from guitar_player.services.lyrics_correction import merge_lyrics_with_llm
from guitar_player.services.youtube_service import YoutubeService
from guitar_player.storage import StorageBackend
from guitar_player.utils.youtube_filters import is_probable_live_performance_title

# Chord variant files produced by the simplifier (name prefix → filename).
# The recognizer always writes these; capo variants are dynamic.
CHORD_VARIANT_PREFIX = "chords_"
CHORD_VARIANT_SUFFIX = ".json"

logger = logging.getLogger(__name__)

# Single source of truth for stem types — drives the API response and DB lookups.
STEM_DEFINITIONS: list[StemType] = [
    StemType(name="vocals", label="Vocals"),
    StemType(name="guitar", label="Guitar"),
    StemType(name="drums", label="Drums"),
    StemType(name="bass", label="Bass"),
    StemType(name="piano", label="Piano"),
    StemType(name="other", label="Other"),
]

STEM_NAMES = [s.name for s in STEM_DEFINITIONS]


def _to_folder_name(name: str) -> str:
    """Convert a display name to a filesystem-safe snake_case folder name."""
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s-]+", "_", s)
    return s.strip("_")


def _slug_to_display(slug: str) -> str:
    """Convert an internal slug (snake_case/kebab-case) into Title Case for UI."""
    s = (slug or "").strip()
    if not s:
        return ""
    s = s.replace("_", " ").replace("-", " ")
    s = re.sub(r"\s+", " ", s).strip()
    parts = [p for p in s.split(" ") if p]
    return " ".join(p[:1].upper() + p[1:].lower() for p in parts)


def _parse_lyrics_payload(
    raw: dict[str, Any] | list[Any],
) -> tuple[list[LyricsSegment], str | None, dict[str, Any] | None]:
    if not (isinstance(raw, dict) and "segments" in raw):
        return [], None, None

    segments = [
        LyricsSegment(
            start=segment["start"],
            end=segment["end"],
            text=segment["text"],
            words=[LyricsWord(**word) for word in segment.get("words", [])],
        )
        for segment in raw["segments"]
    ]
    return segments, raw.get("source"), raw


class SongService:
    def __init__(
        self,
        session: AsyncSession,
        storage: StorageBackend,
        youtube: YoutubeService,
        llm: LlmService,
        artwork: ArtworkService,
    ) -> None:
        self._storage = storage
        self._youtube = youtube
        self._llm = llm
        self._artwork = artwork
        self._song_dao = SongDAO(session)
        self._user_dao = UserDAO(session)

    async def search_youtube(self, query: str, max_results: int = 10) -> list[dict]:
        return await self._youtube.search(query, max_results)

    async def search_youtube_enriched(
        self, query: str, max_results: int = 10
    ) -> list[EnrichedSearchResult]:
        """Search YouTube, parse results via LLM, check local existence, sort local-first."""
        raw_results = await self._youtube.search(query, max_results)
        if not raw_results:
            return []

        # Batch-parse all titles via LLM
        parsed_items = await self._llm.parse_search_results(raw_results)

        # Enrich each result: add link, check local existence by youtube_id.
        # All versions are shown (no dedup by artist/song).
        enriched: list[EnrichedSearchResult] = []

        for raw, parsed in zip(raw_results, parsed_items):
            youtube_id = raw["youtube_id"]

            # Check if this specific version exists in the DB
            db_song = await self._song_dao.get_by_youtube_id(youtube_id)
            exists = db_song is not None and db_song.audio_key is not None

            enriched.append(
                EnrichedSearchResult(
                    artist=parsed.artist,
                    song=parsed.song,
                    genre=parsed.genre,
                    youtube_id=youtube_id,
                    title=raw.get("title", ""),
                    link=f"https://www.youtube.com/watch?v={youtube_id}",
                    thumbnail_url=raw.get("thumbnail_url"),
                    duration_seconds=raw.get("duration_seconds"),
                    view_count=raw.get("view_count"),
                    exists_locally=exists,
                    song_id=db_song.id if db_song else None,
                )
            )

        # Sort: local songs first, preserve original order within each group
        enriched.sort(key=lambda r: (not r.exists_locally,))

        return enriched

    async def download_song(
        self, youtube_id: str, user_sub: str, user_email: str
    ) -> SongResponse:
        """Download a song from YouTube, upload to storage, create DB record."""
        # Check if already downloaded (by youtube_id) and files still exist
        existing = await self._song_dao.get_by_youtube_id(youtube_id)
        if (
            existing
            and existing.audio_key
            and self._storage.file_exists(existing.audio_key)
        ):
            return SongResponse.model_validate(existing)

        # Policy: refuse to download probable live performance/concert videos.
        # Use lightweight oEmbed to get the title (~0.1s) instead of a full
        # yt-dlp video-ID lookup with PO-token/proxy (~15-170s).
        t0_total = _time.monotonic()
        title_for_policy = await self._youtube.fetch_title(youtube_id)
        if not title_for_policy:
            raise BadRequestError(
                "Could not verify YouTube video title; please try again."
            )

        if is_probable_live_performance_title(title_for_policy):
            raise BadRequestError(
                f"Refusing to download probable live performance: {title_for_policy}"
            )

        # Determine whether to offload to homeserver via SQS or download locally.
        from guitar_player.config import get_settings

        sqs_queue_url = get_settings().youtube.youtube_download_queue_url

        tmp_dir = tempfile.mkdtemp(prefix="song_dl_")
        try:
            title = title_for_policy

            # Use LLM to parse clean artist/song from the video title,
            # falling back to naive metadata extraction if LLM fails.
            # (done before thumbnail so we can search for official artwork)
            genre: str | None = None
            title_display: str | None = None
            artist_display: str | None = None
            try:
                t0 = _time.monotonic()
                parsed = await self._llm.parse_song_name(title)
                logger.info(
                    "TIMING llm.parse_song_name took %.1fs [yt=%s]",
                    _time.monotonic() - t0,
                    youtube_id,
                )
                artist_folder = parsed.artist or "unknown"
                song_folder = parsed.song
                artist_display = _slug_to_display(parsed.artist or "unknown")
                title_display = _slug_to_display(parsed.song)
                genre = parsed.genre
            except Exception as e:
                logger.warning("LLM name parsing failed, using fallback: %s", e)
                artist_folder = _to_folder_name("unknown_artist")
                song_folder = _to_folder_name(title)
                artist_display = "Unknown Artist"
                title_display = title

            # Try official album artwork first, fall back to YouTube thumbnail
            t0 = _time.monotonic()
            thumb_path = await self._artwork.fetch_artwork(
                artist_folder, song_folder, tmp_dir
            )
            logger.info(
                "TIMING artwork.fetch_artwork took %.1fs [yt=%s]",
                _time.monotonic() - t0,
                youtube_id,
            )
            if thumb_path:
                logger.info(
                    "Using official artwork for %s/%s", artist_folder, song_folder
                )
                thumbnail_filename = "cover.jpg"
            else:
                logger.info(
                    "No official artwork found for %s/%s, falling back to YouTube thumbnail",
                    artist_folder,
                    song_folder,
                )
                thumb_path = await self._youtube.download_thumbnail(youtube_id, tmp_dir)
                thumbnail_filename = f"{youtube_id}.jpg"

            # Include youtube_id in song_name to allow multiple versions
            # of the same artist/song combination.
            song_name = f"{artist_folder}/{song_folder}/{youtube_id}"

            canonical_audio_filename = "audio.mp3"
            canonical_audio_key = f"{song_name}/{canonical_audio_filename}"
            thumbnail_key = f"{song_name}/{thumbnail_filename}"

            # Get or create user
            user = await self._user_dao.get_or_create(user_sub, user_email)

            # DB-first: create/update record before uploading files
            if existing:
                song = await self._song_dao.update_by_id(
                    existing.id,
                    song_name=song_name,
                    title=title_display or title,
                    artist=artist_display,
                    genre=genre,
                    downloaded_by=user.id,
                )
            else:
                song = await self._song_dao.create(
                    youtube_id=youtube_id,
                    title=title_display or title,
                    artist=artist_display,
                    genre=genre,
                    duration_seconds=None,  # not available without yt-dlp download
                    song_name=song_name,
                    downloaded_by=user.id,
                )

            if sqs_queue_url:
                # --- Homeserver path: fire-and-forget via SQS ---
                audio_key_to_use = canonical_audio_key

                self._storage.upload_file(thumb_path, thumbnail_key)

                song = await self._song_dao.update_by_id(
                    song.id,
                    audio_key=audio_key_to_use,
                    thumbnail_key=thumbnail_key,
                    download_requested_at=datetime.now(timezone.utc),
                )

                await self._publish_download_request(
                    youtube_id=youtube_id,
                    target_s3_key=audio_key_to_use,
                    song_id=song.id,
                    sqs_queue_url=sqs_queue_url,
                )
            else:
                # --- Local dev path: download directly ---
                t0 = _time.monotonic()
                local_audio, _raw_title, meta = await self._youtube.download(
                    youtube_id, tmp_dir, skip_preflight=True
                )
                logger.info(
                    "TIMING youtube.download took %.1fs [yt=%s]",
                    _time.monotonic() - t0,
                    youtube_id,
                )

                local_mp3 = os.path.join(tmp_dir, canonical_audio_filename)
                audio_key_to_use = canonical_audio_key
                try:
                    transcode_audio_to_mp3_cbr192(local_audio, local_mp3)
                    self._storage.upload_file(local_mp3, canonical_audio_key)
                except Exception:
                    logger.exception(
                        "Failed to transcode %s to canonical MP3; falling back to original audio",
                        local_audio,
                    )
                    audio_filename = os.path.basename(local_audio)
                    audio_key_to_use = f"{song_name}/{audio_filename}"
                    self._storage.upload_file(local_audio, audio_key_to_use)

                self._storage.upload_file(thumb_path, thumbnail_key)

                song = await self._song_dao.update_by_id(
                    song.id,
                    audio_key=audio_key_to_use,
                    thumbnail_key=thumbnail_key,
                )

            logger.info(
                "TIMING download_song total %.1fs [yt=%s]",
                _time.monotonic() - t0_total,
                youtube_id,
            )
            return SongResponse.model_validate(song)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    async def _publish_download_request(
        self,
        youtube_id: str,
        target_s3_key: str,
        song_id: uuid.UUID,
        sqs_queue_url: str,
    ) -> None:
        """Send a YouTube download request to the homeserver via SQS."""
        from guitar_player.config import get_settings

        from guitar_player.request_context import (
            request_id_var,
            user_id_var,
            user_email_var,
        )

        settings = get_settings()
        sqs = boto3.client("sqs", region_name=settings.aws.region)
        message = {
            "youtube_id": youtube_id,
            "target_s3_key": target_s3_key,
            "bucket": settings.storage.bucket,
            "song_id": str(song_id),
            "request_id": request_id_var.get(),
            "user_id": user_id_var.get(),
            "user_email": user_email_var.get(),
        }
        await asyncio.to_thread(
            sqs.send_message,
            QueueUrl=sqs_queue_url,
            MessageBody=json.dumps(message),
        )
        logger.info(
            "Published SQS download request for yt=%s -> %s",
            youtube_id,
            target_s3_key,
        )

    async def get_song(self, song_id: uuid.UUID) -> SongResponse:
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))
        return SongResponse.model_validate(song)

    async def get_file_key(self, song_id: uuid.UUID, column_name: str) -> str | None:
        """Return a raw storage key for a song column (e.g. 'audio_key', 'vocals_key')."""
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))
        return getattr(song, column_name, None)

    async def clear_file_key(self, song_id: uuid.UUID, column_name: str) -> None:
        """Clear a stale storage key from a song record."""
        song = await self._song_dao.get_by_id(song_id)
        if song and getattr(song, column_name, None):
            await self._song_dao.update_by_id(song.id, **{column_name: None})

    async def clear_download_if_audio_ready(self, song_id: uuid.UUID) -> bool:
        """Clear download_requested_at if the audio file now exists in storage.

        Called on each poll so the frontend sees download_pending=false
        as soon as the homeserver finishes uploading.
        Returns True if the flag was cleared.
        """
        song = await self._song_dao.get_by_id(song_id)
        if not song or song.download_requested_at is None:
            return False
        if song.audio_key and self._storage.file_exists(song.audio_key):
            await self._song_dao.update_by_id(song_id, download_requested_at=None)
            return True
        return False

    async def admin_heal_audio_and_thumbnail(
        self,
        song_id: uuid.UUID,
        user_sub: str,
        user_email: str,
    ) -> bool:
        """Best-effort repair for missing original audio/thumbnail.

        - First tries to fix DB keys from common filenames under song.song_name.
        - If still missing and youtube_id is available, re-downloads and re-uploads
          into the existing song folder (does NOT change song_name).

        Returns True if the DB record was updated.
        """

        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        # If both are present and exist in storage, we still may want to
        # canonicalize the audio key to audio.mp3.
        audio_ok = bool(song.audio_key) and self._storage.file_exists(song.audio_key)
        thumb_ok = bool(song.thumbnail_key) and self._storage.file_exists(
            song.thumbnail_key
        )

        updated = False
        # Collect all updates to flush at the end of each phase.
        pending_updates: dict = {}

        # Canonicalize audio even when it's already present.
        if audio_ok and song.song_name and song.audio_key:
            if not song.audio_key.endswith("/audio.mp3"):
                canonical = await ensure_canonical_audio_mp3(
                    self._storage,
                    song_name=song.song_name,
                    source_audio_key=song.audio_key,
                )
                if canonical and canonical != song.audio_key:
                    pending_updates["audio_key"] = canonical
                    updated = True
                    audio_ok = True

        # If both are present and exist in storage (and canonicalization didn't
        # change anything), nothing else to do.
        if audio_ok and thumb_ok and not updated:
            return False

        # Try to fix from existing files in storage first.
        if song.song_name:
            try:
                files = set(self._storage.list_files(song.song_name))

                if not audio_ok:
                    audio_candidates = [
                        f"{song.song_name}/audio.mp3",
                        f"{song.song_name}/full_mix.mp3",
                        f"{song.song_name}/mix.mp3",
                    ]
                    # Also try: any audio file that doesn't look like a stem.
                    stem_like = {
                        "vocals.mp3",
                        "guitar.mp3",
                        "guitar_isolated.mp3",
                        "vocals_isolated.mp3",
                        "guitar_removed.mp3",
                        "vocals_guitar.mp3",
                        "drums.mp3",
                        "bass.mp3",
                        "piano.mp3",
                        "other.mp3",
                    }
                    for f in files:
                        if not f.endswith(".mp3"):
                            continue
                        if f.rsplit("/", 1)[-1] in stem_like:
                            continue
                        audio_candidates.append(f)

                    found_audio_key: str | None = None
                    for key in audio_candidates:
                        if key in files and self._storage.file_exists(key):
                            found_audio_key = key
                            audio_ok = True
                            updated = True
                            break

                    # If we found audio but it's not canonical, canonicalize it.
                    if (
                        audio_ok
                        and found_audio_key
                        and not found_audio_key.endswith("/audio.mp3")
                    ):
                        canonical = await ensure_canonical_audio_mp3(
                            self._storage,
                            song_name=song.song_name,
                            source_audio_key=found_audio_key,
                        )
                        if canonical and canonical != found_audio_key:
                            found_audio_key = canonical
                            updated = True

                    if found_audio_key:
                        pending_updates["audio_key"] = found_audio_key

                if not thumb_ok:
                    thumb_candidates = [
                        f"{song.song_name}/thumbnail.jpg",
                        f"{song.song_name}/thumbnail.jpeg",
                        f"{song.song_name}/cover.jpg",
                        f"{song.song_name}/cover.jpeg",
                    ]
                    if song.youtube_id:
                        base_yt_id = song.youtube_id.rstrip("_")
                        thumb_candidates.insert(0, f"{song.song_name}/{base_yt_id}.jpg")
                        if base_yt_id != song.youtube_id:
                            thumb_candidates.insert(
                                1, f"{song.song_name}/{song.youtube_id}.jpg"
                            )

                    for key in thumb_candidates:
                        if key in files and self._storage.file_exists(key):
                            pending_updates["thumbnail_key"] = key
                            thumb_ok = True
                            updated = True
                            break

                    if not thumb_ok:
                        for f in sorted(files):
                            if f.lower().endswith((".jpg", ".jpeg")):
                                pending_updates["thumbnail_key"] = f
                                thumb_ok = True
                                updated = True
                                # Extract youtube_id from filename (e.g. "artist/song/dLl4PZtxia8.jpg")
                                if not song.youtube_id:
                                    stem = f.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                                    if stem not in ("thumbnail", "cover"):
                                        candidate = stem
                                        while (
                                            await self._song_dao.get_by_youtube_id(
                                                candidate
                                            )
                                            is not None
                                        ):
                                            candidate += "_"
                                        pending_updates["youtube_id"] = candidate
                                break
            except Exception as e:
                logger.warning(
                    "Admin: failed to list files for %s: %s", song.song_name, e
                )

        if updated:
            # Persist any key fixes.
            if pending_updates:
                song = await self._song_dao.update_by_id(song.id, **pending_updates)
                pending_updates = {}
            return True

        # If still missing and we don't have a youtube_id, try to discover one.
        # Requirement: search YouTube using "official" and take the first result.
        if not song.youtube_id:
            terms: list[str] = []
            if song.artist:
                terms.append(song.artist)
            if song.title:
                terms.append(song.title)

            if not terms and song.song_name:
                # Fallback to last path component (e.g. "ace_of_spades")
                terms.append(song.song_name.rsplit("/", 1)[-1].replace("_", " "))

            query = " ".join(t.strip() for t in terms if t and t.strip()).strip()
            if query:
                query = f"{query} official"
                try:
                    results = await self._youtube.search(query, max_results=1)
                    youtube_id = (
                        results[0].get("youtube_id") if results and results[0] else None
                    )
                    if youtube_id:
                        candidate = youtube_id
                        while (
                            await self._song_dao.get_by_youtube_id(candidate)
                            is not None
                        ):
                            candidate += "_"
                        song = await self._song_dao.update_by_id(
                            song.id, youtube_id=candidate
                        )
                        updated = True
                        logger.info(
                            "Admin: discovered youtube_id for %s via query '%s'",
                            song.song_name,
                            query,
                        )
                except Exception as e:
                    logger.warning(
                        "Admin: YouTube search failed for %s (query='%s'): %s",
                        song.song_name,
                        query,
                        e,
                    )

        # If still missing and we have no youtube_id, we can't re-download.
        if not song.youtube_id:
            logger.warning(
                "Admin heal: cannot re-download audio — no youtube_id song_name=%r artist=%r title=%r",
                song.song_name,
                song.artist,
                song.title,
                extra={
                    "event_type": "admin_heal",
                    "action": "youtube_download",
                    "song_name": song.song_name,
                    "artist": song.artist,
                    "title": song.title,
                    "outcome": "blocked",
                    "reason": "no_youtube_id",
                },
            )
            return updated

        tmp_dir = tempfile.mkdtemp(prefix="song_admin_")
        try:
            # Ensure user exists (and mark who triggered the repair if downloaded_by is empty).
            user = await self._user_dao.get_or_create(user_sub, user_email)

            heal_updates: dict = {}

            if not audio_ok:
                try:
                    local_audio, _raw_name, _meta = await self._youtube.download(
                        song.youtube_id, tmp_dir
                    )
                except Exception:
                    logger.exception(
                        "Admin heal: YouTube download failed song_name=%r artist=%r title=%r youtube_id=%r",
                        song.song_name,
                        song.artist,
                        song.title,
                        song.youtube_id,
                        extra={
                            "event_type": "admin_heal",
                            "action": "youtube_download",
                            "song_name": song.song_name,
                            "artist": song.artist,
                            "title": song.title,
                            "youtube_id": song.youtube_id,
                            "outcome": "failed",
                        },
                    )
                    raise

                canonical_audio_key = f"{song.song_name}/audio.mp3"
                local_mp3 = os.path.join(tmp_dir, "audio.mp3")

                try:
                    transcode_audio_to_mp3_cbr192(local_audio, local_mp3)
                    self._storage.upload_file(local_mp3, canonical_audio_key)
                    heal_updates["audio_key"] = canonical_audio_key
                except Exception:
                    logger.exception(
                        "Admin heal: transcode failed, falling back to original song_name=%r",
                        song.song_name,
                    )
                    audio_filename = os.path.basename(local_audio)
                    audio_key = f"{song.song_name}/{audio_filename}"
                    self._storage.upload_file(local_audio, audio_key)
                    heal_updates["audio_key"] = audio_key

                updated = True

            if not thumb_ok:
                try:
                    thumb_path = await self._youtube.download_thumbnail(
                        song.youtube_id, tmp_dir
                    )
                    thumb_key = f"{song.song_name}/{song.youtube_id}.jpg"
                    self._storage.upload_file(thumb_path, thumb_key)
                    heal_updates["thumbnail_key"] = thumb_key
                    updated = True
                except Exception:
                    logger.exception(
                        "Admin heal: thumbnail download failed song_name=%r youtube_id=%r",
                        song.song_name,
                        song.youtube_id,
                    )

            if updated and not song.downloaded_by:
                heal_updates["downloaded_by"] = user.id

            if updated and heal_updates:
                await self._song_dao.update_by_id(song.id, **heal_updates)
            return updated
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    async def get_song_detail(self, song_id: uuid.UUID) -> SongDetailResponse:
        """Full song detail: audio URL, stems, chords."""
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        song_resp = SongResponse.model_validate(song)

        # Resolve audio and thumbnail URLs
        audio_url = None
        if song.audio_key and self._storage.file_exists(song.audio_key):
            audio_url = self._storage.get_url(song.audio_key)

        thumbnail_url = None
        if song.thumbnail_key and self._storage.file_exists(song.thumbnail_key):
            thumbnail_url = self._storage.get_url(song.thumbnail_key)

        # Read stem paths from DB columns
        stems = StemUrls()
        for stem_name in STEM_NAMES:
            key = getattr(song, f"{stem_name}_key", None)
            if key and self._storage.file_exists(key):
                setattr(stems, stem_name, self._storage.get_url(key))

        # Read chords from DB-stored path
        chords: list[ChordEntry] = []
        if song.chords_key and self._storage.file_exists(song.chords_key):
            try:
                raw = self._storage.read_json(song.chords_key)
                if isinstance(raw, list):
                    chords = [ChordEntry(**c) for c in raw]
            except Exception as e:
                logger.warning("Failed to read chords for %s: %s", song.song_name, e)

        # Discover simplified chord variant files (chords_intermediate.json, etc.)
        chord_options: list[ChordOption] = []
        if song.song_name:
            try:
                files = self._storage.list_files(song.song_name)
                variant_keys = sorted(
                    f
                    for f in files
                    if f.rsplit("/", 1)[-1].startswith(CHORD_VARIANT_PREFIX)
                    and f.endswith(CHORD_VARIANT_SUFFIX)
                    and "intermediate" not in f.rsplit("/", 1)[-1].lower()
                )
                for key in variant_keys:
                    try:
                        data = self._storage.read_json(key)
                        if isinstance(data, dict) and "chords" in data:
                            chord_options.append(
                                ChordOption(
                                    name=data.get("name", ""),
                                    description=data.get("description", ""),
                                    capo=data.get("capo", 0),
                                    chords=[ChordEntry(**c) for c in data["chords"]],
                                )
                            )
                    except Exception as e:
                        logger.warning("Failed to read chord variant %s: %s", key, e)
            except Exception as e:
                logger.warning(
                    "Failed to list chord variants for %s: %s", song.song_name, e
                )

        # Read lyrics from DB-stored path
        lyrics: list[LyricsSegment] = []
        lyrics_source: str | None = None
        lyrics_payload: dict[str, Any] | None = None
        if song.lyrics_key and self._storage.file_exists(song.lyrics_key):
            try:
                raw = self._storage.read_json(song.lyrics_key)
                lyrics, lyrics_source, lyrics_payload = _parse_lyrics_payload(raw)
            except Exception as e:
                logger.warning("Failed to read lyrics for %s: %s", song.song_name, e)

        # Read quick (fast-track) lyrics
        quick_lyrics: list[LyricsSegment] = []
        quick_lyrics_source: str | None = None
        quick_lyrics_payload: dict[str, Any] | None = None
        quick_lyrics_key = song.lyrics_quick_key
        # If no DB key yet, probe disk for the file (covers newly-produced files
        # that haven't been persisted to DB yet, e.g. during active processing).
        if not quick_lyrics_key and song.song_name:
            candidate = f"{song.song_name}/lyrics_quick.json"
            if self._storage.file_exists(candidate):
                quick_lyrics_key = candidate
                # Persist to DB so future requests don't need the probe.
                await self._song_dao.update_by_id(song.id, lyrics_quick_key=candidate)
        if quick_lyrics_key and self._storage.file_exists(quick_lyrics_key):
            try:
                raw = self._storage.read_json(quick_lyrics_key)
                quick_lyrics, quick_lyrics_source, quick_lyrics_payload = (
                    _parse_lyrics_payload(raw)
                )
            except Exception as e:
                logger.warning(
                    "Failed to read quick lyrics for %s: %s", song.song_name, e
                )

        # Read corrected lyrics (merged quick text + Whisper timestamps)
        corrected_lyrics: list[LyricsSegment] = []
        corrected_lyrics_source: str | None = None
        corrected_key = song.lyrics_corrected_key
        if not corrected_key and song.song_name:
            candidate = f"{song.song_name}/lyrics_corrected.json"
            if self._storage.file_exists(candidate):
                corrected_key = candidate
                await self._song_dao.update_by_id(
                    song.id, lyrics_corrected_key=candidate
                )
        corrected_payload: dict[str, Any] | None = None

        should_generate_ver3 = (
            song.song_name
            and lyrics_payload is not None
            and quick_lyrics_payload is not None
            and not (corrected_key and self._storage.file_exists(corrected_key))
        )
        if should_generate_ver3:
            corrected_candidate = f"{song.song_name}/lyrics_corrected.json"
            try:
                assert quick_lyrics_payload is not None
                assert lyrics_payload is not None
                corrected_payload, diagnostics = await asyncio.to_thread(
                    merge_lyrics_with_llm,
                    quick_lyrics_payload,
                    lyrics_payload,
                    self._llm,
                )
                self._storage.write_json(corrected_candidate, corrected_payload)
                corrected_key = corrected_candidate
                await self._song_dao.update_by_id(
                    song.id, lyrics_corrected_key=corrected_candidate
                )
                logger.info(
                    "Generated lyrics ver3 for %s (%s/%s aligned words across %s groups)",
                    song.song_name,
                    diagnostics.aligned_words,
                    diagnostics.total_words,
                    diagnostics.mapping_groups,
                )
            except Exception:
                logger.warning(
                    "Failed to generate lyrics ver3 for %s",
                    song.song_name,
                    exc_info=True,
                )

        if corrected_key and self._storage.file_exists(corrected_key):
            try:
                raw = corrected_payload or self._storage.read_json(corrected_key)
                corrected_lyrics, corrected_lyrics_source, _ = _parse_lyrics_payload(
                    raw
                )
            except Exception as e:
                logger.warning(
                    "Failed to read corrected lyrics for %s: %s", song.song_name, e
                )

        # Read tabs and rhythm from storage.
        tabs: list[TabNote] = []
        tabs_source: str | None = None
        rhythm: RhythmInfo | None = None
        tabs_key = song.tabs_key
        if not tabs_key and song.song_name:
            candidate = f"{song.song_name}/tabs.json"
            if self._storage.file_exists(candidate):
                tabs_key = candidate
                await self._song_dao.update_by_id(song.id, tabs_key=candidate)
                await self._song_dao.commit()
        if tabs_key and self._storage.file_exists(tabs_key):
            try:
                raw = self._storage.read_json(tabs_key)
                if isinstance(raw, dict):
                    if isinstance(raw.get("notes"), list):
                        tabs = [TabNote(**n) for n in raw["notes"]]
                        tabs_source = "detected"
                    if isinstance(raw.get("rhythm"), dict):
                        rhythm = RhythmInfo(**raw["rhythm"])
            except Exception as e:
                logger.warning("Failed to read tabs for %s: %s", song.song_name, e)

        # Read Songsterr data (enriched format with tabs, strums, sections).
        strums: list[StrumEvent] = []
        sections: list[SongSection] = []
        source_bpm: float | None = None
        time_signature: list[int] | None = None
        strum_notes: str | None = None
        tutorial_url: str | None = None
        tutorial_links: list[dict] = []
        songsterr_status: str | None = None

        # Determine songsterr status from DB fields
        if song.external_strums_failed:
            songsterr_status = "failed"
        elif not song.artist or not song.song_name:
            songsterr_status = "unavailable"

        external_strums_key = song.external_strums_key
        if external_strums_key and self._storage.file_exists(external_strums_key):
            songsterr_status = "ready"
            try:
                raw_songsterr = self._storage.read_json(external_strums_key)

                if isinstance(raw_songsterr, dict):
                    # New enriched format (songsterr_data.json)
                    if isinstance(raw_songsterr.get("strums"), list):
                        strums = [StrumEvent(**s) for s in raw_songsterr["strums"]]
                    if isinstance(raw_songsterr.get("tabs"), list) and raw_songsterr["tabs"]:
                        # Songsterr tabs take priority over basic-pitch
                        tabs = [TabNote(**n) for n in raw_songsterr["tabs"]]
                        tabs_source = "songsterr"
                    if isinstance(raw_songsterr.get("sections"), list):
                        sections = [SongSection(**s) for s in raw_songsterr["sections"]]
                    if raw_songsterr.get("source_bpm"):
                        source_bpm = float(raw_songsterr["source_bpm"])
                    if isinstance(raw_songsterr.get("time_signature"), list):
                        time_signature = raw_songsterr["time_signature"]
                    if raw_songsterr.get("strum_notes"):
                        strum_notes = raw_songsterr["strum_notes"]
                    if raw_songsterr.get("tutorial_url"):
                        tutorial_url = raw_songsterr["tutorial_url"]
                    if isinstance(raw_songsterr.get("tutorial_links"), list):
                        tutorial_links = raw_songsterr["tutorial_links"]

                elif isinstance(raw_songsterr, list):
                    # Legacy flat array format (external_strums.json)
                    strums = [StrumEvent(**s) for s in raw_songsterr]

            except Exception as e:
                logger.warning(
                    "Failed to read Songsterr data for %s: %s", song.song_name, e
                )

        # Read Songsterr lyrics (ver4)
        ver4_lyrics: list[LyricsSegment] = []
        ver4_lyrics_source: str | None = None
        if song.song_name:
            songsterr_lyrics_key = f"{song.song_name}/lyrics_songsterr.json"
            if self._storage.file_exists(songsterr_lyrics_key):
                try:
                    raw_sl = self._storage.read_json(songsterr_lyrics_key)
                    ver4_lyrics, ver4_lyrics_source, _ = _parse_lyrics_payload(raw_sl)
                except Exception as e:
                    logger.warning(
                        "Failed to read Songsterr lyrics for %s: %s",
                        song.song_name, e,
                    )

        return SongDetailResponse(
            song=song_resp,
            thumbnail_url=thumbnail_url,
            audio_url=audio_url,
            stems=stems,
            stem_types=STEM_DEFINITIONS,
            chords=chords,
            chord_options=chord_options,
            lyrics=lyrics,
            lyrics_source=lyrics_source,
            quick_lyrics=quick_lyrics,
            quick_lyrics_source=quick_lyrics_source,
            corrected_lyrics=corrected_lyrics,
            corrected_lyrics_source=corrected_lyrics_source,
            ver1_lyrics=quick_lyrics,
            ver1_lyrics_source=quick_lyrics_source,
            ver2_lyrics=lyrics,
            ver2_lyrics_source=lyrics_source,
            ver3_lyrics=corrected_lyrics,
            ver3_lyrics_source=corrected_lyrics_source,
            ver4_lyrics=ver4_lyrics,
            ver4_lyrics_source=ver4_lyrics_source,
            tabs=tabs,
            tabs_source=tabs_source,
            strums=strums,
            rhythm=rhythm,
            sections=sections,
            source_bpm=source_bpm,
            time_signature=time_signature,
            strum_notes=strum_notes,
            tutorial_url=tutorial_url,
            tutorial_links=tutorial_links,
            songsterr_status=songsterr_status,
            download_pending=song.download_requested_at is not None,
        )

    def _enrich_song_response(self, song) -> SongResponse:
        """Build a SongResponse with a presigned thumbnail_url."""
        resp = SongResponse.model_validate(song)
        if resp.thumbnail_key:
            resp.thumbnail_url = self._storage.get_url(resp.thumbnail_key)
        return resp

    async def list_songs(
        self,
        query: str | None = None,
        genre: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> PaginatedSongsResponse:
        """List songs with optional search query and genre filter."""
        if query:
            songs, total = await self._song_dao.search(query, genre, offset, limit)
        else:
            songs, total = await self._song_dao.list_all_paginated(genre, offset, limit)
        return PaginatedSongsResponse(
            items=[self._enrich_song_response(s) for s in songs],
            total=total,
            offset=offset,
            limit=limit,
        )

    async def list_recent_songs(
        self,
        offset: int = 0,
        limit: int = 50,
    ) -> PaginatedSongsResponse:
        """Global recent songs (not per-user), paginated."""
        songs, total = await self._song_dao.list_top_recent(
            genre=None, offset=offset, limit=limit
        )
        return PaginatedSongsResponse(
            items=[self._enrich_song_response(s) for s in songs],
            total=total,
            offset=offset,
            limit=limit,
        )

    async def list_top_songs(
        self,
        genre: str | None = None,
        sort: str = "favorites",
        offset: int = 0,
        limit: int = 50,
    ) -> PaginatedSongsResponse:
        """Top songs by favorites, plays, or recent — paginated."""
        if sort == "plays":
            songs, total = await self._song_dao.list_top_by_plays(genre, offset, limit)
        elif sort == "recent":
            songs, total = await self._song_dao.list_top_recent(genre, offset, limit)
        else:
            songs, total = await self._song_dao.list_top_by_favorites(
                genre, offset, limit
            )
        return PaginatedSongsResponse(
            items=[self._enrich_song_response(s) for s in songs],
            total=total,
            offset=offset,
            limit=limit,
        )

    async def record_play(self, song_id: uuid.UUID) -> None:
        """Validate song exists and increment play count."""
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))
        await self._song_dao.increment_play_count(song_id)

    async def list_genres(self) -> list[GenreCount]:
        """Return genre counts from DAO."""
        rows = await self._song_dao.count_by_genre()
        return [
            GenreCount(genre=genre or "unknown", count=count) for genre, count in rows
        ]

    async def update_song_file_keys(
        self,
        song_id: uuid.UUID,
        stem_keys: dict[str, str] | None = None,
        chords_key: str | None = None,
    ) -> None:
        """Update a Song record with stem/chord storage keys after processing."""
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        updates: dict[str, str] = {}
        if stem_keys:
            for stem_name, key in stem_keys.items():
                if stem_name in STEM_NAMES:
                    updates[f"{stem_name}_key"] = key
        if chords_key:
            updates["chords_key"] = chords_key

        if updates:
            await self._song_dao.update_by_id(song.id, **updates)

    async def select_song(
        self,
        song_name: str,
        youtube_id: str | None,
        user_sub: str,
        user_email: str,
    ) -> SongDetailResponse:
        """Select a song: return existing detail or download + index first."""
        # Check by youtube_id first to allow multiple versions of the same song
        if youtube_id:
            existing = await self._song_dao.get_by_youtube_id(youtube_id)
            if existing and existing.audio_key:
                return await self.get_song_detail(existing.id)
        else:
            # No youtube_id — fall back to song_name lookup (e.g. synced songs)
            existing = await self._song_dao.get_by_song_name(song_name)
            if existing and existing.audio_key:
                return await self.get_song_detail(existing.id)
            raise NotFoundError("Song", song_name)

        song_resp = await self.download_song(youtube_id, user_sub, user_email)
        return await self.get_song_detail(song_resp.id)

    async def generate_ai_strum_patterns(
        self, song_id: uuid.UUID,
    ) -> list[SongSection]:
        """Generate AI strum patterns on-demand and persist to songsterr_data.json."""
        from guitar_player.config import get_settings
        from guitar_player.services.llm_service import LlmService

        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))

        external_strums_key = song.external_strums_key
        if not external_strums_key or not self._storage.file_exists(external_strums_key):
            raise BadRequestError("No Songsterr data available for this song")

        raw_songsterr = self._storage.read_json(external_strums_key)
        if not isinstance(raw_songsterr, dict):
            raise BadRequestError("Invalid Songsterr data format")

        sections_data = raw_songsterr.get("sections", [])
        if not sections_data:
            raise BadRequestError("No sections available")

        # Check if LLM patterns already exist
        if any(s.get("llm_pattern") for s in sections_data):
            return [SongSection(**s) for s in sections_data]

        time_signature: tuple[int, int] | None = None
        raw_ts = raw_songsterr.get("time_signature")
        if isinstance(raw_ts, list) and len(raw_ts) == 2:
            time_signature = (raw_ts[0], raw_ts[1])

        settings = get_settings()
        llm = LlmService(settings)
        artist = song.artist or ""
        title = song.title or ""
        tavily_api_key = settings.tavily.api_key
        llm_result = await llm.lookup_strum_patterns(
            artist, title, time_signature, tavily_api_key,
        )

        if llm_result and llm_result.sections:
            llm_map = {s.section.lower(): s.pattern for s in llm_result.sections}

            for sec in sections_data:
                canonical = sec["name"].lower().rstrip("0123456789 ")
                if canonical in llm_map:
                    sec["llm_pattern"] = llm_map[canonical]
                elif len(llm_result.sections) == 1:
                    sec["llm_pattern"] = llm_result.sections[0].pattern

            # Persist updated sections back to storage
            raw_songsterr["sections"] = sections_data
            self._storage.write_json(external_strums_key, raw_songsterr)

        return [SongSection(**s) for s in sections_data]
