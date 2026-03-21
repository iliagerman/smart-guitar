"""Song data access object."""

import uuid
from datetime import datetime
from typing import Optional, Sequence

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.song import Song
from guitar_player.schemas.records import SongRecord


class SongDAO(BaseDAO[Song, SongRecord]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Song, SongRecord)

    async def acquire_processing_lock(self, song_id: uuid.UUID) -> SongRecord | None:
        """Load a Song row with a write lock for atomic processing deduplication."""
        stmt = select(Song).where(Song.id == song_id)
        try:
            bind = self._session.get_bind()
            dialect = bind.dialect.name if bind else ""
        except Exception:
            dialect = ""
        if dialect != "sqlite":
            stmt = stmt.with_for_update()
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def get_by_youtube_id(self, youtube_id: str) -> SongRecord | None:
        stmt = select(Song).where(Song.youtube_id == youtube_id)
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def list_recent_by_user(self, user_id: uuid.UUID, limit: int = 10) -> list[SongRecord]:
        stmt = (
            select(Song)
            .where(Song.downloaded_by == user_id)
            .order_by(Song.created_at.desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    async def get_by_song_name(self, song_name: str) -> SongRecord | None:
        stmt = select(Song).where(Song.song_name == song_name).limit(1)
        result = await self._session.execute(stmt)
        obj = result.scalars().first()
        return self._to_record(obj) if obj else None

    async def search(
        self,
        query: str,
        genre: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[SongRecord], int]:
        conditions = [
            or_(
                Song.title.ilike(f"%{query}%"),
                Song.artist.ilike(f"%{query}%"),
            )
        ]
        if genre:
            conditions.append(Song.genre == genre)

        count_stmt = select(func.count()).select_from(Song).where(*conditions)
        total = (await self._session.execute(count_stmt)).scalar_one()

        stmt = select(Song).where(*conditions).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()], total

    async def list_all_paginated(
        self,
        genre: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[SongRecord], int]:
        conditions = []
        if genre:
            conditions.append(Song.genre == genre)

        count_stmt = select(func.count()).select_from(Song)
        if conditions:
            count_stmt = count_stmt.where(*conditions)
        total = (await self._session.execute(count_stmt)).scalar_one()

        stmt = select(Song)
        if conditions:
            stmt = stmt.where(*conditions)
        stmt = stmt.offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()], total

    async def list_recent(self, limit: int = 10) -> list[SongRecord]:
        stmt = select(Song).order_by(Song.created_at.desc()).limit(limit)
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    async def list_top_by_favorites(
        self,
        genre: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[SongRecord], int]:
        conditions = []
        if genre:
            conditions.append(Song.genre == genre)

        count_stmt = select(func.count()).select_from(Song)
        if conditions:
            count_stmt = count_stmt.where(*conditions)
        total = (await self._session.execute(count_stmt)).scalar_one()

        stmt = select(Song)
        if conditions:
            stmt = stmt.where(*conditions)
        stmt = stmt.order_by(Song.like_count.desc()).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()], total

    async def list_top_by_plays(
        self,
        genre: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[SongRecord], int]:
        conditions = []
        if genre:
            conditions.append(Song.genre == genre)

        count_stmt = select(func.count()).select_from(Song)
        if conditions:
            count_stmt = count_stmt.where(*conditions)
        total = (await self._session.execute(count_stmt)).scalar_one()

        stmt = select(Song)
        if conditions:
            stmt = stmt.where(*conditions)
        stmt = stmt.order_by(Song.play_count.desc()).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()], total

    async def list_top_recent(
        self,
        genre: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[SongRecord], int]:
        conditions = []
        if genre:
            conditions.append(Song.genre == genre)

        count_stmt = select(func.count()).select_from(Song)
        if conditions:
            count_stmt = count_stmt.where(*conditions)
        total = (await self._session.execute(count_stmt)).scalar_one()

        stmt = select(Song)
        if conditions:
            stmt = stmt.where(*conditions)
        stmt = stmt.order_by(Song.created_at.desc()).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()], total

    async def increment_play_count(self, song_id: uuid.UUID) -> None:
        stmt = (
            update(Song)
            .where(Song.id == song_id)
            .values(play_count=Song.play_count + 1)
        )
        await self._session.execute(stmt)
        await self._session.flush()

    async def increment_like_count(self, song_id: uuid.UUID) -> None:
        stmt = (
            update(Song)
            .where(Song.id == song_id)
            .values(like_count=Song.like_count + 1)
        )
        await self._session.execute(stmt)
        await self._session.flush()

    async def decrement_like_count(self, song_id: uuid.UUID) -> None:
        stmt = (
            update(Song)
            .where(Song.id == song_id)
            .where(Song.like_count > 0)
            .values(like_count=Song.like_count - 1)
        )
        await self._session.execute(stmt)
        await self._session.flush()

    async def count_by_genre(self) -> Sequence[tuple[str | None, int]]:
        stmt = (
            select(Song.genre, func.count().label("count"))
            .group_by(Song.genre)
            .order_by(func.count().desc())
        )
        result = await self._session.execute(stmt)
        return result.all()

    async def list_stale_downloads(
        self, requested_before: datetime, limit: int = 10
    ) -> list[SongRecord]:
        stmt = (
            select(Song)
            .where(
                Song.download_requested_at.isnot(None),
                Song.download_requested_at < requested_before,
            )
            .order_by(Song.download_requested_at.asc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    # --- Methods added during DAO refactoring ---

    async def release_processing_locks(self, job_ids: list[uuid.UUID]) -> None:
        """Set processing_job_id=NULL for songs locked by the given job IDs."""
        if not job_ids:
            return
        stmt = (
            update(Song)
            .where(Song.processing_job_id.in_(job_ids))
            .values(processing_job_id=None)
        )
        await self._session.execute(stmt)
        await self._session.flush()

    async def find_corrupted_youtube_ids(self) -> list[SongRecord]:
        """Find songs whose youtube_id ends with an underscore."""
        stmt = (
            select(Song)
            .where(Song.youtube_id.isnot(None))
            .where(Song.youtube_id.like("%\\_", escape="\\"))
        )
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    async def delete_by_ids(self, ids: list[uuid.UUID]) -> int:
        """Delete songs by IDs. Returns count deleted."""
        if not ids:
            return 0
        stmt = delete(Song).where(Song.id.in_(ids))
        result = await self._session.execute(stmt)
        await self._session.flush()
        return result.rowcount

    async def get_all_ids_with_song_name(self) -> list[tuple[uuid.UUID, str]]:
        """Return (id, song_name) pairs for songs that have a song_name."""
        stmt = select(Song.id, Song.song_name).where(Song.song_name.isnot(None))
        result = await self._session.execute(stmt)
        return [(row[0], row[1]) for row in result.all()]

    async def get_all_youtube_ids(self) -> set[str]:
        """Return the set of all non-NULL youtube_ids."""
        stmt = select(Song.youtube_id).where(Song.youtube_id.isnot(None))
        result = await self._session.execute(stmt)
        return {row[0] for row in result.all()}

    async def get_first_with_audio(self) -> SongRecord | None:
        """Return the oldest song that has an audio_key."""
        stmt = (
            select(Song)
            .where(Song.audio_key.isnot(None))
            .order_by(Song.created_at.asc())
            .limit(1)
        )
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def list_ordered_for_scan(
        self,
        offset: int = 0,
        limit: int = 200,
        *,
        missing_key_columns: list[str] | None = None,
    ) -> list[SongRecord]:
        """List songs ordered by created_at DESC for admin scanning.

        When *missing_key_columns* is provided, filters to songs where at
        least one of those columns is NULL.
        """
        stmt = select(Song).order_by(Song.created_at.desc()).offset(offset).limit(limit)
        if missing_key_columns:
            conditions = [getattr(Song, col).is_(None) for col in missing_key_columns]
            stmt = stmt.where(or_(*conditions))
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    async def list_all_with_song_name(self) -> list[SongRecord]:
        """Return all songs that have a song_name set."""
        stmt = select(Song).where(Song.song_name.isnot(None))
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    async def get_all_songs(self) -> list[SongRecord]:
        """Return all songs (for sync stale detection)."""
        stmt = select(Song)
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]
