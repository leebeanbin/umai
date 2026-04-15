"""
임베딩 유틸리티 — 동기(Celery) / 비동기(FastAPI) 공통

embed_texts_sync  : 텍스트 배치 → 벡터 목록 (knowledge 태스크용)
embed_query_sync  : 단일 쿼리 → 벡터 (ai 태스크 _knowledge_search용)
embed_query_async : 단일 쿼리 → 벡터 (rag.py FastAPI 엔드포인트용)
"""
from __future__ import annotations

import logging
from typing import Literal

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Model defaults — override via OPENAI_EMBED_MODEL / OLLAMA_EMBED_MODEL env vars
# mxbai-embed-large: outperforms OpenAI text-embedding-3-large on MTEB (no API key needed)
# nomic-embed-text: lighter 768-dim alternative
# bge-m3: best for multilingual / hybrid search


# ── 동기 배치 임베딩 ──────────────────────────────────────────────────────────

def embed_texts_sync(
    texts: list[str],
    provider: Literal["openai", "ollama"] = "ollama",
    model: str = "",
) -> list[list[float]]:
    """텍스트 목록을 임베딩 벡터 목록으로 변환 (Celery 워커에서 사용)."""
    if provider == "openai":
        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not configured")
        m = model or settings.OPENAI_EMBED_MODEL
        with httpx.Client(timeout=60) as client:
            r = client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                json={"model": m, "input": texts},
            )
            r.raise_for_status()
        return [d["embedding"] for d in r.json()["data"]]

    # ollama — /api/embeddings는 단일 텍스트만 지원하므로 ThreadPoolExecutor로 병렬 처리.
    # 순차 처리 대비 ~8배 빠름 (100청크 기준 10s → ~1.5s)
    m = model or settings.OLLAMA_EMBED_MODEL
    from concurrent.futures import ThreadPoolExecutor

    def _single(text: str) -> list[float]:
        with httpx.Client(timeout=60) as c:
            r = c.post(
                f"{settings.OLLAMA_URL}/api/embeddings",
                json={"model": m, "prompt": text},
            )
            r.raise_for_status()
            return r.json()["embedding"]

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(_single, t) for t in texts]
        return [f.result() for f in futures]


# ── 동기 단일 쿼리 임베딩 ─────────────────────────────────────────────────────

def embed_query_sync(query: str) -> list[float] | None:
    """단일 쿼리 임베딩. OpenAI → Ollama 순으로 시도 (Celery 워커용)."""
    if settings.OPENAI_API_KEY:
        try:
            with httpx.Client(timeout=20) as client:
                r = client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                    json={"model": settings.OPENAI_EMBED_MODEL, "input": query},
                )
                if r.status_code == 200:
                    return r.json()["data"][0]["embedding"]
        except Exception:
            pass

    try:
        with httpx.Client(timeout=20) as client:
            r = client.post(
                f"{settings.OLLAMA_URL}/api/embeddings",
                json={"model": settings.OLLAMA_EMBED_MODEL, "prompt": query},
            )
            if r.status_code == 200:
                emb = r.json().get("embedding")
                if emb:
                    return emb
    except Exception:
        pass

    return None


# ── 비동기 단일 쿼리 임베딩 ──────────────────────────────────────────────────

async def embed_query_async(query: str) -> list[float] | None:
    """단일 쿼리 임베딩. OpenAI → Ollama 순으로 시도 (FastAPI 핸들러용)."""
    if settings.OPENAI_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                    json={"model": settings.OPENAI_EMBED_MODEL, "input": query},
                )
                if r.status_code == 200:
                    return r.json()["data"][0]["embedding"]
        except Exception:
            pass

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{settings.OLLAMA_URL}/api/embeddings",
                json={"model": settings.OLLAMA_EMBED_MODEL, "prompt": query},
            )
            if r.status_code == 200:
                emb = r.json().get("embedding")
                if emb:
                    return emb
    except Exception:
        pass

    return None
