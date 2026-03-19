"""
태스크 상태 조회 API

- POST /tasks/image/resize        이미지 리사이즈
- POST /tasks/image/ocr           OCR
- POST /tasks/image/analyze       이미지 분석
- POST /tasks/image/generate      이미지 생성
- POST /tasks/ai/agent            에이전트 실행
- POST /tasks/ai/search           웹 검색
- POST /tasks/knowledge/process   문서 처리 + 임베딩
- GET  /tasks/{task_id}           태스크 상태/결과 조회
"""
import base64
from typing import Any, Literal

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from pydantic import BaseModel

from app.core.celery_app import celery_app
from app.routers.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/tasks", tags=["tasks"])


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
async def get_task(task_id: str, _user: User = Depends(get_current_user)):
    return _task_status(task_id)


# ── 이미지 태스크 ─────────────────────────────────────────────────────────────

class ImageResizeRequest(BaseModel):
    source: str          # URL or data URI
    max_size: int = 2048
    output_format: Literal["JPEG", "PNG", "WEBP"] = "JPEG"
    quality: int = 85


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
    size: str = "1024x1024"


@router.post("/image/resize", response_model=TaskResponse, status_code=202)
async def enqueue_resize(body: ImageResizeRequest, _user: User = Depends(get_current_user)):
    from app.tasks.image import resize_image
    task = resize_image.apply_async(kwargs=body.model_dump())
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/ocr", response_model=TaskResponse, status_code=202)
async def enqueue_ocr(body: ImageOcrRequest, _user: User = Depends(get_current_user)):
    from app.tasks.image import ocr_image
    task = ocr_image.apply_async(kwargs=body.model_dump())
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/analyze", response_model=TaskResponse, status_code=202)
async def enqueue_analyze(body: ImageAnalyzeRequest, _user: User = Depends(get_current_user)):
    from app.tasks.image import analyze_image
    task = analyze_image.apply_async(kwargs=body.model_dump())
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/image/generate", response_model=TaskResponse, status_code=202)
async def enqueue_generate(body: ImageGenerateRequest, _user: User = Depends(get_current_user)):
    from app.tasks.image import generate_image
    task = generate_image.apply_async(kwargs=body.model_dump())
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
async def enqueue_agent(body: AgentRequest, _user: User = Depends(get_current_user)):
    from app.tasks.ai import run_agent
    task = run_agent.apply_async(kwargs=body.model_dump())
    return TaskResponse(task_id=task.id, status="queued")


@router.post("/ai/search", response_model=TaskResponse, status_code=202)
async def enqueue_search(body: WebSearchRequest, _user: User = Depends(get_current_user)):
    from app.tasks.ai import web_search
    task = web_search.apply_async(kwargs=body.model_dump())
    return TaskResponse(task_id=task.id, status="queued")


# ── Knowledge 태스크 ──────────────────────────────────────────────────────────

@router.post("/knowledge/process", response_model=TaskResponse, status_code=202)
async def enqueue_knowledge_process(
    knowledge_id: str = Form(...),
    embedding_provider: Literal["openai", "ollama"] = Form("ollama"),
    embedding_model: str = Form("nomic-embed-text"),
    file: UploadFile = File(...),
    _user: User = Depends(get_current_user),
):
    """파일 업로드 후 백그라운드에서 파싱 + 임베딩"""
    raw = await file.read()
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
    return TaskResponse(task_id=task.id, status="queued")
