"""add provider and generic external ID columns to subscriptions

Revision ID: g8a9b0c1d2e3
Revises: f7a8b9c0d1e2
Create Date: 2026-03-03

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "g8a9b0c1d2e3"
down_revision: Union[str, None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add new columns
    op.add_column(
        "subscriptions",
        sa.Column(
            "provider", sa.String(20), nullable=False, server_default="paddle"
        ),
    )
    op.add_column(
        "subscriptions",
        sa.Column("external_subscription_id", sa.String(255), nullable=True),
    )
    op.add_column(
        "subscriptions",
        sa.Column("external_customer_id", sa.String(255), nullable=True),
    )

    # 2. Copy data from paddle-specific columns
    op.execute(
        "UPDATE subscriptions "
        "SET external_subscription_id = paddle_subscription_id, "
        "    external_customer_id = paddle_customer_id"
    )

    # 3. Make NOT NULL after backfill
    op.alter_column(
        "subscriptions", "external_subscription_id", nullable=False
    )
    op.alter_column(
        "subscriptions", "external_customer_id", nullable=False
    )

    # 4. Drop old unique constraint and columns
    op.drop_constraint(
        "uq_subscriptions_paddle_id", "subscriptions", type_="unique"
    )
    op.drop_column("subscriptions", "paddle_subscription_id")
    op.drop_column("subscriptions", "paddle_customer_id")

    # 5. Add composite unique constraint
    op.create_unique_constraint(
        "uq_subscriptions_provider_ext_id",
        "subscriptions",
        ["provider", "external_subscription_id"],
    )

    # 6. Add index on provider
    op.create_index(
        "ix_subscriptions_provider", "subscriptions", ["provider"]
    )


def downgrade() -> None:
    # Reverse: recreate paddle-specific columns from generic ones
    op.drop_index("ix_subscriptions_provider", table_name="subscriptions")
    op.drop_constraint(
        "uq_subscriptions_provider_ext_id", "subscriptions", type_="unique"
    )

    op.add_column(
        "subscriptions",
        sa.Column("paddle_subscription_id", sa.String(255), nullable=True),
    )
    op.add_column(
        "subscriptions",
        sa.Column("paddle_customer_id", sa.String(255), nullable=True),
    )

    op.execute(
        "UPDATE subscriptions "
        "SET paddle_subscription_id = external_subscription_id, "
        "    paddle_customer_id = external_customer_id"
    )

    op.alter_column(
        "subscriptions", "paddle_subscription_id", nullable=False
    )
    op.alter_column(
        "subscriptions", "paddle_customer_id", nullable=False
    )

    op.create_unique_constraint(
        "uq_subscriptions_paddle_id",
        "subscriptions",
        ["paddle_subscription_id"],
    )

    op.drop_column("subscriptions", "external_customer_id")
    op.drop_column("subscriptions", "external_subscription_id")
    op.drop_column("subscriptions", "provider")
