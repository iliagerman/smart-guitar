"""add external_strums columns to songs

Revision ID: l3b4c5d6e7f8
Revises: k2a3b4c5d6e7
Create Date: 2026-03-21

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "l3b4c5d6e7f8"
down_revision: Union[str, None] = "k2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("songs", sa.Column("external_strums_key", sa.String(500), nullable=True))
    op.add_column("songs", sa.Column("external_strums_failed", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("songs", sa.Column("external_strums_attempted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("songs", "external_strums_attempted_at")
    op.drop_column("songs", "external_strums_failed")
    op.drop_column("songs", "external_strums_key")
