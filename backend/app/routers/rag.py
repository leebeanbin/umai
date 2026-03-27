"""
RAG (Retrieval-Augmented Generation) 검색 API

GET /rag/search?q=query&top_k=5
  - 현재 유저의 Knowledge Base에서 관련 청크를 검색
  - 임베딩 벡터 있으면 코사인 유사도 검색
  - 없으면 키워드 매칭 fallback

임베딩 생성:
  - OPENAI_API_KEY 있으면 text-embedding-3-small
  - 없으면 Ollama nomic-embed-text
"""

import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    RAG_DEFAULT_TOP_K, RAG_MAX_TOP_K, RAG_MAX_QUERY_LENGTH,
    RAG_MAX_KNOWLEDGE_ITEMS, RAG_CONTENT_CHUNK_STRIDE, RAG_CONTENT_CHUNK_SIZE,
    RATE_RAG_SEARCH,
)
from app.core.database import get_db
from app.models.user import User
from app.models.workspace import KnowledgeItem
from app.routers.deps import get_current_user
from app.services.embedding_service import embed_query_async

router = APIRouter(prefix="/rag", tags=["rag"])
limiter = Limiter(key_func=get_remote_address)

# ── Embedding helpers ─────────────────────────────────────────────────────────

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """순수 Python 코사인 유사도 (numpy 불필요)"""
    dot     = sum(x * y for x, y in zip(a, b))
    norm_a  = math.sqrt(sum(x * x for x in a))
    norm_b  = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


# ── Keyword fallback ──────────────────────────────────────────────────────────

def _keyword_search(query: str, items: list[Any], top_k: int) -> list[dict]:
    """임베딩 없이 키워드 빈도 기반 fallback."""
    keywords = query.lower().split()
    scored: list[dict] = []

    for item in items:
        # 임베딩 JSON에서 청크 가져오기 or content를 500자 단위로 분할
        chunks: list[str] = []
        emb_data: dict = item.embeddings_json or {}
        chunks = emb_data.get("chunks", [])

        if not chunks and item.content:
            chunks = [item.content[i : i + RAG_CONTENT_CHUNK_SIZE] for i in range(0, len(item.content), RAG_CONTENT_CHUNK_STRIDE)]

        for chunk in chunks:
            score = sum(1 for kw in keywords if kw in chunk.lower())
            if score > 0:
                scored.append({"chunk": chunk, "source": item.name, "score": float(score)})

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/search")
@limiter.limit(RATE_RAG_SEARCH)
async def rag_search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=RAG_MAX_QUERY_LENGTH, description="검색 쿼리"),
    top_k: int = Query(RAG_DEFAULT_TOP_K, ge=1, le=RAG_MAX_TOP_K, description="반환할 최대 청크 수"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Knowledge Base 의미 검색.

    1. 유저의 임베딩된 knowledge_items 로드
    2. 쿼리 임베딩 생성 (OpenAI 우선, Ollama fallback)
    3. 코사인 유사도로 top_k 청크 반환
    4. 임베딩 불가 시 키워드 매칭 fallback
    """
    # 유저의 임베딩 완료 항목 로드 (OOM 방지: 500건 상한)
    result = await db.execute(
        select(KnowledgeItem)
        .where(KnowledgeItem.user_id == current_user.id)
        .limit(RAG_MAX_KNOWLEDGE_ITEMS)
    )
    items = result.scalars().all()

    if not items:
        return {
            "results": [],
            "note": "Knowledge Base가 비어있습니다. Workspace → Knowledge에서 문서를 업로드하세요.",
        }

    # 임베딩 있는 항목과 없는 항목 분리
    items_with_embeddings = [i for i in items if i.embeddings_json]

    if not items_with_embeddings:
        # 임베딩 없음 → 키워드 fallback (content 컬럼 사용)
        items_for_kw = [i for i in items if i.content]
        results = _keyword_search(q, items_for_kw, top_k)
        return {
            "results": results,
            "query": q,
            "method": "keyword_fallback",
            "note": "임베딩이 없어 키워드 매칭을 사용했습니다. 지식 항목을 재처리하면 의미 검색이 활성화됩니다.",
        }

    # 쿼리 임베딩 생성
    query_vector = await embed_query_async(q)

    if query_vector is None:
        # 임베딩 생성 실패 → 키워드 fallback
        results = _keyword_search(q, items_with_embeddings, top_k)
        return {"results": results, "query": q, "method": "keyword_fallback"}

    # 코사인 유사도 계산
    scored: list[dict] = []
    for item in items_with_embeddings:
        emb_data: dict = item.embeddings_json or {}
        if not emb_data:
            continue
        chunks: list[str]          = emb_data.get("chunks", [])
        vectors: list[list[float]] = emb_data.get("vectors", [])

        # C8: 임베딩 차원 불일치 — 무음 스킵 대신 경고 로깅
        if vectors and len(vectors[0]) != len(query_vector):
            import logging as _log
            _log.getLogger(__name__).warning(
                "RAG: skipping item '%s' — vector dim mismatch (%d vs query %d). "
                "Re-embed with current provider to fix.",
                item.name, len(vectors[0]), len(query_vector),
            )
            continue

        for chunk, vec in zip(chunks, vectors):
            score = _cosine_similarity(query_vector, vec)
            scored.append({"chunk": chunk, "source": item.name, "score": round(score, 4)})

    scored.sort(key=lambda x: x["score"], reverse=True)

    return {
        "results": scored[:top_k],
        "query": q,
        "method": "cosine_similarity",
        "total_searched": len(scored),
    }
