"""Practice path -- per-song step progress, the daily streak and the skill level."""

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from guitar_player.dao.practice_progress_dao import PracticeProgressDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.dao.user_dao import UserDAO
from guitar_player.enums import SkillLevel
from guitar_player.exceptions import NotFoundError
from guitar_player.schemas.practice import (
    PracticeProgressResponse,
    PracticeSongProgress,
    PracticeSummaryResponse,
    SavePracticeProgressRequest,
    SkillLevelResponse,
)
from guitar_player.schemas.records import PracticeProgressRecord
from guitar_player.services.song_service.helpers import song_response
from guitar_player.storage import StorageBackend

PRACTICE_STEPS = (1, 2, 3, 4)
ALL_STEPS_MASK = sum(1 << (step - 1) for step in PRACTICE_STEPS)
CONTINUE_SONGS_LIMIT = 3


def steps_to_mask(steps: list[int]) -> int:
    return sum({1 << (step - 1) for step in steps})


def mask_to_steps(mask: int) -> list[int]:
    return [step for step in PRACTICE_STEPS if mask & (1 << (step - 1))]


def next_streak(streak: int, last_practice: date | None, today: date) -> int:
    """Streak after practicing today: unchanged if already practiced, +1 after yesterday."""
    if last_practice == today:
        return streak
    if last_practice == today - timedelta(days=1):
        return streak + 1
    return 1


def live_streak(streak: int, last_practice: date | None, today: date) -> int:
    """The stored streak, or 0 once a whole day has passed without practice."""
    if last_practice in (today, today - timedelta(days=1)):
        return streak
    return 0


def _to_response(progress: PracticeProgressRecord) -> PracticeProgressResponse:
    return PracticeProgressResponse(
        song_id=progress.song_id,
        current_step=progress.current_step,
        completed_steps=mask_to_steps(progress.completed_steps),
        learned_chords=[c for c in progress.learned_chords.split(",") if c],
        stage_progress=progress.stage_progress,
        last_practiced_at=progress.last_practiced_at,
    )


class PracticeService:
    def __init__(self, session: AsyncSession, storage: StorageBackend) -> None:
        self._storage = storage
        self._user_dao = UserDAO(session)
        self._song_dao = SongDAO(session)
        self._progress_dao = PracticeProgressDAO(session)

    async def get_summary(self, user_sub: str, user_email: str) -> PracticeSummaryResponse:
        user = await self._user_dao.get_or_create(user_sub, user_email)
        today = datetime.now(timezone.utc).date()
        recent = await self._progress_dao.list_recent_unfinished(
            user.id, ALL_STEPS_MASK, CONTINUE_SONGS_LIMIT,
        )
        return PracticeSummaryResponse(
            skill_level=user.skill_level,
            streak_days=live_streak(user.streak_days, user.last_practice_date, today),
            practiced_today=user.last_practice_date == today,
            continue_songs=[
                PracticeSongProgress(song=song_response(self._storage, song), progress=_to_response(progress))
                for progress, song in recent
            ],
        )

    async def set_skill_level(
        self, user_sub: str, user_email: str, level: SkillLevel,
    ) -> SkillLevelResponse:
        user = await self._user_dao.get_or_create(user_sub, user_email)
        await self._user_dao.update_by_id(user.id, skill_level=level.value)
        return SkillLevelResponse(skill_level=level)

    async def get_song_progress(
        self, user_sub: str, user_email: str, song_id: uuid.UUID,
    ) -> PracticeProgressResponse:
        await self._require_song(song_id)
        user = await self._user_dao.get_or_create(user_sub, user_email)
        progress = await self._progress_dao.get_by_user_and_song(user.id, song_id)
        return _to_response(progress) if progress else PracticeProgressResponse(song_id=song_id)

    async def save_song_progress(
        self, user_sub: str, user_email: str, song_id: uuid.UUID,
        body: SavePracticeProgressRequest,
    ) -> PracticeProgressResponse:
        """Upsert the song's progress (best stage_progress wins) and count today toward the streak."""
        await self._require_song(song_id)
        user = await self._user_dao.get_or_create(user_sub, user_email)
        now = datetime.now(timezone.utc)
        fields = {
            "current_step": body.current_step,
            "completed_steps": steps_to_mask(body.completed_steps),
            "learned_chords": ",".join(body.learned_chords),
            "last_practiced_at": now,
        }

        existing = await self._progress_dao.get_by_user_and_song(user.id, song_id)
        if existing:
            progress = await self._progress_dao.update_by_id(
                existing.id,
                stage_progress=max(existing.stage_progress, body.stage_progress),
                **fields,
            )
        else:
            progress = await self._progress_dao.create(
                user_id=user.id, song_id=song_id, stage_progress=body.stage_progress, **fields,
            )

        today = now.date()
        await self._user_dao.update_by_id(
            user.id,
            streak_days=next_streak(user.streak_days, user.last_practice_date, today),
            last_practice_date=today,
        )
        return _to_response(progress)

    async def _require_song(self, song_id: uuid.UUID) -> None:
        if not await self._song_dao.get_by_id(song_id):
            raise NotFoundError("Song", str(song_id))
