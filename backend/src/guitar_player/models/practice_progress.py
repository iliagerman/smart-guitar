"""Practice path progress -- one row per (user, song) the user has practiced."""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from guitar_player.models.base import Base, TimestampMixin, UUIDMixin


class PracticeProgress(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "practice_progress"
    __table_args__ = (
        UniqueConstraint("user_id", "song_id", name="uq_practice_progress_user_song"),
        Index("ix_practice_progress_user_last_practiced", "user_id", "last_practiced_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    song_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("songs.id", ondelete="CASCADE"), nullable=False
    )
    current_step: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    # Bitmask of finished steps: bit (step - 1).
    completed_steps: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # Comma-separated chord names the user marked as learned.
    learned_chords: Mapped[str] = mapped_column(
        String(300), nullable=False, default="", server_default=""
    )
    # Best fraction (0..1) of the song reached in step 3.
    stage_progress: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, server_default="0"
    )
    last_practiced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
