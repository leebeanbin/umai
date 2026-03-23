"""
Knowledge Base 처리 태스크 (knowledge queue)

- process_document   : 업로드된 파일에서 텍스트 추출 (PDF/DOCX/TXT/MD)
- chunk_document     : 텍스트를 token-aware 청크로 분할
- embed_and_store    : 청크 임베딩 생성 + PostgreSQL 저장 (pgvector)
- reindex_knowledge  : 유저의 전체 Knowledge Base 재인덱싱
- delete_embeddings  : 삭제된 파일의 임베딩 정리
"""
import io
import json
import os
from typing import Literal

import httpx
import tiktoken
from celery import shared_task
from celery.utils.log import get_task_logger

from app.core.config import settings

logger = get_task_logger(__name__)

OLLAMA_URL     = settings.OLLAMA_URL
OPENAI_API_KEY = settings.OPENAI_API_KEY


def _publish_task_done(task_id: str, task_name: str) -> None:
    """태스크 완료를 소유자 전용 Redis 채널에 발행. non-fatal."""
    try:
        import redis as _sync_redis
        r = _sync_redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
        owner = r.get(f"task_owner:{task_id}")
        if owner:
            r.publish(f"task:{owner}", json.dumps({
                "type": "task_done",
                "task_id": task_id,
                "task": task_name,
            }))
        r.close()
    except Exception as _exc:
        logger.warning("_publish_task_done failed: %s", _exc)


# ── 텍스트 추출 ────────────────────────────────────────────────────────────────

def _extract_text_pdf(raw: bytes) -> str:
    import fitz  # pymupdf
    doc = fitz.open(stream=raw, filetype="pdf")
    return "\n".join(page.get_text() for page in doc)


def _extract_text_docx(raw: bytes) -> str:
    from docx import Document
    doc = Document(io.BytesIO(raw))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _extract_text(raw: bytes, content_type: str, filename: str = "") -> str:
    if content_type == "application/pdf":
        return _extract_text_pdf(raw)
    if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_text_docx(raw)
    # txt / markdown → 그냥 decode
    return raw.decode("utf-8", errors="replace")


# ── 청킹 ──────────────────────────────────────────────────────────────────────

def _chunk_text(
    text: str,
    chunk_size: int = 1000,
    overlap: int = 100,
    model: str = "cl100k_base",
) -> list[str]:
    """tiktoken 기반 token-aware 청킹"""
    enc = tiktoken.get_encoding(model)
    tokens = enc.encode(text)

    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = start + chunk_size
        chunk_tokens = tokens[start:end]
        chunks.append(enc.decode(chunk_tokens))
        if end >= len(tokens):
            break
        start = end - overlap  # 오버랩
    return chunks


# ── 임베딩 ────────────────────────────────────────────────────────────────────

def _embed_openai(texts: list[str], model: str = "text-embedding-3-small") -> list[list[float]]:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY not configured")
    with httpx.Client(timeout=60) as client:
        r = client.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={"model": model, "input": texts},
        )
        r.raise_for_status()
    return [d["embedding"] for d in r.json()["data"]]


def _embed_ollama(texts: list[str], model: str = "nomic-embed-text") -> list[list[float]]:
    embeddings = []
    with httpx.Client(timeout=60) as client:
        for text in texts:
            r = client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": model, "prompt": text},
            )
            r.raise_for_status()
            embeddings.append(r.json()["embedding"])
    return embeddings


# ── 태스크 ────────────────────────────────────────────────────────────────────

@shared_task(bind=True, name="app.tasks.knowledge.process_document", max_retries=2)
def process_document(
    self,
    knowledge_id: str,
    file_bytes_b64: str,
    content_type: str,
    filename: str = "",
) -> dict:
    """
    업로드된 파일에서 텍스트를 추출하고 DB를 업데이트.
    file_bytes_b64: base64 인코딩된 파일 바이트

    Returns: {"knowledge_id": str, "text_length": int, "status": "ok"}
    """
    import base64
    from app.core.database import sync_session
    from app.models.workspace import KnowledgeItem

    try:
        raw = base64.b64decode(file_bytes_b64)
        text = _extract_text(raw, content_type, filename)

        # DB 업데이트 (동기 세션 — Celery는 sync 환경)
        with sync_session() as db:
            item = db.get(KnowledgeItem, knowledge_id)
            if item:
                item.content = text
                db.commit()

        logger.info("process_document OK: id=%s chars=%d", knowledge_id, len(text))
        return {"knowledge_id": knowledge_id, "text_length": len(text), "status": "ok"}
    except Exception as exc:
        logger.error("process_document failed: %s", exc)
        raise self.retry(exc=exc, countdown=10)


@shared_task(bind=True, name="app.tasks.knowledge.chunk_document", max_retries=1)
def chunk_document(
    self,
    text: str,
    chunk_size: int = 1000,
    overlap: int = 100,
) -> dict:
    """텍스트 → 청크 리스트. 임베딩 태스크에 체이닝해서 사용."""
    chunks = _chunk_text(text, chunk_size, overlap)
    return {"chunks": chunks, "count": len(chunks)}


@shared_task(bind=True, name="app.tasks.knowledge.embed_chunks", max_retries=2)
def embed_chunks(
    self,
    knowledge_id: str,
    chunks: list[str],
    embedding_provider: Literal["openai", "ollama"] = "ollama",
    embedding_model: str = "nomic-embed-text",
) -> dict:
    """
    청크 임베딩 생성.
    pgvector 준비 전까지는 JSON으로 DB에 저장.
    Returns: {"knowledge_id": str, "embedded_count": int}
    """
    try:
        if embedding_provider == "openai":
            vectors = _embed_openai(chunks, embedding_model)
        else:
            vectors = _embed_ollama(chunks, embedding_model)

        # 임베딩 결과를 JSON으로 저장 (pgvector 없이도 동작)
        from app.core.database import sync_session
        from app.models.workspace import KnowledgeItem

        with sync_session() as db:
            item = db.get(KnowledgeItem, knowledge_id)
            if item:
                item.embeddings_json = json.dumps({
                    "chunks": chunks,
                    "vectors": vectors,
                    "model": embedding_model,
                    "provider": embedding_provider,
                })
                db.commit()

        logger.info("embed_chunks OK: id=%s count=%d", knowledge_id, len(vectors))
        return {"knowledge_id": knowledge_id, "embedded_count": len(vectors)}
    except Exception as exc:
        logger.error("embed_chunks failed: %s", exc)
        raise self.retry(exc=exc, countdown=15)


@shared_task(bind=True, name="app.tasks.knowledge.process_and_embed", max_retries=1)
def process_and_embed(
    self,
    knowledge_id: str,
    file_bytes_b64: str,
    content_type: str,
    filename: str = "",
    chunk_size: int = 1000,
    overlap: int = 100,
    embedding_provider: Literal["openai", "ollama"] = "ollama",
    embedding_model: str = "nomic-embed-text",
) -> dict:
    """
    파이프라인: 문서 파싱 → 청킹 → 임베딩 → 저장
    단일 태스크로 전체 파이프라인 실행 (체이닝 없이 간단하게).
    """
    import base64
    from app.core.database import sync_session
    from app.models.workspace import KnowledgeItem

    try:
        raw = base64.b64decode(file_bytes_b64)
        text = _extract_text(raw, content_type, filename)
        chunks = _chunk_text(text, chunk_size, overlap)

        if embedding_provider == "openai":
            vectors = _embed_openai(chunks, embedding_model)
        else:
            vectors = _embed_ollama(chunks, embedding_model)

        with sync_session() as db:
            item = db.get(KnowledgeItem, knowledge_id)
            if item:
                item.content = text
                item.embeddings_json = json.dumps({
                    "chunks": chunks,
                    "vectors": vectors,
                    "model": embedding_model,
                    "provider": embedding_provider,
                })
                db.commit()

        _publish_task_done(self.request.id, "process_and_embed")
        return {
            "knowledge_id": knowledge_id,
            "text_length": len(text),
            "chunk_count": len(chunks),
            "embedded": True,
            "status": "ok",
        }
    except Exception as exc:
        logger.error("process_and_embed failed: %s", exc)
        raise self.retry(exc=exc, countdown=10)


@shared_task(bind=True, name="app.tasks.knowledge.delete_embeddings", max_retries=2)
def delete_embeddings(self, knowledge_id: str) -> dict:
    """삭제된 파일의 임베딩 데이터 정리"""
    try:
        from app.core.database import sync_session
        from app.models.workspace import KnowledgeItem

        with sync_session() as db:
            item = db.get(KnowledgeItem, knowledge_id)
            if item:
                item.embeddings_json = None
                db.commit()

        return {"knowledge_id": knowledge_id, "status": "deleted"}
    except Exception as exc:
        raise self.retry(exc=exc, countdown=5)
