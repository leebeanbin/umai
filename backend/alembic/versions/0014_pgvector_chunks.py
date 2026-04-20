"""Add pgvector extension + knowledge_chunks table for scalable RAG.

현재 KnowledgeItem.embeddings_json (JSONB) 방식의 한계:
  - 벡터 인덱스 불가 → O(n) 전량 스캔
  - 청크 단위 필터링/재임베딩 불가
  - VACUUM/TOAST 부담

목표 구조:
  knowledge_chunks: chunk_index, content, token_count, section_path, page_no,
                    tsv (FTS), embedding vector(dim) with HNSW index

마이그레이션 전략:
  1. pgvector extension 설치
  2. knowledge_chunks 테이블 생성 (KnowledgeItem 1:N)
  3. FTS 인덱스 (GIN on tsv)
  4. HNSW 벡터 인덱스 (CONCURRENTLY — 운영 환경 다운타임 없음)

기존 KnowledgeItem.embeddings_json 컬럼은 유지.
백필(기존 데이터 → knowledge_chunks)은 별도 Celery 태스크로 수행.

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

# 임베딩 벡터 차원 — Ollama qwen3-embedding:8b=4096, OpenAI text-embedding-3-small=1536
# 두 모델을 모두 지원하기 위해 컬럼은 nullable로 생성하고 dim은 앱 레이어에서 관리
# pgvector는 컬럼 정의 시 차원을 고정해야 하므로 가장 넓은 dim을 사용하거나
# 모델별 별도 컬럼 전략을 택한다. 여기서는 2048을 기본으로 사용하고
# 마이그레이션 이후 앱 설정으로 조정 가능하도록 주석 처리한다.
_VECTOR_DIM = 4096   # Ollama qwen3-embedding:8b=4096 (OpenAI=1536, 최대값으로 통일)


def upgrade() -> None:
    # ── 1. pgvector extension ────────────────────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── 2. knowledge_chunks 테이블 ───────────────────────────────────────────
    op.create_table(
        "knowledge_chunks",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "knowledge_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("knowledge_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # 청크 순서 (0-based)
        sa.Column("chunk_index", sa.Integer, nullable=False),
        # 청크 원문
        sa.Column("content", sa.Text, nullable=False),
        # 토큰 수 (tiktoken 기준)
        sa.Column("token_count", sa.Integer, nullable=True),
        # 문서 내 위치 메타데이터
        sa.Column("section_path", sa.String(1000), nullable=True),  # "1.2.3 서론 > 배경"
        sa.Column("page_no", sa.Integer, nullable=True),
        # 전처리 메타 (chunk strategy 버전, parser 버전 등)
        sa.Column("meta", postgresql.JSONB, nullable=True),
        # Full-Text Search 컬럼 (한국어는 pg_trgm or pgroonga 고려)
        sa.Column(
            "tsv",
            postgresql.TSVECTOR,
            nullable=True,
            comment="tsvector for FTS — updated by trigger or app layer",
        ),
        # 임베딩 벡터 (pgvector)
        sa.Column(
            "embedding",
            sa.Text,  # placeholder — pgvector type은 raw SQL로 ALTER
            nullable=True,
        ),
        # 임베딩 메타
        sa.Column("embedding_model", sa.String(100), nullable=True),
        sa.Column("embedding_dim", sa.Integer, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # embedding 컬럼을 vector 타입으로 변경 (pgvector 설치 후)
    op.execute(
        f"ALTER TABLE knowledge_chunks "
        f"ALTER COLUMN embedding TYPE vector({_VECTOR_DIM}) "
        f"USING NULL"
    )

    # ── 3. 인덱스 ────────────────────────────────────────────────────────────

    # knowledge_item_id + chunk_index 복합 인덱스 (문서별 청크 순서 조회)
    op.create_index(
        "ix_knowledge_chunks_item_idx",
        "knowledge_chunks",
        ["knowledge_item_id", "chunk_index"],
        unique=True,
    )

    # FTS GIN 인덱스
    op.execute(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_knowledge_chunks_tsv "
        "ON knowledge_chunks USING gin(tsv)"
    )

    # HNSW 벡터 인덱스 (코사인 유사도 기준)
    # ef_construction=128, m=16 은 recall/속도 균형에 좋은 기본값
    op.execute(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_knowledge_chunks_embedding_hnsw "
        f"ON knowledge_chunks USING hnsw (embedding vector_cosine_ops) "
        f"WITH (m = 16, ef_construction = 128)"
    )

    # tsv 자동 갱신 트리거 (content 변경 시)
    op.execute("""
        CREATE OR REPLACE FUNCTION knowledge_chunks_tsv_update() RETURNS trigger AS $$
        BEGIN
            NEW.tsv := to_tsvector('simple', coalesce(NEW.content, ''));
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER knowledge_chunks_tsv_trigger
        BEFORE INSERT OR UPDATE OF content ON knowledge_chunks
        FOR EACH ROW EXECUTE FUNCTION knowledge_chunks_tsv_update();
    """)


def downgrade() -> None:
    # knowledge_chunks 테이블에는 실제 청크 데이터가 저장된다.
    # 롤백하면 모든 임베딩·청크가 영구 소실되므로 자동 다운그레이드를 금지한다.
    raise RuntimeError(
        "Migration 0014 is not reversible — "
        "dropping knowledge_chunks would permanently destroy embedded data. "
        "Restore from a database backup instead."
    )
