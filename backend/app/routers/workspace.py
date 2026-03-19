"""
워크스페이스 라우터 (로그인 유저 전용)
- GET/POST/PATCH/DELETE /workspace/items   커스텀 모델·프롬프트·툴·스킬
- GET/POST/DELETE       /workspace/knowledge  지식 베이스 파일
"""
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.workspace import KnowledgeItem, WorkspaceItem
from app.routers.deps import get_current_user

router = APIRouter(prefix="/workspace", tags=["workspace"])

WorkspaceItemType = Literal["model", "prompt", "tool", "skill"]

ALLOWED_CONTENT_TYPES = {
    "text/plain":       "txt",
    "text/markdown":    "md",
    "application/pdf":  "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}


# ── Schemas ───────────────────────────────────────────────────────────────────

class WorkspaceItemOut(BaseModel):
    id: str
    item_type: str
    name: str
    data: dict
    is_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceItemCreate(BaseModel):
    item_type: WorkspaceItemType
    name: str
    data: dict = {}
    is_enabled: bool = True


class WorkspaceItemPatch(BaseModel):
    name: Optional[str] = None
    data: Optional[dict] = None
    is_enabled: Optional[bool] = None


class KnowledgeItemOut(BaseModel):
    id: str
    name: str
    content_type: str
    file_size: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize(item: WorkspaceItem) -> WorkspaceItemOut:
    return WorkspaceItemOut(
        id=str(item.id),
        item_type=item.item_type,
        name=item.name,
        data=item.data or {},
        is_enabled=item.is_enabled,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


async def _get_item_or_404(
    db: AsyncSession, item_id: uuid.UUID, user_id: uuid.UUID
) -> WorkspaceItem:
    row = (
        await db.execute(
            select(WorkspaceItem).where(
                WorkspaceItem.id == item_id,
                WorkspaceItem.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace item not found")
    return row


# ── Workspace Items ───────────────────────────────────────────────────────────

@router.get("/items", response_model=list[WorkspaceItemOut])
async def list_items(
    item_type: Optional[WorkspaceItemType] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(WorkspaceItem).where(WorkspaceItem.user_id == user.id)
    if item_type:
        q = q.where(WorkspaceItem.item_type == item_type)
    q = q.order_by(WorkspaceItem.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_serialize(r) for r in rows]


@router.post("/items", response_model=WorkspaceItemOut, status_code=201)
async def create_item(
    body: WorkspaceItemCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = WorkspaceItem(
        user_id=user.id,
        item_type=body.item_type,
        name=body.name,
        data=body.data,
        is_enabled=body.is_enabled,
    )
    db.add(item)
    await db.flush()
    await db.commit()
    await db.refresh(item)
    return _serialize(item)


@router.patch("/items/{item_id}", response_model=WorkspaceItemOut)
async def update_item(
    item_id: uuid.UUID,
    body: WorkspaceItemPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await _get_item_or_404(db, item_id, user.id)
    if body.name is not None:
        item.name = body.name
    if body.data is not None:
        item.data = body.data
    if body.is_enabled is not None:
        item.is_enabled = body.is_enabled
    item.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.commit()
    await db.refresh(item)
    return _serialize(item)


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await _get_item_or_404(db, item_id, user.id)
    await db.delete(item)
    await db.commit()


# ── Knowledge ─────────────────────────────────────────────────────────────────

@router.get("/knowledge", response_model=list[KnowledgeItemOut])
async def list_knowledge(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(KnowledgeItem)
            .where(KnowledgeItem.user_id == user.id)
            .order_by(KnowledgeItem.created_at.desc())
        )
    ).scalars().all()
    return [
        KnowledgeItemOut(
            id=str(r.id),
            name=r.name,
            content_type=r.content_type,
            file_size=r.file_size,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/knowledge", response_model=KnowledgeItemOut, status_code=201)
async def upload_knowledge(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ct = file.content_type or "text/plain"
    if ct not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported file type: {ct}. Allowed: txt, md, pdf, docx",
        )

    raw = await file.read()
    file_size = len(raw)

    # Simple text extraction (PDF/DOCX extraction can be added later)
    content: Optional[str] = None
    if ct in ("text/plain", "text/markdown"):
        try:
            content = raw.decode("utf-8", errors="replace")
        except Exception:
            content = None

    item = KnowledgeItem(
        user_id=user.id,
        name=file.filename or "Untitled",
        content_type=ct,
        file_size=file_size,
        content=content,
    )
    db.add(item)
    await db.flush()
    await db.commit()
    await db.refresh(item)
    return KnowledgeItemOut(
        id=str(item.id),
        name=item.name,
        content_type=item.content_type,
        file_size=item.file_size,
        created_at=item.created_at,
    )


@router.delete("/knowledge/{item_id}", status_code=204)
async def delete_knowledge(
    item_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.id == item_id,
                KnowledgeItem.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Knowledge item not found")
    await db.delete(row)
    await db.commit()
