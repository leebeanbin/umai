"""Add FK constraints for workspace/knowledge items, compound index on messages.

C1: chat_members — ensure table + enum exist (0004 relied on create_all)
M4: workspace_items.user_id  → users.id FK (was missing)
M4: knowledge_items.user_id  → users.id FK (was missing)
M5: (chat_id, created_at) compound index on messages (pagination/history queries)

Revision ID: 0011
Revises: 0010
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── C1: chat_members 테이블 — 0004가 INSERT만 했으므로 DDL을 보장 ────────────
    # create_all() 의존 없이 명시적 DDL. IF NOT EXISTS로 이미 존재해도 무해함.
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'chat_member_role_enum'
            ) THEN
                CREATE TYPE chat_member_role_enum AS ENUM ('owner', 'editor', 'viewer');
            END IF;
        END
        $$
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS chat_members (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            chat_id     UUID NOT NULL
                            REFERENCES chats(id) ON DELETE CASCADE,
            user_id     UUID NOT NULL
                            REFERENCES users(id) ON DELETE CASCADE,
            role        chat_member_role_enum NOT NULL DEFAULT 'editor',
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            CONSTRAINT uq_chat_members_chat_user UNIQUE (chat_id, user_id)
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_chat_members_user
            ON chat_members (user_id)
    """)

    # ── M4: workspace_items.user_id → users.id FK ────────────────────────────
    # 고아 레코드(users에 없는 user_id)가 있으면 FK 추가가 실패한다.
    # 먼저 고아 행을 삭제한 후 제약을 추가한다.
    op.execute("""
        DELETE FROM workspace_items
        WHERE user_id NOT IN (SELECT id FROM users)
    """)

    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_workspace_items_user_id'
            ) THEN
                ALTER TABLE workspace_items
                    ADD CONSTRAINT fk_workspace_items_user_id
                    FOREIGN KEY (user_id)
                    REFERENCES users(id)
                    ON DELETE CASCADE;
            END IF;
        END
        $$
    """)

    # ── M4: knowledge_items.user_id → users.id FK ────────────────────────────
    op.execute("""
        DELETE FROM knowledge_items
        WHERE user_id NOT IN (SELECT id FROM users)
    """)

    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_knowledge_items_user_id'
            ) THEN
                ALTER TABLE knowledge_items
                    ADD CONSTRAINT fk_knowledge_items_user_id
                    FOREIGN KEY (user_id)
                    REFERENCES users(id)
                    ON DELETE CASCADE;
            END IF;
        END
        $$
    """)

    # ── M5: messages(chat_id, created_at) 복합 인덱스 ─────────────────────────
    # 채팅 히스토리 페이지네이션 쿼리 최적화
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_messages_chat_id_created_at
            ON messages (chat_id, created_at)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_messages_chat_id_created_at")

    op.execute("""
        ALTER TABLE knowledge_items
            DROP CONSTRAINT IF EXISTS fk_knowledge_items_user_id
    """)

    op.execute("""
        ALTER TABLE workspace_items
            DROP CONSTRAINT IF EXISTS fk_workspace_items_user_id
    """)

    op.execute("DROP INDEX IF EXISTS ix_chat_members_user")
    # chat_members 테이블 자체는 downgrade에서 삭제하지 않는다
    # (0004 downgrade에서 이미 처리하므로 중복 삭제 방지)
