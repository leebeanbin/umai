"""
Knowledge Base 처리 태스크 (knowledge queue)

- process_document   : 업로드된 파일에서 텍스트 추출 (PDF/DOCX/TXT/MD)
- embed_chunks       : 청크 임베딩 생성 + PostgreSQL 저장
- process_and_embed  : 파이프라인: 파싱 → 청킹 → 임베딩 → 저장 (단일 태스크)
"""
import io
from typing import Literal

import tiktoken
from celery import shared_task
from celery.utils.log import get_task_logger

from app.tasks._utils import publish_task_done
from app.services.embedding_service import embed_texts_sync

logger = get_task_logger(__name__)


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
        result = {"knowledge_id": knowledge_id, "text_length": len(text), "status": "ok"}
        publish_task_done(self.request.id, "process_document")
        return result
    except Exception as exc:
        logger.error("process_document failed: %s", exc)
        if self.request.retries >= self.max_retries:
            publish_task_done(self.request.id, "process_document")
        raise self.retry(exc=exc, countdown=10)


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
        vectors = embed_texts_sync(chunks, embedding_provider, embedding_model)

        # 임베딩 결과를 JSON으로 저장 (pgvector 없이도 동작)
        from app.core.database import sync_session
        from app.models.workspace import KnowledgeItem

        with sync_session() as db:
            item = db.get(KnowledgeItem, knowledge_id)
            if item:
                item.embeddings_json = {
                    "chunks": chunks,
                    "vectors": vectors,
                    "model": embedding_model,
                    "provider": embedding_provider,
                }
                db.commit()

        logger.info("embed_chunks OK: id=%s count=%d", knowledge_id, len(vectors))
        result = {"knowledge_id": knowledge_id, "embedded_count": len(vectors)}
        publish_task_done(self.request.id, "embed_chunks")
        return result
    except Exception as exc:
        logger.error("embed_chunks failed: %s", exc)
        if self.request.retries >= self.max_retries:
            publish_task_done(self.request.id, "embed_chunks")
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

        vectors = embed_texts_sync(chunks, embedding_provider, embedding_model)

        with sync_session() as db:
            item = db.get(KnowledgeItem, knowledge_id)
            if item:
                item.content = text
                item.embeddings_json = {
                    "chunks": chunks,
                    "vectors": vectors,
                    "model": embedding_model,
                    "provider": embedding_provider,
                }
                db.commit()

        publish_task_done(self.request.id, "process_and_embed")
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


