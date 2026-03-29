"""Job data access object."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.job import Job
from guitar_player.schemas.records import JobRecord


class JobDAO(BaseDAO[Job, JobRecord]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Job, JobRecord)

    async def get_by_user(
        self, user_id: uuid.UUID, offset: int = 0, limit: int = 50
    ) -> list[JobRecord]:
        stmt = (
            select(Job)
            .where(Job.user_id == user_id)
            .order_by(Job.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    async def has_active_job(self, song_id: uuid.UUID) -> bool:
        stmt = select(Job).where(
            Job.song_id == song_id,
            Job.status.in_(["PENDING", "PROCESSING"]),
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def get_active_job(self, song_id: uuid.UUID) -> JobRecord | None:
        """Return the most recent active job for a song (PENDING/PROCESSING), if any."""
        stmt = (
            select(Job)
            .where(
                Job.song_id == song_id,
                Job.status.in_(["PENDING", "PROCESSING"]),
            )
            .order_by(Job.created_at.desc())
            .limit(1)
        )
        result = await self._session.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._to_record(obj) if obj else None

    async def update_status(
        self,
        job_id: uuid.UUID,
        status: str,
        results: list | None = None,
        error_message: str | None = None,
    ) -> JobRecord | None:
        kwargs: dict = {"status": status}
        if results is not None:
            kwargs["results"] = results
        if error_message is not None:
            kwargs["error_message"] = error_message

        if status == "PENDING":
            kwargs.setdefault("progress", 0)
            kwargs.setdefault("stage", "queued")
        elif status == "PROCESSING":
            kwargs.setdefault("stage", "processing")
        elif status == "COMPLETED":
            kwargs["completed_at"] = datetime.now(timezone.utc)
            kwargs.setdefault("progress", 100)
            kwargs.setdefault("stage", "completed")
        elif status == "FAILED":
            kwargs.setdefault("stage", "failed")
        return await self.update_by_id(job_id, **kwargs)

    async def update_progress(
        self, job_id: uuid.UUID, progress: int, stage: str | None = None
    ) -> JobRecord | None:
        clamped = max(0, min(100, int(progress)))
        kwargs: dict = {"progress": clamped}
        if stage is not None:
            kwargs["stage"] = stage
        return await self.update_by_id(job_id, **kwargs)

    async def list_stale_active_jobs(
        self,
        *,
        updated_before: datetime,
        limit: int = 200,
    ) -> list[JobRecord]:
        stmt = (
            select(Job)
            .where(Job.status.in_(["PENDING", "PROCESSING"]))
            .where(Job.updated_at < updated_before)
            .order_by(Job.updated_at.asc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return [self._to_record(obj) for obj in result.scalars().all()]

    # --- Methods added during DAO refactoring ---

    async def delete_by_song_ids(self, song_ids: list[uuid.UUID]) -> int:
        """Delete all jobs for the given song IDs. Returns count deleted."""
        if not song_ids:
            return 0
        stmt = delete(Job).where(Job.song_id.in_(song_ids))
        result = await self._session.execute(stmt)
        await self._session.flush()
        return result.rowcount

    async def fail_stale_before(self, cutoff: datetime) -> list[uuid.UUID]:
        """Mark all PENDING/PROCESSING jobs older than cutoff as FAILED.

        Returns the list of job IDs that were marked failed.
        """
        # Find stale IDs first
        id_stmt = (
            select(Job.id)
            .where(Job.status.in_(["PENDING", "PROCESSING"]))
            .where(Job.updated_at < cutoff)
        )
        id_result = await self._session.execute(id_stmt)
        stale_ids = [row[0] for row in id_result.all()]

        if not stale_ids:
            return []

        stmt = (
            update(Job)
            .where(Job.id.in_(stale_ids))
            .values(status="FAILED", stage="failed", error_message="Server restarted")
        )
        await self._session.execute(stmt)
        await self._session.flush()
        return stale_ids
