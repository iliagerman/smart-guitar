"""create analytics_events table

Revision ID: k2a3b4c5d6e7
Revises: j1d2e3f4g5h6
Create Date: 2026-03-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "k2a3b4c5d6e7"
down_revision: Union[str, None] = "j1d2e3f4g5h6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "analytics_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("event_category", sa.String(length=30), nullable=False),
        sa.Column("event_source", sa.String(length=20), nullable=False),
        sa.Column("user_sub", sa.String(length=255), nullable=True),
        sa.Column("user_email", sa.String(length=255), nullable=True),
        sa.Column("tenant_id", sa.String(length=255), nullable=True),
        sa.Column("aws_account_id", sa.String(length=32), nullable=True),
        sa.Column("song_id", sa.Uuid(), nullable=True),
        sa.Column("song_title", sa.String(length=500), nullable=True),
        sa.Column("session_id", sa.String(length=64), nullable=True),
        sa.Column("properties", _JSON_TYPE, nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_analytics_events_created_at",
        "analytics_events",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_events_event_type",
        "analytics_events",
        ["event_type"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_events_user_sub", "analytics_events", ["user_sub"], unique=False
    )
    op.create_index(
        "ix_analytics_events_user_email",
        "analytics_events",
        ["user_email"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_events_tenant_id", "analytics_events", ["tenant_id"], unique=False
    )
    op.create_index(
        "ix_analytics_events_aws_account_id",
        "analytics_events",
        ["aws_account_id"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_events_song_id", "analytics_events", ["song_id"], unique=False
    )
    op.create_index(
        "ix_analytics_events_session_id",
        "analytics_events",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_events_event_type_created_at",
        "analytics_events",
        ["event_type", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_events_user_email_created_at",
        "analytics_events",
        ["user_email", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_events_user_email_event_type",
        "analytics_events",
        ["user_email", "event_type"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_events_song_id_created_at",
        "analytics_events",
        ["song_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_events_tenant_id_created_at",
        "analytics_events",
        ["tenant_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_events_aws_account_id_created_at",
        "analytics_events",
        ["aws_account_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_analytics_events_aws_account_id_created_at", table_name="analytics_events"
    )
    op.drop_index(
        "ix_analytics_events_tenant_id_created_at", table_name="analytics_events"
    )
    op.drop_index(
        "ix_analytics_events_song_id_created_at", table_name="analytics_events"
    )
    op.drop_index(
        "ix_analytics_events_user_email_event_type", table_name="analytics_events"
    )
    op.drop_index(
        "ix_analytics_events_user_email_created_at", table_name="analytics_events"
    )
    op.drop_index(
        "ix_analytics_events_event_type_created_at", table_name="analytics_events"
    )
    op.drop_index("ix_analytics_events_session_id", table_name="analytics_events")
    op.drop_index("ix_analytics_events_song_id", table_name="analytics_events")
    op.drop_index("ix_analytics_events_aws_account_id", table_name="analytics_events")
    op.drop_index("ix_analytics_events_tenant_id", table_name="analytics_events")
    op.drop_index("ix_analytics_events_user_email", table_name="analytics_events")
    op.drop_index("ix_analytics_events_user_sub", table_name="analytics_events")
    op.drop_index("ix_analytics_events_event_type", table_name="analytics_events")
    op.drop_index("ix_analytics_events_created_at", table_name="analytics_events")
    op.drop_table("analytics_events")
