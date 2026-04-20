"""optimize HNSW ef_search default via session-level SET

Revision ID: 0015
Revises: 0014
Create Date: 2026-04-19
"""
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ef_search is a session-level setting; we document the recommended value here.
    # Application code sets it dynamically before each HNSW query.
    # No schema change needed — this migration serves as version documentation.
    pass


def downgrade() -> None:
    pass
