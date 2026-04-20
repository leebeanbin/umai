"""Add composite index on messages(chat_id, created_at)

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-20

Rationale: paginated message queries use WHERE chat_id=X ORDER BY created_at.
Without a composite index Postgres does an index scan on chat_id then re-sorts;
the composite index lets the planner satisfy both predicates in one pass.
"""
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_messages_chat_created",
        "messages",
        ["chat_id", "created_at"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_messages_chat_created", table_name="messages")
