"""add chat_members table

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # create_all()이 이미 테이블과 enum을 만들었을 수 있으므로
    # 테이블 생성은 건너뛰고 기존 채팅 오너 데이터만 채워 넣는다.
    op.execute("""
        INSERT INTO chat_members (id, chat_id, user_id, role, created_at)
        SELECT gen_random_uuid(), id, user_id, 'owner', created_at
        FROM chats
        WHERE id NOT IN (SELECT chat_id FROM chat_members)
    """)


def downgrade() -> None:
    op.drop_table("chat_members")
    op.execute("DROP TYPE IF EXISTS chat_member_role_enum")
