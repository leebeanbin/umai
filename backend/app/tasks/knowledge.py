"""
Knowledge Base 처리 태스크 (knowledge queue)

- process_document   : 업로드된 파일에서 텍스트 추출 (PDF/DOCX/TXT/MD)
- embed_chunks       : 청크 임베딩 생성 + PostgreSQL 저장
- process_and_embed  : 파이프라인: 파싱 → 청킹 → 임베딩 → 저장 (단일 태스크)
"""
import hashlib
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
        # ── 청크 콘텐츠 해시 중복 제거 ──────────────────────────────────────
        # 동일 텍스트 청크가 여러 번 등장하는 문서(반복 섹션, 면책 조항 등)에서
        # 임베딩 API 호출을 절감하고 중복 벡터 저장을 방지한다.
        # 전략: MD5(chunk) → 인덱스 매핑으로 unique 청크만 임베딩 후 원래 순서 복원.
        seen_hashes: dict[str, int] = {}   # hash → first occurrence index in unique list
        unique_chunks: list[str] = []
        chunk_to_unique_idx: list[int] = []

        for chunk in chunks:
            h = hashlib.md5(chunk.encode()).hexdigest()
            if h not in seen_hashes:
                seen_hashes[h] = len(unique_chunks)
                unique_chunks.append(chunk)
            chunk_to_unique_idx.append(seen_hashes[h])

        dedup_count = len(chunks) - len(unique_chunks)
        if dedup_count:
            logger.info("embed_chunks: deduplicated %d/%d chunks for id=%s",
                        dedup_count, len(chunks), knowledge_id)

        unique_vectors = embed_texts_sync(unique_chunks, embedding_provider, embedding_model)
        # 원래 순서로 복원 (중복 청크는 같은 벡터 재사용)
        vectors = [unique_vectors[idx] for idx in chunk_to_unique_idx]

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

        logger.info("embed_chunks OK: id=%s count=%d (unique=%d)", knowledge_id, len(vectors), len(unique_chunks))
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

        # ── Bloom filter: 동일 파일 재임베딩 방지 ───────────────────────────
        # 파일 원본 바이트의 SHA-256을 문서 지문으로 사용.
        # Bloom filter에 이미 있으면 → 이전에 임베딩됐을 가능성이 높음.
        # 오탐(false positive) 시에는 중복 처리될 수 있으나,
        # 미탐(false negative)은 없음 — 안전한 방향의 오류.
        import hashlib as _hlib
        from app.core.redis import bloom_check, bloom_add as _bloom_add
        _doc_fingerprint = _hlib.sha256(raw).hexdigest()
        # Bloom filter 조회는 동기 컨텍스트에서 실행 불가 → asyncio 없이 직접 Redis 사용
        import asyncio as _asyncio
        try:
            _loop = _asyncio.new_event_loop()
            _already_embedded = _loop.run_until_complete(bloom_check(_doc_fingerprint))
            _loop.close()
        except Exception as exc:
            # Redis 장애 시 graceful degradation — 재처리 허용
            # WARNING 레벨로 기록하여 지속적 Redis 장애를 운영자가 탐지할 수 있게 함
            logger.warning(
                "process_and_embed: Bloom filter check failed for id=%s (will re-embed): %s",
                knowledge_id, exc,
            )
            _already_embedded = False

        if _already_embedded:
            logger.info(
                "process_and_embed: Bloom filter hit — skipping re-embed for id=%s (fingerprint=%s…)",
                knowledge_id, _doc_fingerprint[:12],
            )
            publish_task_done(self.request.id, "process_and_embed")
            return {
                "knowledge_id": knowledge_id,
                "text_length": 0,
                "chunk_count": 0,
                "embedded": False,
                "status": "skipped_duplicate",
            }

        text = _extract_text(raw, content_type, filename)
        chunks = _chunk_text(text, chunk_size, overlap)

        # 청크 해시 중복 제거 (embed_chunks 태스크와 동일 로직)
        seen_hashes: dict[str, int] = {}
        unique_chunks: list[str] = []
        chunk_to_unique_idx: list[int] = []
        for chunk in chunks:
            h = hashlib.md5(chunk.encode()).hexdigest()
            if h not in seen_hashes:
                seen_hashes[h] = len(unique_chunks)
                unique_chunks.append(chunk)
            chunk_to_unique_idx.append(seen_hashes[h])

        unique_vectors = embed_texts_sync(unique_chunks, embedding_provider, embedding_model)
        vectors = [unique_vectors[idx] for idx in chunk_to_unique_idx]

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

        # 임베딩 완료 → Bloom filter에 문서 지문 등록
        try:
            _loop2 = _asyncio.new_event_loop()
            _loop2.run_until_complete(_bloom_add(_doc_fingerprint))
            _loop2.close()
        except Exception as exc:
            # 등록 실패 시 다음 업로드에서 중복 임베딩 발생 가능 (과금 중복)
            # 치명적이지 않으나 반복 시 비용 문제가 됨 → WARNING 기록
            logger.warning(
                "process_and_embed: Bloom filter add failed for id=%s (fingerprint=%s…): %s",
                knowledge_id, _doc_fingerprint[:12], exc,
            )

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


