"""Song model — tracks downloaded YouTube songs."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from guitar_player.models.base import Base, TimestampMixin, UUIDMixin


class Song(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "songs"
    __table_args__ = (Index("ix_songs_created_at", "created_at"),)

    youtube_id: Mapped[Optional[str]] = mapped_column(
        String(20), unique=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    artist: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    song_name: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    audio_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    genre: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    play_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", index=True
    )
    like_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", index=True
    )

    # Stem and chord file paths (storage keys)
    vocals_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    drums_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    bass_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    guitar_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    piano_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    other_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    guitar_removed_key: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    vocals_guitar_key: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    chords_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    lyrics_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    lyrics_quick_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    tabs_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # --- Processing lock & deduplication ---

    # Points to the active Job processing this song.  Set atomically via
    # SELECT FOR UPDATE to prevent concurrent job creation.
    processing_job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True
    )

    # Permanent failure flags — prevent automatic retry on every page load.
    lyrics_failed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    tabs_failed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    # Timestamps for lightweight task cooldowns — prevent re-enqueuing
    # background lyrics/tabs/merge on every poll (5-6 sec interval).
    lyrics_attempted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tabs_attempted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    merge_attempted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Set when audio download is dispatched to homeserver via SQS.
    # Cleared when homeserver confirms completion or fallback finishes.
    download_requested_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    downloaded_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    jobs = relationship(
        "Job",
        back_populates="song",
        cascade="all, delete-orphan",
        passive_deletes=True,
        foreign_keys="Job.song_id",
    )
    processing_job = relationship("Job", foreign_keys=[processing_job_id], lazy="selectin")
    downloader = relationship("User", foreign_keys=[downloaded_by], lazy="selectin")
