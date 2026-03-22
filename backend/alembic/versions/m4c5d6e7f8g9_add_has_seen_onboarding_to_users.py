"""add has_seen_onboarding to users

Revision ID: m4c5d6e7f8g9
Revises: l3b4c5d6e7f8
Create Date: 2026-03-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "m4c5d6e7f8g9"
down_revision: Union[str, None] = "l3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("has_seen_onboarding", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "has_seen_onboarding")
