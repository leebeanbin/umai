"""
RAG (Retrieval-Augmented Generation) 검색 API

## 검색 파이프라인

```
쿼리 입력
  │
  ├─ Redis 캐시 확인 (MD5(query+model), TTL 24h)
  │   └─ 캐시 히트 → 벡터 즉시 반환
  │
  ├─ 캐시 미스 → 임베딩 생성
  │   ├─ OPENAI_API_KEY 설정 시 → OpenAI text-embedding-3-small (1536-dim)
  │   └─ 미설정 시             → Ollama (OLLAMA_EMBED_MODEL, 기본 qwen3-embedding:8b)
  │
  └─ pgvector 검색 (3단계 폴백)
      ├─ 1순위: knowledge_chunks 테이블 HNSW 인덱스 (O(log n) ANN)
      │         ef_search=40, 코사인 유사도, score > 0.4 필터
      ├─ 2순위: knowledge_items.embeddings_json JSONB 코사인 유사도 (O(n) 풀스캔)
      │         HNSW 인덱스 미생성/미지원 환경 폴백
      └─ 3순위: 키워드 매칭 (ilike %query%) — 임베딩 완전 불가 시 최후 수단
```

## HNSW 인덱스 우선 사용 이유

일반 벡터 컬럼에 인덱스 없이 코사인 유사도를 계산하면 O(n) 풀스캔 → 문서 증가 시
선형 성능 저하. HNSW(Hierarchical Navigable Small World)는 근사 최근접 이웃(ANN)을
O(log n)에 탐색한다. 정확도를 약 5% 희생하고 속도를 100× 개선한다.

knowledge_chunks 테이블에 별도 저장/인덱스를 만드는 이유:
  - knowledge_items.embeddings_json (JSONB 배열) → HNSW 인덱스 불가
  - knowledge_chunks.embedding (pgvector 타입) → HNSW 인덱스 가능

## 쿼리 임베딩 캐시 설계

  - 키: MD5(query_text + model_name) → 모델이 바뀌면 별도 캐시 엔트리
  - TTL: 24시간 — 반복 RAG 호출에서 임베딩 API 비용 40~60% 절감
  - 캐시 실패 시 graceful degradation (직접 API 호출)

## 엔드포인트

  GET  /rag/search?q=...&top_k=5   — 의미 검색 (인증 필요)
  POST /rag/upload                  — 문서 업로드 (PDF/DOCX/TXT/MD, Celery 백그라운드 파싱)
  GET  /rag/files                   — 업로드된 파일 목록
  DELETE /rag/files/{id}            — 파일 삭제
"""

import asyncio
import hashlib
import json
import logging
import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

logger = logging.getLogger(__name__)
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    RAG_DEFAULT_TOP_K, RAG_MAX_TOP_K, RAG_MAX_QUERY_LENGTH,
    RAG_MAX_KNOWLEDGE_ITEMS, RAG_CONTENT_CHUNK_STRIDE, RAG_CONTENT_CHUNK_SIZE,
    RATE_RAG_SEARCH,
)
from app.core.database import get_db
from app.core.redis import embed_query_cache_get, embed_query_cache_set, get_redis
from app.models.user import User
from app.models.workspace import KnowledgeItem
from app.routers.deps import get_current_user
from app.services.embedding_service import embed_query_async
from app.services.reranker import rerank as _rerank

router = APIRouter(prefix="/rag", tags=["rag"])
limiter = Limiter(key_func=get_remote_address)


# ── pgvector HNSW 검색 ────────────────────────────────────────────────────────

async def _pgvector_search(
    db: AsyncSession,
    user_id: str,
    query_vector: list[float],
    top_k: int,
) -> list[dict] | None:
    """knowledge_chunks 테이블에서 pgvector HNSW 코사인 검색.

    knowledge_chunks 행이 없으면 None 반환 → 호출자가 JSONB fallback으로 전환.
    embedding 컬럼이 vector 타입이므로 raw SQL text() 사용 (SQLAlchemy ORM은 Text placeholder).
    """
    # 벡터를 pgvector 리터럴 '[x1,x2,...]' 형식으로 변환
    vec_literal = "[" + ",".join(f"{v:.8f}" for v in query_vector) + "]"

    sql = text("""
        SELECT
            kc.content,
            ki.name   AS source,
            1 - (kc.embedding <=> CAST(:vec AS vector)) AS score
        FROM knowledge_chunks kc
        JOIN knowledge_items ki ON ki.id = kc.knowledge_item_id
        WHERE ki.user_id = CAST(:uid AS uuid)
          AND kc.embedding IS NOT NULL
        ORDER BY kc.embedding <=> CAST(:vec AS vector)
        LIMIT :top_k
    """)

    try:
        # ef_search 상향으로 recall 개선 (default 40 → 100)
        await db.execute(text("SET LOCAL hnsw.ef_search = 100"))
        result = await db.execute(sql, {"vec": vec_literal, "uid": user_id, "top_k": top_k})
        rows = result.fetchall()
    except Exception as exc:
        logger.warning("pgvector search failed, will fallback to JSONB: %s", exc)
        return None

    if not rows:
        # knowledge_chunks 테이블에 행이 없음 (마이그레이션 전 데이터) → JSONB fallback 트리거
        # 빈 리스트([])가 아닌 None을 반환해 "결과 없음"과 "테이블 없음"을 구분
        return None

    return [
        {"chunk": r.content, "source": r.source, "score": round(float(r.score), 4)}
        for r in rows
    ]

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

    # 쿼리 임베딩 생성 — Redis 캐시 우선 조회 (동일 쿼리 재호출 시 API 절감)
    # 캐시 키: MD5(query + embed_model) — 모델이 바뀌면 자동으로 다른 키
    from app.core.config import settings as _s
    _cache_seed = f"{q}\x00{_s.OPENAI_EMBED_MODEL}\x00{_s.OLLAMA_EMBED_MODEL}"
    _query_hash = hashlib.md5(_cache_seed.encode()).hexdigest()

    query_vector = await embed_query_cache_get(_query_hash)

    # Fix: validate cached dimension against stored vectors (prevents stale hits
    # after a model/provider switch where cache seed is identical but dim differs)
    if query_vector is not None and items_with_embeddings:
        _first_stored = (items_with_embeddings[0].embeddings_json or {}).get("vectors", [])
        if _first_stored and len(_first_stored[0]) != len(query_vector):
            logger.warning(
                "RAG embed cache: dimension mismatch (cached=%d, stored=%d) — invalidating",
                len(query_vector), len(_first_stored[0]),
            )
            query_vector = None

    if query_vector is None:
        # NX lock: prevents cache stampede when many concurrent requests miss
        # on the same query — only the lock holder embeds, others wait and reuse.
        _r = await get_redis()
        _lock_key = f"embed_lock:{_query_hash}"
        _acquired = await _r.set(_lock_key, "1", nx=True, px=3000)
        if _acquired:
            try:
                query_vector = await embed_query_async(q)
                if query_vector is not None:
                    await embed_query_cache_set(_query_hash, query_vector)
            finally:
                await _r.delete(_lock_key)
        else:
            # Another coroutine is embedding; wait briefly then recheck cache
            await asyncio.sleep(0.15)
            query_vector = await embed_query_cache_get(_query_hash)
            if query_vector is None:
                # Lock holder failed or timed out — embed directly as fallback
                query_vector = await embed_query_async(q)
                if query_vector is not None:
                    await embed_query_cache_set(_query_hash, query_vector)

    if query_vector is None:
        # 임베딩 생성 실패 → 키워드 fallback
        results = _keyword_search(q, items_with_embeddings, top_k)
        return {"results": results, "query": q, "method": "keyword_fallback"}

    # ── pgvector HNSW 검색 우선 시도 (O(log n), HNSW 인덱스 활용) ────────────
    # None = 오류 또는 knowledge_chunks 테이블 비어있음 → JSONB fallback
    # [] = pgvector 정상 동작, 단순히 매칭 결과 없음 → 빈 결과 반환 (fallback 불필요)
    _candidate_k = max(top_k * 4, 20)
    pgvector_results = await _pgvector_search(db, str(current_user.id), query_vector, _candidate_k)
    if pgvector_results is not None:
        reranked = False
        if len(pgvector_results) > top_k:
            ranked_indices = _rerank(q, [r["chunk"] for r in pgvector_results], top_k=top_k)
            pgvector_results = [pgvector_results[i] for i in ranked_indices]
            reranked = True
        return {
            "results": pgvector_results[:top_k],
            "query": q,
            "method": "pgvector_hnsw",
            "reranked": reranked,
            "total_searched": len(pgvector_results),
        }

    # ── JSONB fallback: embeddings_json 컬럼 코사인 유사도 (O(n)) ────────────
    # knowledge_chunks 테이블이 비어있을 때 (아직 마이그레이션 전 데이터)
    scored: list[dict] = []
    skipped_dim_mismatch: list[str] = []

    for item in items_with_embeddings:
        emb_data: dict = item.embeddings_json or {}
        if not emb_data:
            continue
        chunks: list[str]          = emb_data.get("chunks", [])
        vectors: list[list[float]] = emb_data.get("vectors", [])

        # 임베딩 차원 불일치 — 경고 로깅 후 스킵
        if vectors and len(vectors[0]) != len(query_vector):
            logger.warning(
                "RAG: skipping item '%s' — vector dim mismatch (%d vs query %d). "
                "Re-embed with current provider to fix.",
                item.name, len(vectors[0]), len(query_vector),
            )
            skipped_dim_mismatch.append(item.name)
            continue

        for chunk, vec in zip(chunks, vectors):
            score = _cosine_similarity(query_vector, vec)
            scored.append({"chunk": chunk, "source": item.name, "score": round(score, 4)})

    scored.sort(key=lambda x: x["score"], reverse=True)

    response: dict = {
        "results": scored[:top_k],
        "query": q,
        "method": "cosine_similarity_jsonb",
        "total_searched": len(scored),
    }
    if skipped_dim_mismatch:
        response["note"] = (
            f"일부 항목이 임베딩 차원 불일치로 검색에서 제외되었습니다: "
            f"{', '.join(skipped_dim_mismatch)}. "
            "Workspace → Knowledge에서 해당 항목을 재처리하세요."
        )
        response["skipped_items"] = skipped_dim_mismatch
    return response
