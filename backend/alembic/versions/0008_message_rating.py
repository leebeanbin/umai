"""Add rating column to messages table.

Revision ID: 0008
Revises: 0007
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("rating", sa.String(20), nullable=True),
    )
    op.create_index("ix_messages_rating", "messages", ["rating"])


def downgrade() -> None:
    op.drop_index("ix_messages_rating", "messages")
    op.drop_column("messages", "rating")
