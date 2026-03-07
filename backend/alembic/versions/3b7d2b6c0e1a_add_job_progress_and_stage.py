"""add job progress and stage

Revision ID: 3b7d2b6c0e1a
Revises: 15c28a46dde0
Create Date: 2026-02-21

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3b7d2b6c0e1a"
down_revision: Union[str, None] = "15c28a46dde0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add progress with a server_default so existing rows are populated.
    op.add_column(
        "jobs",
        sa.Column(
            "progress", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
    )
    op.add_column(
        "jobs",
        sa.Column("stage", sa.String(length=50), nullable=True),
    )

    # Drop server default to keep the default in the ORM layer only.
    op.alter_column("jobs", "progress", server_default=None)


def downgrade() -> None:
    op.drop_column("jobs", "stage")
    op.drop_column("jobs", "progress")
