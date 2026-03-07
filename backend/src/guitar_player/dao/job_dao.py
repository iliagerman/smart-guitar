"""Job data access object."""

import uuid
from datetime import datetime
from typing import Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.base import BaseDAO
from guitar_player.models.job import Job


class JobDAO(BaseDAO[Job]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Job)

    async def get_by_user(
        self, user_id: uuid.UUID, offset: int = 0, limit: int = 50
    ) -> Sequence[Job]:
        stmt = (
            select(Job)
            .where(Job.user_id == user_id)
            .order_by(Job.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def has_active_job(self, song_id: uuid.UUID) -> bool:
        stmt = select(Job).where(
            Job.song_id == song_id,
            Job.status.in_(["PENDING", "PROCESSING"]),
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def get_active_job(self, song_id: uuid.UUID) -> Job | None:
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
        return result.scalar_one_or_none()

    async def update_status(
        self,
        job: Job,
        status: str,
        results: Optional[list] = None,
        error_message: Optional[str] = None,
    ) -> Job:
        kwargs: dict = {"status": status}
        if results is not None:
            kwargs["results"] = results
        if error_message is not None:
            kwargs["error_message"] = error_message

        # Keep progress/stage reasonably consistent with status.
        if status == "PENDING":
            kwargs.setdefault("progress", 0)
            kwargs.setdefault("stage", "queued")
        elif status == "PROCESSING":
            kwargs.setdefault("stage", "processing")
        elif status == "COMPLETED":
            from datetime import datetime, timezone

            kwargs["completed_at"] = datetime.now(timezone.utc)
            kwargs.setdefault("progress", 100)
            kwargs.setdefault("stage", "completed")
        elif status == "FAILED":
            kwargs.setdefault("stage", "failed")
        return await self.update(job, **kwargs)

    async def update_progress(
        self, job: Job, progress: int, stage: str | None = None
    ) -> Job:
        """Update a job's progress (0-100) and optional stage."""
        clamped = max(0, min(100, int(progress)))
        kwargs: dict = {"progress": clamped}
        if stage is not None:
            kwargs["stage"] = stage
        return await self.update(job, **kwargs)

    async def list_stale_active_jobs(
        self,
        *,
        updated_before: datetime,
        limit: int = 200,
    ) -> Sequence[Job]:
        """Return active jobs (PENDING/PROCESSING) whose updated_at is older than cutoff."""

        stmt = (
            select(Job)
            .where(Job.status.in_(["PENDING", "PROCESSING"]))
            .where(Job.updated_at < updated_before)
            .order_by(Job.updated_at.asc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return result.scalars().all()
