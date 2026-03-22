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

import json
import math
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.workspace import KnowledgeItem
from app.routers.deps import get_current_user

router = APIRouter(prefix="/rag", tags=["rag"])

# ── Embedding helpers ─────────────────────────────────────────────────────────

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """순수 Python 코사인 유사도 (numpy 불필요)"""
    dot     = sum(x * y for x, y in zip(a, b))
    norm_a  = math.sqrt(sum(x * x for x in a))
    norm_b  = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


async def _embed_query(query: str) -> list[float] | None:
    """쿼리 임베딩 생성. OpenAI → Ollama 순으로 시도."""
    # 1. OpenAI (text-embedding-3-small, 1536-dim)
    if settings.OPENAI_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                    json={"model": "text-embedding-3-small", "input": query},
                )
                if r.status_code == 200:
                    return r.json()["data"][0]["embedding"]
        except Exception:
            pass

    # 2. Ollama (nomic-embed-text, 768-dim)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{settings.OLLAMA_URL}/api/embeddings",
                json={"model": "nomic-embed-text", "prompt": query},
            )
            if r.status_code == 200:
                emb = r.json().get("embedding")
                if emb:
                    return emb
    except Exception:
        pass

    return None


# ── Keyword fallback ──────────────────────────────────────────────────────────

def _keyword_search(query: str, items: list[Any], top_k: int) -> list[dict]:
    """임베딩 없이 키워드 빈도 기반 fallback."""
    keywords = query.lower().split()
    scored: list[dict] = []

    for item in items:
        # 임베딩 JSON에서 청크 가져오기 or content를 500자 단위로 분할
        chunks: list[str] = []
        try:
            emb_data = json.loads(item.embeddings_json or "{}")
            chunks = emb_data.get("chunks", [])
        except Exception:
            pass

        if not chunks and item.content:
            chunks = [item.content[i : i + 500] for i in range(0, len(item.content), 400)]

        for chunk in chunks:
            score = sum(1 for kw in keywords if kw in chunk.lower())
            if score > 0:
                scored.append({"chunk": chunk, "source": item.name, "score": float(score)})

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/search")
async def rag_search(
    q: str = Query(..., min_length=1, description="검색 쿼리"),
    top_k: int = Query(5, ge=1, le=20, description="반환할 최대 청크 수"),
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
    # 유저의 임베딩 완료 항목 로드
    result = await db.execute(
        select(KnowledgeItem)
        .where(KnowledgeItem.user_id == current_user.id)
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
    query_vector = await _embed_query(q)

    if query_vector is None:
        # 임베딩 생성 실패 → 키워드 fallback
        results = _keyword_search(q, items_with_embeddings, top_k)
        return {"results": results, "query": q, "method": "keyword_fallback"}

    # 코사인 유사도 계산
    scored: list[dict] = []
    for item in items_with_embeddings:
        try:
            emb_data = json.loads(item.embeddings_json)  # type: ignore[arg-type]
            chunks: list[str]        = emb_data.get("chunks", [])
            vectors: list[list[float]] = emb_data.get("vectors", [])
        except (json.JSONDecodeError, TypeError):
            continue

        # 임베딩 차원 불일치 방어 (OpenAI 1536 vs Ollama 768)
        if vectors and len(vectors[0]) != len(query_vector):
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
