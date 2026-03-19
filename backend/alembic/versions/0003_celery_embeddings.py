"""add embeddings_json to knowledge_items

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "knowledge_items",
        sa.Column("embeddings_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("knowledge_items", "embeddings_json")
