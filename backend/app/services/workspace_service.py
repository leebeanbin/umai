"""
워크스페이스 서비스 — WorkspaceItem / KnowledgeItem 비즈니스 로직.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ErrCode
from app.models.workspace import KnowledgeItem, WorkspaceItem

WorkspaceItemType = Literal["model", "prompt", "tool", "skill"]

ALLOWED_CONTENT_TYPES = {
    "text/plain":       "txt",
    "text/markdown":    "md",
    "application/pdf":  "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}

# magic byte 서명 — content_type 헤더 스푸핑 방어
_MAGIC: dict[str, bytes] = {
    "application/pdf": b"%PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": b"PK\x03\x04",
}


def _check_magic(raw: bytes, content_type: str) -> bool:
    """파일 내용의 magic byte가 선언된 content_type과 일치하는지 검증."""
    magic = _MAGIC.get(content_type)
    return magic is None or raw[:len(magic)] == magic


def _safe_filename(name: str) -> str:
    """경로 탐색(path traversal) 방어 및 안전한 파일명 반환."""
    base = os.path.basename(name).strip()
    if not base or base.startswith("."):
        return "Untitled"
    return base[:255]


class WorkspaceService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Workspace Items ───────────────────────────────────────────────────────

    async def list_items(
        self,
        user_id: uuid.UUID,
        item_type: WorkspaceItemType | None = None,
    ) -> list[WorkspaceItem]:
        q = select(WorkspaceItem).where(WorkspaceItem.user_id == user_id)
        if item_type:
            q = q.where(WorkspaceItem.item_type == item_type)
        q = q.order_by(WorkspaceItem.created_at.desc())
        return list((await self.db.execute(q)).scalars().all())

    async def create_item(
        self,
        user_id: uuid.UUID,
        item_type: WorkspaceItemType,
        name: str,
        data: dict,
        is_enabled: bool,
    ) -> WorkspaceItem:
        item = WorkspaceItem(
            user_id=user_id,
            item_type=item_type,
            name=name,
            data=data,
            is_enabled=is_enabled,
        )
        self.db.add(item)
        await self.db.flush()
        return item

    async def get_item(self, item_id: uuid.UUID, user_id: uuid.UUID) -> WorkspaceItem:
        row = (await self.db.execute(
            select(WorkspaceItem).where(
                WorkspaceItem.id == item_id,
                WorkspaceItem.user_id == user_id,
            )
        )).scalar_one_or_none()
        if not row:
            ErrCode.WORKSPACE_NOT_FOUND.raise_it()
        return row

    async def update_item(
        self,
        item: WorkspaceItem,
        name: str | None,
        data: dict | None,
        is_enabled: bool | None,
    ) -> WorkspaceItem:
        if name is not None:
            item.name = name
        if data is not None:
            item.data = data
        if is_enabled is not None:
            item.is_enabled = is_enabled
        item.updated_at = datetime.now(timezone.utc)
        await self.db.flush()
        return item

    async def delete_item(self, item: WorkspaceItem) -> None:
        await self.db.delete(item)

    # ── Knowledge Items ───────────────────────────────────────────────────────

    async def list_knowledge(self, user_id: uuid.UUID) -> list[KnowledgeItem]:
        rows = (await self.db.execute(
            select(KnowledgeItem)
            .where(KnowledgeItem.user_id == user_id)
            .order_by(KnowledgeItem.created_at.desc())
        )).scalars().all()
        return list(rows)

    async def upload_knowledge(
        self,
        user_id: uuid.UUID,
        filename: str,
        content_type: str,
        raw_bytes: bytes,
    ) -> KnowledgeItem:
        if content_type not in ALLOWED_CONTENT_TYPES:
            ErrCode.UNSUPPORTED_TYPE.raise_it(
                f"지원하지 않는 파일 형식: {content_type}. "
                f"허용: {', '.join(ALLOWED_CONTENT_TYPES.values())}"
            )

        # magic byte 검증 — content_type 헤더 스푸핑 방어
        if not _check_magic(raw_bytes, content_type):
            ErrCode.UNSUPPORTED_TYPE.raise_it(
                "파일 내용이 선언된 형식과 일치하지 않습니다"
            )

        # 파일명 sanitize — 경로 탐색 방어
        filename = _safe_filename(filename)

        content: str | None = None
        if content_type in ("text/plain", "text/markdown"):
            try:
                content = raw_bytes.decode("utf-8", errors="replace")
            except Exception:
                content = None

        item = KnowledgeItem(
            user_id=user_id,
            name=filename,
            content_type=content_type,
            file_size=len(raw_bytes),
            content=content,
        )
        self.db.add(item)
        await self.db.flush()
        return item

    async def get_knowledge_or_404(
        self, item_id: uuid.UUID, user_id: uuid.UUID
    ) -> KnowledgeItem:
        row = (await self.db.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.id == item_id,
                KnowledgeItem.user_id == user_id,
            )
        )).scalar_one_or_none()
        if not row:
            ErrCode.KNOWLEDGE_NOT_FOUND.raise_it()
        return row

    async def delete_knowledge(self, item: KnowledgeItem) -> None:
        await self.db.delete(item)
