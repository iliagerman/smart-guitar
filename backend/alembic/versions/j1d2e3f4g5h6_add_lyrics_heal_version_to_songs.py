"""add lyrics_heal_version to songs

Revision ID: j1d2e3f4g5h6
Revises: i0c1d2e3f4g5
Create Date: 2026-03-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "j1d2e3f4g5h6"
down_revision: Union[str, None] = "i0c1d2e3f4g5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("songs", sa.Column("lyrics_heal_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("songs", "lyrics_heal_version")
