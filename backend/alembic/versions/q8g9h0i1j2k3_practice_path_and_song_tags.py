"""song practice tags, user practice fields, practice_progress table

Revision ID: q8g9h0i1j2k3
Revises: p7f8g9h0i1j2
Create Date: 2026-09-28

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "q8g9h0i1j2k3"
down_revision: Union[str, None] = "p7f8g9h0i1j2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("songs", sa.Column("difficulty", sa.String(10), nullable=True))
    op.add_column("songs", sa.Column("chord_count", sa.Integer(), nullable=True))
    op.add_column("songs", sa.Column("easy_chords", sa.String(200), nullable=True))
    op.add_column("songs", sa.Column("easy_capo", sa.Integer(), nullable=True))
    op.add_column("songs", sa.Column("tempo_bpm", sa.Float(), nullable=True))
    op.add_column("songs", sa.Column("tags_computed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_songs_difficulty", "songs", ["difficulty"])

    op.add_column("users", sa.Column("skill_level", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("streak_days", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("last_practice_date", sa.Date(), nullable=True))

    op.create_table(
        "practice_progress",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("song_id", sa.Uuid(), sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("current_step", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("completed_steps", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("learned_chords", sa.String(300), nullable=False, server_default=""),
        sa.Column("stage_progress", sa.Float(), nullable=False, server_default="0"),
        sa.Column("last_practiced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "song_id", name="uq_practice_progress_user_song"),
    )
    op.create_index(
        "ix_practice_progress_user_last_practiced",
        "practice_progress",
        ["user_id", "last_practiced_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_practice_progress_user_last_practiced", table_name="practice_progress")
    op.drop_table("practice_progress")

    op.drop_column("users", "last_practice_date")
    op.drop_column("users", "streak_days")
    op.drop_column("users", "skill_level")

    op.drop_index("ix_songs_difficulty", table_name="songs")
    op.drop_column("songs", "tags_computed_at")
    op.drop_column("songs", "tempo_bpm")
    op.drop_column("songs", "easy_capo")
    op.drop_column("songs", "easy_chords")
    op.drop_column("songs", "chord_count")
    op.drop_column("songs", "difficulty")
