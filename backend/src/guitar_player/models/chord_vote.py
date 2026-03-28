"""Chord version vote model -- tracks user votes on user-edited chord versions."""

import uuid

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from guitar_player.models.base import Base, TimestampMixin, UUIDMixin


class ChordVote(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "chord_version_votes"
    __table_args__ = (
        UniqueConstraint(
            "song_id", "version_key", "user_id", name="uq_chord_vote_song_version_user"
        ),
    )

    song_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("songs.id", ondelete="CASCADE"), nullable=False
    )
    version_key: Mapped[str] = mapped_column(String(500), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    vote: Mapped[int] = mapped_column(Integer, nullable=False)
