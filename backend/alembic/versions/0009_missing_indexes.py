"""Add missing performance indexes.

- chats.folder_id  : 폴더별 채팅 목록 조회
- messages.rating  : admin ratings 조회 (partial index, NOT NULL only)

Revision ID: 0009
Revises: 0008
Create Date: 2026-03-20
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_chats_folder_id", "chats", ["folder_id"],
                    postgresql_where="folder_id IS NOT NULL")
    # messages.rating partial index (0008 마이그레이션에서 일반 인덱스 생성됨 → 교체)
    op.drop_index("ix_messages_rating", "messages")
    op.create_index("ix_messages_rating", "messages", ["rating"],
                    postgresql_where="rating IS NOT NULL")


def downgrade() -> None:
    op.drop_index("ix_chats_folder_id", "chats")
    op.drop_index("ix_messages_rating", "messages")
    op.create_index("ix_messages_rating", "messages", ["rating"])
