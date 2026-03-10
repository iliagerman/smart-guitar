"""add lyrics_corrected and lyrics_corrected_key to songs

Revision ID: i0c1d2e3f4g5
Revises: h9b0c1d2e3f4
Create Date: 2026-03-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "i0c1d2e3f4g5"
down_revision: Union[str, None] = "h9b0c1d2e3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("songs", sa.Column("lyrics_corrected", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("songs", sa.Column("lyrics_corrected_key", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("songs", "lyrics_corrected_key")
    op.drop_column("songs", "lyrics_corrected")
