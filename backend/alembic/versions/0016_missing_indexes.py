"""Add missing indexes for knowledge queries and cursor pagination

Revision ID: 0016
Revises: 0015
Create Date: 2026-04-19
"""
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_knowledge_chunks_created_at",
        "knowledge_chunks",
        ["created_at"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_knowledge_items_user_created",
        "knowledge_items",
        ["user_id", "created_at"],
        if_not_exists=True,
    )
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")


def downgrade() -> None:
    op.drop_index("ix_knowledge_items_user_created", table_name="knowledge_items")
    op.drop_index("ix_knowledge_chunks_created_at", table_name="knowledge_chunks")
