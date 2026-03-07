"""add stem and chord file path columns to songs

Revision ID: 004
Revises: 003
Create Date: 2026-02-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = [
    "vocals_key",
    "drums_key",
    "bass_key",
    "guitar_key",
    "piano_key",
    "other_key",
    "chords_key",
]


def upgrade() -> None:
    for col in _COLUMNS:
        op.add_column("songs", sa.Column(col, sa.String(500), nullable=True))


def downgrade() -> None:
    for col in _COLUMNS:
        op.drop_column("songs", col)
