"""Job model — tracks async processing jobs (stem separation)."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from guitar_player.models.base import Base, TimestampMixin, UUIDMixin


class Job(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "jobs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    song_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("songs.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")
    # A coarse progress indicator for long-running processing.
    # Stored so the UI can render a progress bar and resume after refresh.
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Human-readable stage string, e.g. "queued", "separating", "recognizing_chords".
    stage: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    descriptions: Mapped[Optional[list]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"), nullable=True
    )
    mode: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    results: Mapped[Optional[list]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user = relationship("User", foreign_keys=[user_id], lazy="selectin")
    song = relationship(
        "Song", back_populates="jobs", foreign_keys=[song_id], lazy="selectin"
    )
