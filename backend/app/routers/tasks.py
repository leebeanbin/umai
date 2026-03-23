"""
태스크 상태 조회 API

- POST /tasks/image/resize        이미지 리사이즈
- POST /tasks/image/ocr           OCR
- POST /tasks/image/analyze       이미지 분석
- POST /tasks/image/generate      이미지 생성
- POST /tasks/ai/agent            에이전트 실행
- POST /tasks/ai/search           웹 검색
- POST /tasks/knowledge/process   문서 처리 + 임베딩
- POST /tasks/documents/extract   문서 텍스트 즉시 추출 (PDF/DOCX/TXT/MD, 동기)
- GET  /tasks/{task_id}           태스크 상태/결과 조회
"""
import base64
from typing import Any, Literal

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, status
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.celery_app import celery_app
from app.core.redis import get_redis
from app.routers.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/tasks", tags=["tasks"])
limiter = Limiter(key_func=get_remote_address)


# ── 공통 응답 ────────────────────────────────────────────────────────────────

class TaskResponse(BaseModel):
    task_id: str
    status: str
    result: Any = None
    error: str | None = None


def _task_status(task_id: str) -> TaskResponse:
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
    task = resize_image.apply_async(kwargs=body.model_dump())
    redis = await get_redis()
    await redis.setex(f"task_owner:{task.id}", 3600, str(current_user.id))
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/ocr", response_model=TaskResponse, status_code=202)
async def enqueue_ocr(body: ImageOcrRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import ocr_image
    task = ocr_image.apply_async(kwargs=body.model_dump())
    redis = await get_redis()
    await redis.setex(f"task_owner:{task.id}", 3600, str(current_user.id))
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/analyze", response_model=TaskResponse, status_code=202)
async def enqueue_analyze(body: ImageAnalyzeRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import analyze_image
    task = analyze_image.apply_async(kwargs=body.model_dump())
    redis = await get_redis()
    await redis.setex(f"task_owner:{task.id}", 3600, str(current_user.id))
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/generate", response_model=TaskResponse, status_code=202)
async def enqueue_generate(body: ImageGenerateRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.image import generate_image
    task = generate_image.apply_async(kwargs=body.model_dump())
    redis = await get_redis()
    await redis.setex(f"task_owner:{task.id}", 3600, str(current_user.id))
    return TaskResponse(task_id=task.id, status="queued")


# ── AI 에이전트 태스크 ────────────────────────────────────────────────────────

class AgentRequest(BaseModel):
    messages: list[dict]
    model: str
    provider: Literal["openai", "anthropic", "ollama"] = "openai"
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
    task = run_agent.apply_async(kwargs=body.model_dump())
    redis = await get_redis()
    await redis.setex(f"task_owner:{task.id}", 3600, str(current_user.id))
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/ai/search", response_model=TaskResponse, status_code=202)
async def enqueue_search(body: WebSearchRequest, current_user: User = Depends(get_current_user)):
    from app.tasks.ai import web_search
    task = web_search.apply_async(kwargs=body.model_dump())
    redis = await get_redis()
    await redis.setex(f"task_owner:{task.id}", 3600, str(current_user.id))
    return TaskResponse(task_id=task.id, status="queued")


# ── Knowledge 태스크 ──────────────────────────────────────────────────────────

@router.post("/knowledge/process", response_model=TaskResponse, status_code=202)
@limiter.limit("10/hour")
async def enqueue_knowledge_process(
    request: Request,
    knowledge_id: str = Form(...),
    embedding_provider: Literal["openai", "ollama"] = Form("ollama"),
    embedding_model: str = Form("nomic-embed-text"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """파일 업로드 후 백그라운드에서 파싱 + 임베딩"""
    # 파일 크기 제한 (10 MB)
    MAX_BYTES = 10 * 1024 * 1024
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds 10 MB limit")
    b64 = base64.b64encode(raw).decode()

    from app.tasks.knowledge import process_and_embed
    task = process_and_embed.apply_async(kwargs={
        "knowledge_id": knowledge_id,
        "file_bytes_b64": b64,
        "content_type": file.content_type or "text/plain",
        "filename": file.filename or "",
        "embedding_provider": embedding_provider,
        "embedding_model": embedding_model,
    })
    redis = await get_redis()
    await redis.setex(f"task_owner:{task.id}", 3600, str(current_user.id))
    return TaskResponse(task_id=task.id, status="queued")


# ── 문서 즉시 추출 (동기, 채팅 컨텍스트용) ──────────────────────────────────────

SUPPORTED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
}

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
    max_chars = min(max_chars, 200_000)
    pages     = min(max(pages, 1), 50)

    # 파일 크기 제한 (10 MB)
    MAX_BYTES = 10 * 1024 * 1024
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

    try:
        if content_type == "application/pdf":
            import fitz  # pymupdf
            doc = fitz.open(stream=raw, filetype="pdf")
            page_count = len(doc)
            if mode == "first_pages":
                n = min(pages, page_count)
                text = "\n\n".join(doc[i].get_text() for i in range(n))
            else:
                text = "\n\n".join(page.get_text() for page in doc)

        elif content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            from docx import Document as DocxDocument
            doc_obj = DocxDocument(_io.BytesIO(raw))
            text = "\n".join(p.text for p in doc_obj.paragraphs if p.text.strip())

        else:
            text = raw.decode("utf-8", errors="replace")

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
