"""add ranking indexes for play_count, like_count, created_at

Revision ID: a2b3c4d5e6f7
Revises: 9a1b2c3d4e5f
Create Date: 2026-02-22

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, None] = "9a1b2c3d4e5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(op.f("ix_songs_play_count"), "songs", ["play_count"], unique=False)
    op.create_index(op.f("ix_songs_like_count"), "songs", ["like_count"], unique=False)
    op.create_index(op.f("ix_songs_created_at"), "songs", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_songs_created_at"), table_name="songs")
    op.drop_index(op.f("ix_songs_like_count"), table_name="songs")
    op.drop_index(op.f("ix_songs_play_count"), table_name="songs")
