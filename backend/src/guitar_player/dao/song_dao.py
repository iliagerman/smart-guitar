"""Song data access object."""

import uuid
from datetime import datetime
from typing import Optional, Sequence

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.song import Song


class SongDAO(BaseDAO[Song]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Song)

    async def acquire_processing_lock(self, song_id: uuid.UUID) -> Song | None:
        """Load a Song row with a write lock for atomic processing deduplication.

        On PostgreSQL this issues ``SELECT ... FOR UPDATE``, serializing
        concurrent callers so only one transaction can check-and-set
        ``processing_job_id`` at a time.

        On SQLite (tests/local dev) the ``FOR UPDATE`` clause is omitted;
        the ``BEGIN IMMEDIATE`` transaction mode configured in ``database.py``
        provides equivalent serialization.
        """
        stmt = select(Song).where(Song.id == song_id)
        try:
            bind = self._session.get_bind()
            dialect = bind.dialect.name if bind else ""
        except Exception:
            dialect = ""
        if dialect != "sqlite":
            stmt = stmt.with_for_update()
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_youtube_id(self, youtube_id: str) -> Song | None:
        stmt = select(Song).where(Song.youtube_id == youtube_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_recent_by_user(self, user_id: uuid.UUID, limit: int = 10) -> Sequence[Song]:
        stmt = (
            select(Song)
            .where(Song.downloaded_by == user_id)
            .order_by(Song.created_at.desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def get_by_song_name(self, song_name: str) -> Song | None:
        stmt = select(Song).where(Song.song_name == song_name)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def search(
        self,
        query: str,
        genre: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[Sequence[Song], int]:
        """Search songs by title or artist, with optional genre filter. Returns (songs, total)."""
        conditions = [
            or_(
                Song.title.ilike(f"%{query}%"),
                Song.artist.ilike(f"%{query}%"),
            )
        ]
        if genre:
            conditions.append(Song.genre == genre)

        # Total count
        count_stmt = select(func.count()).select_from(Song).where(*conditions)
        total = (await self._session.execute(count_stmt)).scalar_one()

        # Paginated results
        stmt = select(Song).where(*conditions).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return result.scalars().all(), total

    async def list_all_paginated(
        self,
        genre: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[Sequence[Song], int]:
        """List all songs with optional genre filter + total count."""
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
        return result.scalars().all(), total

    async def list_recent(self, limit: int = 10) -> Sequence[Song]:
        """Global recent songs, ordered by created_at DESC."""
        stmt = select(Song).order_by(Song.created_at.desc()).limit(limit)
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def list_top_by_favorites(
        self,
        genre: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[Sequence[Song], int]:
        """Top songs by like_count DESC with pagination. Returns (songs, total)."""
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
        return result.scalars().all(), total

    async def list_top_by_plays(
        self,
        genre: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[Sequence[Song], int]:
        """Top songs by play_count DESC with pagination. Returns (songs, total)."""
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
        return result.scalars().all(), total

    async def list_top_recent(
        self,
        genre: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[Sequence[Song], int]:
        """Top songs by created_at DESC with pagination. Returns (songs, total)."""
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
        return result.scalars().all(), total

    async def increment_play_count(self, song_id: uuid.UUID) -> None:
        """Atomic play_count = play_count + 1."""
        stmt = (
            update(Song)
            .where(Song.id == song_id)
            .values(play_count=Song.play_count + 1)
        )
        await self._session.execute(stmt)
        await self._session.flush()

    async def increment_like_count(self, song_id: uuid.UUID) -> None:
        """Atomic like_count = like_count + 1."""
        stmt = (
            update(Song)
            .where(Song.id == song_id)
            .values(like_count=Song.like_count + 1)
        )
        await self._session.execute(stmt)
        await self._session.flush()

    async def decrement_like_count(self, song_id: uuid.UUID) -> None:
        """Atomic like_count = max(like_count - 1, 0)."""
        stmt = (
            update(Song)
            .where(Song.id == song_id)
            .where(Song.like_count > 0)
            .values(like_count=Song.like_count - 1)
        )
        await self._session.execute(stmt)
        await self._session.flush()

    async def count_by_genre(self) -> Sequence[tuple[str | None, int]]:
        """GROUP BY genre with counts."""
        stmt = (
            select(Song.genre, func.count().label("count"))
            .group_by(Song.genre)
            .order_by(func.count().desc())
        )
        result = await self._session.execute(stmt)
        return result.all()

    async def list_stale_downloads(
        self, requested_before: datetime, limit: int = 10
    ) -> Sequence[Song]:
        """Find songs with download_requested_at older than the cutoff."""
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
        return result.scalars().all()
