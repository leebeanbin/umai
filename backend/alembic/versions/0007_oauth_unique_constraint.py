"""Add partial unique constraint on (oauth_provider, oauth_sub).

DB-level constraint prevents duplicate OAuth identities even under concurrent load.
Uses a partial index so NULL rows (non-OAuth users) are excluded.

Revision ID: 0007
Revises: 0006
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Partial unique constraint: only enforced when both columns are NOT NULL.
    # This allows multiple users with (NULL, NULL) while preventing duplicate
    # OAuth identities (provider="google", sub="12345") across accounts.
    op.create_index(
        "uq_users_oauth_provider_sub",
        "users",
        ["oauth_provider", "oauth_sub"],
        unique=True,
        postgresql_where=sa.text("oauth_provider IS NOT NULL AND oauth_sub IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_users_oauth_provider_sub", "users")
