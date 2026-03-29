"""Song service -- orchestrates song lifecycle."""

import asyncio
import json
import logging
import os
import shutil
import tempfile
import time as _time
import uuid
from datetime import datetime, timezone
from typing import Any

import boto3
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.chord_vote_dao import ChordVoteDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.exceptions import BadRequestError, NotFoundError
from guitar_player.schemas.song import (
    ChordVersionVoteResponse,
    EnrichedSearchResult,
    GenreCount,
    PaginatedSongsResponse,
    SaveUserChordsRequest,
    SaveUserChordsResponse,
    SongDetailResponse,
    SongResponse,
    SongSection,
)
from guitar_player.services.artwork_service import ArtworkService
from guitar_player.services.audio_normalize import transcode_audio_to_mp3_cbr192
from guitar_player.services.llm_service import LlmService
from guitar_player.services.youtube_service import YoutubeService
from guitar_player.storage import StorageBackend
from guitar_player.utils.youtube_filters import is_probable_live_performance_title

from .audio_healing import heal_audio_and_thumbnail
from .chords import (
    delete_user_chords,
    generate_ai_strum_patterns,
    save_user_chords,
    vote_chord_version,
)
from .detail import build_song_detail
from .helpers import STEM_NAMES, slug_to_display, to_folder_name

logger = logging.getLogger(__name__)


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
        self._chord_vote_dao = ChordVoteDAO(session)

    # --- Search ---

    async def search_youtube(self, query: str, max_results: int = 10) -> list[dict]:
        return await self._youtube.search(query, max_results)

    async def search_youtube_enriched(
        self, query: str, max_results: int = 10,
    ) -> list[EnrichedSearchResult]:
        """Search YouTube, parse results via LLM, check local existence."""
        raw_results = await self._youtube.search(query, max_results)
        if not raw_results:
            return []

        parsed_items = await self._llm.parse_search_results(raw_results)
        enriched: list[EnrichedSearchResult] = []

        for raw, parsed in zip(raw_results, parsed_items):
            yt_id = raw.youtube_id
            db_song = await self._song_dao.get_by_youtube_id(yt_id)
            exists = db_song is not None and db_song.audio_key is not None

            enriched.append(
                EnrichedSearchResult(
                    artist=parsed.artist,
                    song=parsed.song,
                    genre=parsed.genre,
                    youtube_id=yt_id,
                    title=raw.title,
                    link=f"https://www.youtube.com/watch?v={yt_id}",
                    thumbnail_url=raw.thumbnail_url,
                    duration_seconds=raw.duration_seconds,
                    view_count=raw.view_count,
                    exists_locally=exists,
                    song_id=db_song.id if db_song else None,
                )
            )

        enriched.sort(key=lambda r: (not r.exists_locally,))
        return enriched

    # --- Download ---

    async def download_song(
        self, youtube_id: str, user_sub: str, user_email: str,
    ) -> SongResponse:
        """Download a song from YouTube, upload to storage, create DB record."""
        existing = await self._song_dao.get_by_youtube_id(youtube_id)
        if existing and existing.audio_key and self._storage.file_exists(existing.audio_key):
            return SongResponse.model_validate(existing)

        t0_total = _time.monotonic()
        title_for_policy = await self._youtube.fetch_title(youtube_id)
        if not title_for_policy:
            raise BadRequestError("Could not verify YouTube video title; please try again.")

        if is_probable_live_performance_title(title_for_policy):
            raise BadRequestError(
                f"Refusing to download probable live performance: {title_for_policy}"
            )

        parsed = await self._parse_song_metadata(title_for_policy, youtube_id)
        song_name = f"{parsed['artist_folder']}/{parsed['song_folder']}/{youtube_id}"

        tmp_dir = tempfile.mkdtemp(prefix="song_dl_")
        try:
            thumb_path, thumbnail_filename = await self._fetch_thumbnail(
                parsed["artist_folder"], parsed["song_folder"], youtube_id, tmp_dir,
            )

            canonical_audio_key = f"{song_name}/audio.mp3"
            thumbnail_key = f"{song_name}/{thumbnail_filename}"
            user = await self._user_dao.get_or_create(user_sub, user_email)

            song = await self._create_or_update_song_record(
                existing, youtube_id, parsed, song_name, user.id,
            )

            song = await self._upload_and_finalize(
                song, youtube_id, song_name, canonical_audio_key,
                thumbnail_key, thumb_path, tmp_dir,
            )

            logger.info(
                "TIMING download_song total %.1fs [yt=%s]",
                _time.monotonic() - t0_total, youtube_id,
            )
            return SongResponse.model_validate(song)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    async def _parse_song_metadata(
        self, title: str, youtube_id: str,
    ) -> dict[str, str | None]:
        """Parse artist/song/genre from title via LLM with fallback."""
        try:
            t0 = _time.monotonic()
            parsed = await self._llm.parse_song_name(title)
            logger.info(
                "TIMING llm.parse_song_name took %.1fs [yt=%s]",
                _time.monotonic() - t0, youtube_id,
            )
            return {
                "artist_folder": parsed.artist or "unknown",
                "song_folder": parsed.song,
                "artist_display": slug_to_display(parsed.artist or "unknown"),
                "title_display": slug_to_display(parsed.song),
                "genre": parsed.genre,
            }
        except Exception as e:
            logger.warning("LLM name parsing failed, using fallback: %s", e)
            return {
                "artist_folder": to_folder_name("unknown_artist"),
                "song_folder": to_folder_name(title),
                "artist_display": "Unknown Artist",
                "title_display": title,
                "genre": None,
            }

    async def _fetch_thumbnail(
        self, artist_folder: str, song_folder: str,
        youtube_id: str, tmp_dir: str,
    ) -> tuple[str, str]:
        """Fetch artwork (official first, YouTube fallback). Returns (path, filename)."""
        t0 = _time.monotonic()
        thumb_path = await self._artwork.fetch_artwork(artist_folder, song_folder, tmp_dir)
        logger.info(
            "TIMING artwork.fetch_artwork took %.1fs [yt=%s]",
            _time.monotonic() - t0, youtube_id,
        )
        if thumb_path:
            logger.info("Using official artwork for %s/%s", artist_folder, song_folder)
            return thumb_path, "cover.jpg"

        logger.info(
            "No official artwork for %s/%s, falling back to YouTube thumbnail",
            artist_folder, song_folder,
        )
        thumb_path = await self._youtube.download_thumbnail(youtube_id, tmp_dir)
        return thumb_path, f"{youtube_id}.jpg"

    async def _create_or_update_song_record(
        self, existing: Any, youtube_id: str,
        parsed: dict[str, str | None], song_name: str,
        user_id: uuid.UUID,
    ) -> Any:
        """Create or update the song DB record."""
        if existing:
            return await self._song_dao.update_by_id(
                existing.id,
                song_name=song_name,
                title=parsed["title_display"] or youtube_id,
                artist=parsed["artist_display"],
                genre=parsed["genre"],
                downloaded_by=user_id,
            )
        return await self._song_dao.create(
            youtube_id=youtube_id,
            title=parsed["title_display"] or youtube_id,
            artist=parsed["artist_display"],
            genre=parsed["genre"],
            duration_seconds=None,
            song_name=song_name,
            downloaded_by=user_id,
        )

    async def _upload_and_finalize(
        self, song: Any, youtube_id: str, song_name: str,
        canonical_audio_key: str, thumbnail_key: str,
        thumb_path: str, tmp_dir: str,
    ) -> Any:
        """Upload files (SQS or local) and update DB with storage keys."""
        from guitar_player.config import get_settings

        sqs_queue_url = get_settings().youtube.youtube_download_queue_url

        if sqs_queue_url:
            return await self._upload_via_sqs(
                song, youtube_id, canonical_audio_key,
                thumbnail_key, thumb_path, sqs_queue_url,
            )
        return await self._upload_locally(
            song, youtube_id, song_name, canonical_audio_key,
            thumbnail_key, thumb_path, tmp_dir,
        )

    async def _upload_via_sqs(
        self, song: Any, youtube_id: str, audio_key: str,
        thumbnail_key: str, thumb_path: str, sqs_queue_url: str,
    ) -> Any:
        """Upload thumbnail and send SQS download request for audio."""
        self._storage.upload_file(thumb_path, thumbnail_key)
        song = await self._song_dao.update_by_id(
            song.id,
            audio_key=audio_key,
            thumbnail_key=thumbnail_key,
            download_requested_at=datetime.now(timezone.utc),
        )
        await self._publish_download_request(
            youtube_id=youtube_id,
            target_s3_key=audio_key,
            song_id=song.id,
            sqs_queue_url=sqs_queue_url,
        )
        return song

    async def _upload_locally(
        self, song: Any, youtube_id: str, song_name: str,
        canonical_audio_key: str, thumbnail_key: str,
        thumb_path: str, tmp_dir: str,
    ) -> Any:
        """Download audio locally, transcode, and upload."""
        t0 = _time.monotonic()
        local_audio, _raw_title, _meta = await self._youtube.download(
            youtube_id, tmp_dir, skip_preflight=True,
        )
        logger.info(
            "TIMING youtube.download took %.1fs [yt=%s]",
            _time.monotonic() - t0, youtube_id,
        )

        local_mp3 = os.path.join(tmp_dir, "audio.mp3")
        audio_key_to_use = canonical_audio_key
        try:
            transcode_audio_to_mp3_cbr192(local_audio, local_mp3)
            self._storage.upload_file(local_mp3, canonical_audio_key)
        except Exception:
            logger.exception(
                "Failed to transcode %s to canonical MP3; falling back", local_audio,
            )
            audio_filename = os.path.basename(local_audio)
            audio_key_to_use = f"{song_name}/{audio_filename}"
            self._storage.upload_file(local_audio, audio_key_to_use)

        self._storage.upload_file(thumb_path, thumbnail_key)
        return await self._song_dao.update_by_id(
            song.id, audio_key=audio_key_to_use, thumbnail_key=thumbnail_key,
        )

    async def _publish_download_request(
        self, youtube_id: str, target_s3_key: str,
        song_id: uuid.UUID, sqs_queue_url: str,
    ) -> None:
        """Send a YouTube download request to the homeserver via SQS."""
        from guitar_player.config import get_settings
        from guitar_player.request_context import (
            request_id_var,
            user_email_var,
            user_id_var,
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
            youtube_id, target_s3_key,
        )

    # --- Read / Query ---

    async def get_song(self, song_id: uuid.UUID) -> SongResponse:
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))
        return SongResponse.model_validate(song)

    async def get_file_key(self, song_id: uuid.UUID, column_name: str) -> str | None:
        """Return a raw storage key for a song column."""
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
        """Clear download_requested_at if the audio file now exists in storage."""
        song = await self._song_dao.get_by_id(song_id)
        if not song or song.download_requested_at is None:
            return False
        if song.audio_key and self._storage.file_exists(song.audio_key):
            await self._song_dao.update_by_id(song_id, download_requested_at=None)
            return True
        return False

    async def get_song_detail(self, song_id: uuid.UUID) -> SongDetailResponse:
        """Full song detail: audio URL, stems, chords."""
        return await build_song_detail(
            song_id, self._song_dao, self._chord_vote_dao,
            self._storage, self._llm,
        )

    def _enrich_song_response(self, song: Any) -> SongResponse:
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
            total=total, offset=offset, limit=limit,
        )

    async def list_recent_songs(
        self, offset: int = 0, limit: int = 50,
    ) -> PaginatedSongsResponse:
        """Global recent songs (not per-user), paginated."""
        songs, total = await self._song_dao.list_top_recent(
            genre=None, offset=offset, limit=limit,
        )
        return PaginatedSongsResponse(
            items=[self._enrich_song_response(s) for s in songs],
            total=total, offset=offset, limit=limit,
        )

    async def list_top_songs(
        self, genre: str | None = None, sort: str = "favorites",
        offset: int = 0, limit: int = 50,
    ) -> PaginatedSongsResponse:
        """Top songs by favorites, plays, or recent -- paginated."""
        if sort == "plays":
            songs, total = await self._song_dao.list_top_by_plays(genre, offset, limit)
        elif sort == "recent":
            songs, total = await self._song_dao.list_top_recent(genre, offset, limit)
        else:
            songs, total = await self._song_dao.list_top_by_favorites(genre, offset, limit)
        return PaginatedSongsResponse(
            items=[self._enrich_song_response(s) for s in songs],
            total=total, offset=offset, limit=limit,
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
        self, song_id: uuid.UUID,
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
        self, song_name: str, youtube_id: str | None,
        user_sub: str, user_email: str,
    ) -> SongDetailResponse:
        """Select a song: return existing detail or download + index first."""
        if youtube_id:
            existing = await self._song_dao.get_by_youtube_id(youtube_id)
            if existing and existing.audio_key:
                return await self.get_song_detail(existing.id)
        else:
            existing = await self._song_dao.get_by_song_name(song_name)
            if existing and existing.audio_key:
                return await self.get_song_detail(existing.id)
            raise NotFoundError("Song", song_name)

        song_resp = await self.download_song(youtube_id, user_sub, user_email)
        return await self.get_song_detail(song_resp.id)

    # --- Chord Management (delegated) ---

    async def generate_ai_strum_patterns(
        self, song_id: uuid.UUID,
    ) -> list[SongSection]:
        """Generate AI strum patterns on-demand."""
        return await generate_ai_strum_patterns(
            song_id, self._song_dao, self._storage,
        )

    async def save_user_chords(
        self, song_id: uuid.UUID,
        request: SaveUserChordsRequest,
        user_email: str,
    ) -> SaveUserChordsResponse:
        """Save user-edited chords as a new chord variant."""
        return await save_user_chords(
            song_id, request, user_email,
            self._song_dao, self._storage, self.get_song_detail,
        )

    async def delete_user_chords(
        self, song_id: uuid.UUID, user_email: str,
    ) -> SongDetailResponse:
        """Delete the chord version created by this user."""
        return await delete_user_chords(
            song_id, user_email,
            self._song_dao, self._storage, self.get_song_detail,
        )

    async def vote_chord_version(
        self, song_id: uuid.UUID, version_key: str,
        user_sub: str, vote: int,
    ) -> ChordVersionVoteResponse:
        """Submit or update a user's vote on a chord version."""
        return await vote_chord_version(
            song_id, version_key, user_sub, vote,
            self._song_dao, self._user_dao, self._chord_vote_dao,
        )

    # --- User helpers ---

    async def resolve_user_email(self, user_sub: str, fallback_email: str | None) -> str | None:
        """Resolve user email from cognito sub, using fallback if available."""
        if fallback_email:
            return fallback_email
        db_user = await self._user_dao.get_by_cognito_sub(user_sub)
        return db_user.email if db_user else None

    # --- Admin operations ---

    async def get_song_record(self, song_id: uuid.UUID) -> Any:
        """Return the raw SongRecord for admin operations."""
        song = await self._song_dao.get_by_id(song_id)
        if not song:
            raise NotFoundError("Song", str(song_id))
        return song

    async def clear_song_keys(self, song_id: uuid.UUID, **kwargs: Any) -> None:
        """Clear specific DB fields on a song record (admin operation)."""
        await self._song_dao.update_by_id(song_id, **kwargs)

    def safe_delete_file(self, key: str | None) -> None:
        """Delete a file from storage if it exists, silently ignoring errors."""
        if not key:
            return
        try:
            if self._storage.file_exists(key):
                self._storage.delete_file(key)
        except Exception:
            pass

    # --- Audio Healing (delegated) ---

    async def admin_heal_audio_and_thumbnail(
        self, song_id: uuid.UUID, user_sub: str, user_email: str,
    ) -> bool:
        """Best-effort repair for missing original audio/thumbnail."""
        return await heal_audio_and_thumbnail(
            song_id, user_sub, user_email,
            self._song_dao, self._user_dao, self._storage, self._youtube,
        )
