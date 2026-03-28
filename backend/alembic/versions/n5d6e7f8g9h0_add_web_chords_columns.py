"""add web_chords columns to songs

Revision ID: n5d6e7f8g9h0
Revises: m4c5d6e7f8g9
Create Date: 2026-03-28

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "n5d6e7f8g9h0"
down_revision: Union[str, None] = "m4c5d6e7f8g9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("songs", sa.Column("web_chords_key", sa.String(500), nullable=True))
    op.add_column("songs", sa.Column("web_chords_failed", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("songs", sa.Column("web_chords_attempted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("songs", "web_chords_attempted_at")
    op.drop_column("songs", "web_chords_failed")
    op.drop_column("songs", "web_chords_key")
