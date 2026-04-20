"""
워크스페이스 라우터 — HTTP 관심사만 담당.
비즈니스 로직은 WorkspaceService에 위임.

- GET/POST/PATCH/DELETE /workspace/items     커스텀 모델·프롬프트·툴·스킬
- GET/POST/DELETE       /workspace/knowledge  지식 베이스 파일
"""
import uuid
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import (
    RATE_WORKSPACE_ITEM_WRITE,
    RATE_WORKSPACE_KNOWLEDGE_UPLOAD,
    RATE_WORKSPACE_KNOWLEDGE_DELETE,
)
from app.core.database import get_db
from app.models.user import User
from app.routers.deps import get_current_user
from app.services.workspace_service import WorkspaceService, WorkspaceItemType

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/workspace", tags=["workspace"])


def get_workspace_service(db: AsyncSession = Depends(get_db)) -> WorkspaceService:
    return WorkspaceService(db)


# ── Schemas ───────────────────────────────────────────────────────────────────

class WorkspaceItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    item_type: str
    name: str
    data: dict
    is_enabled: bool
    created_at: datetime
    updated_at: datetime

    @field_serializer("id")
    def _id(self, v: uuid.UUID) -> str:
        return str(v)


class WorkspaceItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_type: WorkspaceItemType
    name: str = Field(..., min_length=1, max_length=200)
    data: dict = {}
    is_enabled: bool = True


class WorkspaceItemPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    data: Optional[dict] = None
    is_enabled: Optional[bool] = None


class KnowledgeItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    content_type: str
    file_size: int
    created_at: datetime

    @field_serializer("id")
    def _id(self, v: uuid.UUID) -> str:
        return str(v)


# ── Workspace Items ───────────────────────────────────────────────────────────

@router.get("/items", response_model=list[WorkspaceItemOut])
async def list_items(
    item_type: Optional[WorkspaceItemType] = None,
    svc: WorkspaceService = Depends(get_workspace_service),
    user: User = Depends(get_current_user),
):
    items = await svc.list_items(user.id, item_type)
    return [WorkspaceItemOut.model_validate(i) for i in items]


@router.post("/items", response_model=WorkspaceItemOut, status_code=201)
@limiter.limit(RATE_WORKSPACE_ITEM_WRITE)
async def create_item(
    request: Request,
    body: WorkspaceItemCreate,
    svc: WorkspaceService = Depends(get_workspace_service),
    user: User = Depends(get_current_user),
):
    item = await svc.create_item(
        user_id=user.id,
        item_type=body.item_type,
        name=body.name,
        data=body.data,
        is_enabled=body.is_enabled,
    )
    return WorkspaceItemOut.model_validate(item)


@router.patch("/items/{item_id}", response_model=WorkspaceItemOut)
@limiter.limit(RATE_WORKSPACE_ITEM_WRITE)
async def update_item(
    request: Request,
    item_id: uuid.UUID,
    body: WorkspaceItemPatch,
    svc: WorkspaceService = Depends(get_workspace_service),
    user: User = Depends(get_current_user),
):
    item = await svc.get_item(item_id, user.id)
    item = await svc.update_item(item, body.name, body.data, body.is_enabled)
    return WorkspaceItemOut.model_validate(item)


@router.delete("/items/{item_id}", status_code=204)
@limiter.limit(RATE_WORKSPACE_ITEM_WRITE)
async def delete_item(
    request: Request,
    item_id: uuid.UUID,
    svc: WorkspaceService = Depends(get_workspace_service),
    user: User = Depends(get_current_user),
):
    item = await svc.get_item(item_id, user.id)
    await svc.delete_item(item)


# ── Knowledge ─────────────────────────────────────────────────────────────────

@router.get("/knowledge")
async def list_knowledge(
    cursor: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cursor-based pagination — cursor는 이전 응답의 next_cursor 값."""
    from sqlalchemy import select as _select
    from app.models.workspace import KnowledgeItem as _KI

    q = _select(_KI).where(_KI.user_id == user.id)
    if cursor:
        try:
            cursor_dt = datetime.fromisoformat(cursor)
            q = q.where(_KI.created_at < cursor_dt)
        except ValueError:
            pass
    q = q.order_by(_KI.created_at.desc()).limit(limit + 1)
    rows = (await db.scalars(q)).all()
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = items[-1].created_at.isoformat() if has_more and items else None
    return {
        "items": [KnowledgeItemOut.model_validate(i) for i in items],
        "next_cursor": next_cursor,
    }


@router.post("/knowledge", response_model=KnowledgeItemOut, status_code=201)
@limiter.limit(RATE_WORKSPACE_KNOWLEDGE_UPLOAD)
async def upload_knowledge(
    request: Request,
    file: UploadFile = File(...),
    svc: WorkspaceService = Depends(get_workspace_service),
    user: User = Depends(get_current_user),
):
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    raw = await file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds the {settings.MAX_UPLOAD_SIZE_MB} MB limit.",
        )
    item = await svc.upload_knowledge(
        user_id=user.id,
        filename=file.filename or "Untitled",
        content_type=file.content_type or "text/plain",
        raw_bytes=raw,
    )
    return KnowledgeItemOut.model_validate(item)


@router.delete("/knowledge/{item_id}", status_code=204)
@limiter.limit(RATE_WORKSPACE_KNOWLEDGE_DELETE)
async def delete_knowledge(
    request: Request,
    item_id: uuid.UUID,
    svc: WorkspaceService = Depends(get_workspace_service),
    user: User = Depends(get_current_user),
):
    item = await svc.get_knowledge_or_404(item_id, user.id)
    await svc.delete_knowledge(item)
