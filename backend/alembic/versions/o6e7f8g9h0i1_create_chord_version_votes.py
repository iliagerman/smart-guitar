"""create chord_version_votes table

Revision ID: o6e7f8g9h0i1
Revises: n5d6e7f8g9h0
Create Date: 2026-03-28

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "o6e7f8g9h0i1"
down_revision: Union[str, None] = "n5d6e7f8g9h0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chord_version_votes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("song_id", sa.Uuid(), sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_key", sa.String(500), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vote", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("song_id", "version_key", "user_id", name="uq_chord_vote_song_version_user"),
    )


def downgrade() -> None:
    op.drop_table("chord_version_votes")
