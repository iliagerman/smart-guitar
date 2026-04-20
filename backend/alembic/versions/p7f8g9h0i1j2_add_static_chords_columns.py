"""add static_chords columns to songs

Revision ID: p7f8g9h0i1j2
Revises: o6e7f8g9h0i1
Create Date: 2026-04-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "p7f8g9h0i1j2"
down_revision: Union[str, None] = "o6e7f8g9h0i1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("songs", sa.Column("static_chords_key", sa.String(500), nullable=True))
    op.add_column("songs", sa.Column("static_chords_failed", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("songs", sa.Column("static_chords_attempted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("songs", "static_chords_attempted_at")
    op.drop_column("songs", "static_chords_failed")
    op.drop_column("songs", "static_chords_key")
