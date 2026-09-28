"""Practice progress data access object."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.practice_progress import PracticeProgress
from guitar_player.models.song import Song
from guitar_player.schemas.records import PracticeProgressRecord, SongRecord


class PracticeProgressDAO(BaseDAO[PracticeProgress, PracticeProgressRecord]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, PracticeProgress, PracticeProgressRecord)

    async def get_by_user_and_song(
        self, user_id: uuid.UUID, song_id: uuid.UUID,
    ) -> PracticeProgressRecord | None:
        stmt = select(PracticeProgress).where(
            PracticeProgress.user_id == user_id,
            PracticeProgress.song_id == song_id,
        )
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def list_recent_unfinished(
        self, user_id: uuid.UUID, all_steps_mask: int, limit: int,
    ) -> list[tuple[PracticeProgressRecord, SongRecord]]:
        """Most recently practiced songs whose steps aren't all completed."""
        stmt = (
            select(PracticeProgress, Song)
            .join(Song, Song.id == PracticeProgress.song_id)
            .where(
                PracticeProgress.user_id == user_id,
                PracticeProgress.completed_steps != all_steps_mask,
            )
            .order_by(PracticeProgress.last_practiced_at.desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return [
            (self._to_record(progress), SongRecord.model_validate(song))
            for progress, song in result.all()
        ]
