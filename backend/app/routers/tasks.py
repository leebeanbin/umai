"""
태스크 상태 조회 API

- POST /tasks/image/resize              이미지 리사이즈
- POST /tasks/image/ocr                 OCR
- POST /tasks/image/analyze             이미지 분석
- POST /tasks/image/generate            이미지 생성
- POST /tasks/image/remove-background   배경 제거 (rembg BiRefNet + alpha matting)
- POST /tasks/image/compose-studio      배경 합성 (solid/gradient/ai — PIL + DALL-E 3)
- POST /tasks/image/segment-click       클릭 세그먼트 (SAM2)
- POST /tasks/image/edit                인페인팅 (gpt-image-1 / FLUX.1 Fill)
- POST /tasks/ai/agent                  에이전트 실행
- POST /tasks/ai/search                 웹 검색
- POST /tasks/knowledge/process         문서 처리 + 임베딩
- POST /tasks/documents/extract         문서 텍스트 즉시 추출 (PDF/DOCX/TXT/MD, 동기)
- GET  /tasks/{task_id}                 태스크 상태/결과 조회
"""
import base64
from typing import Any, Literal

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, status
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.celery_app import celery_app
from app.core.redis_keys import key_task_owner, key_chat_channel
from app.core.constants import (
    SUPPORTED_DOCUMENT_TYPES,
    TASK_OWNER_TTL, MAX_FILE_SIZE_BYTES, MAX_DOCUMENT_CHARS, MAX_DOCUMENT_PAGES,
    RATE_TASK_KNOWLEDGE, RATE_TASK_EXTRACT,
)
from app.core.database import get_db
from app.core.redis import get_redis
from app.routers.deps import get_current_user
from app.models.user import User
from app.models.workspace import KnowledgeItem

router = APIRouter(prefix="/tasks", tags=["tasks"])
limiter = Limiter(key_func=get_remote_address)


# ── 공통 응답 ────────────────────────────────────────────────────────────────

class TaskResponse(BaseModel):
    task_id: str
    status: str
    result: Any = None
    error: str | None = None


def _task_status(task_id: str) -> TaskResponse:
    # M2: Redis/Celery 백엔드 장애 시 graceful fallback (500 대신 unknown 반환)
    try:
        result: AsyncResult = AsyncResult(task_id, app=celery_app)
        if result.state == "PENDING":
            return TaskResponse(task_id=task_id, status="pending")
        elif result.state == "STARTED":
            return TaskResponse(task_id=task_id, status="running")
        elif result.state == "SUCCESS":
            return TaskResponse(task_id=task_id, status="success", result=result.result)
        elif result.state == "FAILURE":
            return TaskResponse(task_id=task_id, status="failed", error=str(result.result))
        else:
            return TaskResponse(task_id=task_id, status=result.state.lower())
    except Exception:
        return TaskResponse(task_id=task_id, status="unknown")


# ── 태스크 상태 조회 ──────────────────────────────────────────────────────────

@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str, current_user: User = Depends(get_current_user)):
    redis = await get_redis()
    owner = await redis.get(f"task_owner:{task_id}")
    if owner is None or owner != str(current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Task not found or access denied")
    return _task_status(task_id)


# ── 이미지 태스크 ─────────────────────────────────────────────────────────────

class ImageResizeRequest(BaseModel):
    source: str          # URL or data URI
    max_size: int = Field(2048, ge=1, le=8192)
    output_format: Literal["JPEG", "PNG", "WEBP"] = "JPEG"
    quality: int = Field(85, ge=1, le=100)


class ImageOcrRequest(BaseModel):
    source: str
    model: str = "llava"
    prompt: str = "이 이미지에서 텍스트를 모두 추출해줘."


class ImageAnalyzeRequest(BaseModel):
    source: str
    prompt: str
    model: str = "llava"
    provider: Literal["ollama", "openai"] = "ollama"


class ImageGenerateRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    provider: Literal["openai", "comfyui", "automatic1111"] = "openai"
    model: str = "dall-e-3"
    size: str = Field("1024x1024", pattern=r"^\d{1,5}x\d{1,5}$")


@router.post("/image/resize", response_model=TaskResponse, status_code=202)
async def enqueue_resize(body: ImageResizeRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import resize_image
    try:
        task = resize_image.apply_async(kwargs=body.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/ocr", response_model=TaskResponse, status_code=202)
async def enqueue_ocr(body: ImageOcrRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import ocr_image
    try:
        task = ocr_image.apply_async(kwargs=body.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/analyze", response_model=TaskResponse, status_code=202)
async def enqueue_analyze(body: ImageAnalyzeRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import analyze_image
    try:
        task = analyze_image.apply_async(kwargs=body.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/generate", response_model=TaskResponse, status_code=202)
async def enqueue_generate(body: ImageGenerateRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import generate_image
    try:
        task = generate_image.apply_async(kwargs=body.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


# ── AI 에이전트 태스크 ────────────────────────────────────────────────────────

class ImageRemoveBgRequest(BaseModel):
    source: str
    model: str = "birefnet-general"
    alpha_matting: bool = True


class ImageComposeStudioRequest(BaseModel):
    foreground_b64: str
    background_prompt: str
    bg_type: Literal["solid", "gradient", "ai"] = "ai"
    bg_color: str = "#ffffff"
    bg_color2: str = "#e0e0e0"
    size: int = Field(1024, ge=256, le=2048)


class ImageSegmentClickRequest(BaseModel):
    source: str
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)


class ImageEditRequest(BaseModel):
    source: str
    mask: str
    prompt: str
    provider: Literal["gpt-image-1", "comfyui"] = "gpt-image-1"
    size: str = Field("1024x1024", pattern=r"^\d{1,5}x\d{1,5}$")


@router.post("/image/remove-background", response_model=TaskResponse, status_code=202)
async def enqueue_remove_background(body: ImageRemoveBgRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import remove_background
    try:
        task = remove_background.apply_async(kwargs=body.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/compose-studio", response_model=TaskResponse, status_code=202)
async def enqueue_compose_studio(body: ImageComposeStudioRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import compose_studio
    try:
        task = compose_studio.apply_async(kwargs=body.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/segment-click", response_model=TaskResponse, status_code=202)
async def enqueue_segment_click(body: ImageSegmentClickRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import segment_click
    try:
        task = segment_click.apply_async(kwargs=body.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/edit", response_model=TaskResponse, status_code=202)
async def enqueue_edit_image(body: ImageEditRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import edit_image
    try:
        task = edit_image.apply_async(kwargs=body.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


class AgentRequest(BaseModel):
    messages: list[dict]
    model: str
    provider: Literal["openai", "anthropic", "google", "xai", "ollama"] = "openai"
    enabled_tools: list[str] | None = None   # ["web_search", "execute_python", "knowledge_search"]
    max_steps: int = 10
    temperature: float = 0.7
    chat_id: str | None = None


class WebSearchRequest(BaseModel):
    query: str
    max_results: int = 5


@router.post("/ai/agent", response_model=TaskResponse, status_code=202)
async def enqueue_agent(body: AgentRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.ai import run_agent
    try:
        task = run_agent.apply_async(kwargs=body.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/ai/search", response_model=TaskResponse, status_code=202)
async def enqueue_search(body: WebSearchRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.ai import web_search
    try:
        task = web_search.apply_async(kwargs=body.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


# ── Knowledge 태스크 ──────────────────────────────────────────────────────────

@router.post("/knowledge/process", response_model=TaskResponse, status_code=202)
@limiter.limit(RATE_TASK_KNOWLEDGE)
async def enqueue_knowledge_process(
    request: Request,
    knowledge_id: str = Form(...),
    embedding_provider: Literal["openai", "ollama"] = Form("ollama"),
    embedding_model: str = Form("nomic-embed-text"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """파일 업로드 후 백그라운드에서 파싱 + 임베딩"""
    import uuid as _uuid

    # Ownership check: verify the knowledge item belongs to the current user
    try:
        kid_uuid = _uuid.UUID(knowledge_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid knowledge_id format")
    item = await db.get(KnowledgeItem, kid_uuid)
    if not item or item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    # 파일 크기 제한 (10 MB)
    MAX_BYTES = MAX_FILE_SIZE_BYTES
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds 10 MB limit")
    b64 = base64.b64encode(raw).decode()

    from app.tasks.knowledge import process_and_embed
    try:
        task = process_and_embed.apply_async(kwargs={
            "knowledge_id": knowledge_id,
            "file_bytes_b64": b64,
            "content_type": file.content_type or "text/plain",
            "filename": file.filename or "",
            "embedding_provider": embedding_provider,
            "embedding_model": embedding_model,
        })
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Task queue unavailable: {exc}")
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, str(current_user.id))  # C4: task_time_limit(1800s) × 4 버퍼
    return TaskResponse(task_id=task.id, status="queued")


# ── 문서 즉시 추출 (동기, 채팅 컨텍스트용) ──────────────────────────────────────

SUPPORTED_TYPES = SUPPORTED_DOCUMENT_TYPES

@router.post("/documents/extract")
@limiter.limit("20/minute")
async def extract_document(
    request: Request,
    file: UploadFile = File(...),
    mode: str = Form("full"),          # "full" | "first_pages"
    max_chars: int = Form(60000),      # 토큰 절약: 기본 ~15k 토큰
    pages: int = Form(5),              # first_pages 모드 시 몇 페이지
    _user: User = Depends(get_current_user),
):
    """
    PDF / DOCX / TXT / MD 파일에서 텍스트를 동기적으로 추출.
    채팅 컨텍스트 주입 용도 — Celery 없이 즉시 반환.

    modes:
      full        — 전체 텍스트 (max_chars 기준으로 잘림)
      first_pages — PDF 앞 N 페이지만 추출
    """
    import io as _io

    # 사용자 파라미터 상한 클램프 (DoS 방지)
    max_chars = min(max_chars, MAX_DOCUMENT_CHARS)
    pages     = min(max(pages, 1), MAX_DOCUMENT_PAGES)

    # 파일 크기 제한 (10 MB)
    MAX_BYTES = MAX_FILE_SIZE_BYTES
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds 10 MB limit")

    content_type = (file.content_type or "").split(";")[0].strip()
    filename = file.filename or ""

    # 확장자로 타입 보정
    if not content_type or content_type == "application/octet-stream":
        if filename.lower().endswith(".pdf"):
            content_type = "application/pdf"
        elif filename.lower().endswith(".docx"):
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif filename.lower().endswith((".md", ".markdown")):
            content_type = "text/markdown"
        else:
            content_type = "text/plain"

    if content_type not in SUPPORTED_TYPES and not content_type.startswith("text/"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {content_type}")

    page_count: int | None = None

    # CPU 집약적 파싱을 threadpool로 오프로드 — async 이벤트 루프 블로킹 방지
    def _extract_sync():
        nonlocal page_count
        if content_type == "application/pdf":
            import fitz  # pymupdf
            doc = fitz.open(stream=raw, filetype="pdf")
            page_count = len(doc)
            if mode == "first_pages":
                n = min(pages, page_count)
                return "\n\n".join(doc[i].get_text() for i in range(n))
            return "\n\n".join(page.get_text() for page in doc)

        if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            from docx import Document as DocxDocument
            doc_obj = DocxDocument(_io.BytesIO(raw))
            return "\n".join(p.text for p in doc_obj.paragraphs if p.text.strip())

        return raw.decode("utf-8", errors="replace")

    try:
        text = await run_in_threadpool(_extract_sync)
    except Exception as exc:
        import logging; logging.getLogger(__name__).warning("Document extraction error: %s", exc)
        raise HTTPException(status_code=422, detail="Failed to extract text from document") from exc

    # 컨텍스트 윈도우 절약: max_chars 기준 잘림
    truncated = False
    if len(text) > max_chars:
        text = text[:max_chars]
        truncated = True

    return {
        "text":       text,
        "char_count": len(text),
        "page_count": page_count,
        "filename":   filename,
        "mode":       mode,
        "truncated":  truncated,
    }
