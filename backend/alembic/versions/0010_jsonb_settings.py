"""Migrate system_settings.data and knowledge_items.embeddings_json to JSONB.

system_settings.data     : Text (JSON string) → JSONB
knowledge_items.embeddings_json : Text (JSON string) → JSONB

JSONB 장점:
  - 파이썬 dict 직접 저장/조회 (json.dumps/loads 제거)
  - PostgreSQL GIN 인덱스 지원 (향후 jsonb_path_query 등 활용 가능)
  - 쿼리 플래너 통계 개선

Revision ID: 0010
Revises: 0009
Create Date: 2026-03-27
"""
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # C9: 캐스트 전 유효하지 않은 JSON 행 검증 — 잘못된 JSON이 있으면 명확한 오류 메시지 반환
    op.execute("""
        DO $$
        DECLARE bad_count INT;
        BEGIN
            SELECT COUNT(*) INTO bad_count
            FROM system_settings
            WHERE data IS NOT NULL
              AND (data::text = '' OR NOT (data::text ~ '^\\s*\\{'));
            IF bad_count > 0 THEN
                RAISE EXCEPTION
                    'Migration 0010 aborted: % row(s) in system_settings.data contain invalid JSON. '
                    'Fix them before running this migration.', bad_count;
            END IF;
        END $$
    """)

    op.execute("""
        DO $$
        DECLARE bad_count INT;
        BEGIN
            SELECT COUNT(*) INTO bad_count
            FROM knowledge_items
            WHERE embeddings_json IS NOT NULL
              AND (embeddings_json::text = '' OR NOT (embeddings_json::text ~ '^\\s*\\{'));
            IF bad_count > 0 THEN
                RAISE EXCEPTION
                    'Migration 0010 aborted: % row(s) in knowledge_items.embeddings_json contain invalid JSON.',
                    bad_count;
            END IF;
        END $$
    """)

    # ── system_settings.data: Text → JSONB ────────────────────────────────────
    op.execute(
        "ALTER TABLE system_settings "
        "ALTER COLUMN data TYPE JSONB USING data::jsonb"
    )

    # ── knowledge_items.embeddings_json: Text → JSONB ─────────────────────────
    op.execute(
        "ALTER TABLE knowledge_items "
        "ALTER COLUMN embeddings_json TYPE JSONB "
        "USING CASE WHEN embeddings_json IS NULL THEN NULL "
        "ELSE embeddings_json::jsonb END"
    )


def downgrade() -> None:
    # JSONB → Text (역방향: jsonb를 text 캐스트)
    op.execute(
        "ALTER TABLE system_settings "
        "ALTER COLUMN data TYPE TEXT USING data::text"
    )
    op.execute(
        "ALTER TABLE knowledge_items "
        "ALTER COLUMN embeddings_json TYPE TEXT "
        "USING CASE WHEN embeddings_json IS NULL THEN NULL "
        "ELSE embeddings_json::text END"
    )
