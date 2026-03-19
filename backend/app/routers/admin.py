"""
어드민 라우터 (role=admin 전용)
- GET  /admin/stats              대시보드 통계
- GET  /admin/users              유저 목록 (페이지네이션)
- GET  /admin/users/{id}         유저 상세
- PATCH /admin/users/{id}        유저 역할/상태 변경
- DELETE /admin/users/{id}       유저 삭제
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.chat import Chat
from app.routers.deps import require_admin

router = APIRouter(prefix="/admin", tags=["admin"])


# ── 스키마 ─────────────────────────────────────────────────────────────────────

class AdminUserOut(BaseModel):
    id: str
    email: str
    name: str
    avatar_url: Optional[str] = None
    role: str
    is_active: bool
    oauth_provider: Optional[str] = None
    created_at: datetime
    last_seen_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UpdateUserRequest(BaseModel):
    role: Optional[str] = None       # "admin" | "user" | "pending"
    is_active: Optional[bool] = None
    name: Optional[str] = None


class StatsOut(BaseModel):
    total_users: int
    active_users: int
    total_chats: int
    new_this_week: int


# ── 통계 ──────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=StatsOut)
async def get_stats(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Single-query stats using CASE/WHEN to avoid 3 separate round-trips."""
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    row = (await db.execute(
        select(
            func.count(User.id).label("total_users"),
            func.count(case((User.is_active == True, 1))).label("active_users"),
            func.count(case((User.created_at >= week_ago, 1))).label("new_this_week"),
        )
    )).one()
    total_chats = (await db.execute(select(func.count(Chat.id)))).scalar_one()
    return StatsOut(
        total_users=row.total_users,
        active_users=row.active_users,
        total_chats=total_chats,
        new_this_week=row.new_this_week,
    )


# ── 유저 목록 ──────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).order_by(User.created_at.desc()).offset(skip).limit(limit)
    )
    return result.scalars().all()


# ── 유저 상세 ──────────────────────────────────────────────────────────────────

@router.get("/users/{user_id}", response_model=AdminUserOut)
async def get_user(
    user_id: uuid.UUID,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


# ── 유저 수정 ──────────────────────────────────────────────────────────────────

@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: uuid.UUID,
    body: UpdateUserRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    # 자신의 role은 변경 불가 (잠금 방지)
    if str(user.id) == str(admin.id) and body.role and body.role != "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot demote yourself")

    if body.role is not None:
        if body.role not in ("admin", "user", "pending"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid role")
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.name is not None:
        user.name = body.name

    await db.flush()
    await db.commit()
    await db.refresh(user)
    return user


# ── 유저 삭제 ──────────────────────────────────────────────────────────────────

@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if str(user_id) == str(admin.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot delete yourself")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    await db.delete(user)


# ── Ollama 프록시 ───────────────────────────────────────────────────────────────

@router.get("/ollama/models")
async def list_ollama_models(_admin: User = Depends(require_admin)):
    """Proxy GET /api/tags from the local Ollama server."""
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{ollama_url}/api/tags")
            r.raise_for_status()
        return r.json()  # {"models": [{"name": "llama3.2", "size": ...}, ...]}
    except Exception:
        raise HTTPException(503, "Ollama unreachable")
