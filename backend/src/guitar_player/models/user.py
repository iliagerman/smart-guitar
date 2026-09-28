"""User model — maps Cognito sub to local user record."""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from guitar_player.models.base import Base, TimestampMixin, UUIDMixin


class User(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "users"

    cognito_sub: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    trial_ends_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    has_seen_onboarding: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="0"
    )
    skill_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    streak_days: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    last_practice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
