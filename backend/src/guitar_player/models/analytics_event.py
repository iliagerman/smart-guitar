"""Analytics event model for internal BI reporting."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Index, JSON, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from guitar_player.models.base import Base, UUIDMixin


class AnalyticsEvent(UUIDMixin, Base):
    __tablename__ = "analytics_events"
    __table_args__ = (
        Index("ix_analytics_events_event_type_created_at", "event_type", "created_at"),
        Index("ix_analytics_events_user_email_created_at", "user_email", "created_at"),
        Index("ix_analytics_events_user_email_event_type", "user_email", "event_type"),
        Index("ix_analytics_events_song_id_created_at", "song_id", "created_at"),
        Index("ix_analytics_events_tenant_id_created_at", "tenant_id", "created_at"),
        Index(
            "ix_analytics_events_aws_account_id_created_at",
            "aws_account_id",
            "created_at",
        ),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    event_category: Mapped[str] = mapped_column(String(30), nullable=False)
    event_source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="server"
    )
    user_sub: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    user_email: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )
    tenant_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )
    aws_account_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, index=True
    )
    song_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    song_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    session_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    properties: Mapped[dict[str, Any] | None] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"), nullable=True
    )
