"""add genre and play_count to songs

Revision ID: 6c4f5a8b2d1e
Revises: 5b9f4a2e7d3c
Create Date: 2026-02-22

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6c4f5a8b2d1e"
down_revision: Union[str, None] = "5b9f4a2e7d3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "songs",
        sa.Column("genre", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "songs",
        sa.Column("play_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(op.f("ix_songs_genre"), "songs", ["genre"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_songs_genre"), table_name="songs")
    op.drop_column("songs", "play_count")
    op.drop_column("songs", "genre")
