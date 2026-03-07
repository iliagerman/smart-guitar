"""add cascade delete to jobs song_id FK

Revision ID: 5b9f4a2e7d3c
Revises: 4a8e3f1d9c2b
Create Date: 2026-02-21

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "5b9f4a2e7d3c"
down_revision: Union[str, None] = "4a8e3f1d9c2b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("jobs_song_id_fkey", "jobs", type_="foreignkey")
    op.create_foreign_key(
        "jobs_song_id_fkey", "jobs", "songs", ["song_id"], ["id"], ondelete="CASCADE"
    )


def downgrade() -> None:
    op.drop_constraint("jobs_song_id_fkey", "jobs", type_="foreignkey")
    op.create_foreign_key(
        "jobs_song_id_fkey", "jobs", "songs", ["song_id"], ["id"]
    )
