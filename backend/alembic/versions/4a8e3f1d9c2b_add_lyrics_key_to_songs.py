"""add lyrics_key to songs

Revision ID: 4a8e3f1d9c2b
Revises: 3b7d2b6c0e1a
Create Date: 2026-02-21

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4a8e3f1d9c2b"
down_revision: Union[str, None] = "3b7d2b6c0e1a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "songs",
        sa.Column("lyrics_key", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("songs", "lyrics_key")
