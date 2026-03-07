"""add processing lock and deduplication columns to songs

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-03-02

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("songs", sa.Column(
        "processing_job_id", sa.Uuid(), sa.ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True
    ))
    op.add_column("songs", sa.Column("lyrics_failed", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("songs", sa.Column("tabs_failed", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("songs", sa.Column("lyrics_attempted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("songs", sa.Column("tabs_attempted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("songs", sa.Column("merge_attempted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("songs", "merge_attempted_at")
    op.drop_column("songs", "tabs_attempted_at")
    op.drop_column("songs", "lyrics_attempted_at")
    op.drop_column("songs", "tabs_failed")
    op.drop_column("songs", "lyrics_failed")
    op.drop_column("songs", "processing_job_id")
