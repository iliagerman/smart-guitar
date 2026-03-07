"""add subscriptions table and trial_ends_at to users

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-02-23

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add trial_ends_at to users
    op.add_column(
        "users",
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Backfill: set trial_ends_at = created_at + 14 days for existing users
    op.execute(
        "UPDATE users SET trial_ends_at = created_at + INTERVAL '14 days' "
        "WHERE trial_ends_at IS NULL"
    )

    # Create subscriptions table
    op.create_table(
        "subscriptions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("paddle_subscription_id", sa.String(255), nullable=False),
        sa.Column("paddle_customer_id", sa.String(255), nullable=False),
        sa.Column(
            "status", sa.String(50), nullable=False, server_default="active"
        ),
        sa.Column("plan_type", sa.String(20), nullable=False),
        sa.Column(
            "current_period_start", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "current_period_end", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "paddle_subscription_id", name="uq_subscriptions_paddle_id"
        ),
    )
    op.create_index(
        "ix_subscriptions_user_id", "subscriptions", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_subscriptions_user_id", table_name="subscriptions")
    op.drop_table("subscriptions")
    op.drop_column("users", "trial_ends_at")
