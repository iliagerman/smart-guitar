"""Favorite model -- join table linking users to their favorite songs."""

import uuid

from sqlalchemy import ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from guitar_player.models.base import Base, UUIDMixin, TimestampMixin


class Favorite(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "song_id", name="uq_favorites_user_song"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    song_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("songs.id", ondelete="CASCADE"), nullable=False
    )

    user = relationship("User", foreign_keys=[user_id], lazy="selectin")
    song = relationship("Song", foreign_keys=[song_id], lazy="selectin")
