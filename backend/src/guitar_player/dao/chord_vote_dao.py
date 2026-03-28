"""Chord version vote data access object."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.chord_vote import ChordVote
from guitar_player.schemas.records import ChordVoteRecord


class ChordVoteDAO(BaseDAO[ChordVote, ChordVoteRecord]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, ChordVote, ChordVoteRecord)

    async def upsert_vote(
        self,
        song_id: uuid.UUID,
        version_key: str,
        user_id: uuid.UUID,
        vote: int,
    ) -> ChordVoteRecord:
        """Insert or update a user's vote on a chord version."""
        stmt = select(ChordVote).where(
            ChordVote.song_id == song_id,
            ChordVote.version_key == version_key,
            ChordVote.user_id == user_id,
        )
        result = await self._session.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            existing.vote = vote
            await self._session.flush()
            await self._session.refresh(existing)
            return self._to_record(existing)

        return await self.create(
            song_id=song_id,
            version_key=version_key,
            user_id=user_id,
            vote=vote,
        )

    async def get_vote_counts(self, song_id: uuid.UUID) -> dict[str, int]:
        """Return net vote score per version_key for a song."""
        stmt = (
            select(ChordVote.version_key, func.sum(ChordVote.vote).label("score"))
            .where(ChordVote.song_id == song_id)
            .group_by(ChordVote.version_key)
        )
        result = await self._session.execute(stmt)
        return {row[0]: int(row[1]) for row in result.all()}

    async def get_user_votes(
        self, song_id: uuid.UUID, user_id: uuid.UUID
    ) -> dict[str, int]:
        """Return a user's votes for a song, keyed by version_key."""
        stmt = select(ChordVote.version_key, ChordVote.vote).where(
            ChordVote.song_id == song_id,
            ChordVote.user_id == user_id,
        )
        result = await self._session.execute(stmt)
        return {row[0]: row[1] for row in result.all()}
