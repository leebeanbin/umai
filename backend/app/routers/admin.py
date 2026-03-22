"""
어드민 라우터 (role=admin 전용)
- GET  /admin/stats              대시보드 통계
- GET  /admin/users              유저 목록 (페이지네이션)
- GET  /admin/users/{id}         유저 상세
- PATCH /admin/users/{id}        유저 역할/상태 변경
- DELETE /admin/users/{id}       유저 삭제
- GET  /admin/settings           시스템 설정 전체 (admin only)
- PATCH /admin/settings          시스템 설정 부분 업데이트 (admin only)
- GET  /admin/settings/public    OAuth 활성화 여부 (인증 불필요)
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_serializer
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import ErrCode
from app.models.user import User
from app.models.chat import Chat, Message
from app.models.settings import SystemSettings, DEFAULT_SETTINGS
from app.schemas.chat import RatingEntryOut
from app.routers.deps import require_admin, get_current_user

router = APIRouter(prefix="/admin", tags=["admin"])


# ── 스키마 ─────────────────────────────────────────────────────────────────────

class AdminUserOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    avatar_url: Optional[str] = None
    role: str
    is_active: bool
    oauth_provider: Optional[str] = None
    created_at: datetime
    last_seen_at: Optional[datetime] = None

    model_config = {"from_attributes": True}

    @field_serializer("id")
    def serialize_id(self, v: uuid.UUID) -> str:
        return str(v)


class UpdateUserRequest(BaseModel):
    role: Optional[str] = None       # "admin" | "user" | "pending"
    is_active: Optional[bool] = None
    name: Optional[str] = None


class StatsOut(BaseModel):
    total_users: int
    active_users: int
    total_chats: int
    new_this_week: int
    daily_chats: list[int]    # 오늘 포함 최근 7일 채팅 생성 수 (오래된 날 → 최근 날)
    daily_signups: list[int]  # 오늘 포함 최근 7일 가입자 수


# ── 통계 ──────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=StatsOut)
async def get_stats(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Single-query stats + 7-day daily breakdown."""
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    # 집계 통계
    row = (await db.execute(
        select(
            func.count(User.id).label("total_users"),
            func.count(case((User.is_active == True, 1))).label("active_users"),
            func.count(case((User.created_at >= week_ago, 1))).label("new_this_week"),
        )
    )).one()
    total_chats = (await db.execute(select(func.count(Chat.id)))).scalar_one()

    # 일별 채팅 생성 수 (최근 7일)
    chat_rows = (await db.execute(
        select(
            func.date_trunc("day", Chat.created_at).label("day"),
            func.count(Chat.id).label("cnt"),
        )
        .where(Chat.created_at >= week_ago)
        .group_by(func.date_trunc("day", Chat.created_at))
    )).all()
    chat_by_day: dict[str, int] = {str(r.day.date()): r.cnt for r in chat_rows}

    # 일별 가입자 수 (최근 7일)
    signup_rows = (await db.execute(
        select(
            func.date_trunc("day", User.created_at).label("day"),
            func.count(User.id).label("cnt"),
        )
        .where(User.created_at >= week_ago)
        .group_by(func.date_trunc("day", User.created_at))
    )).all()
    signup_by_day: dict[str, int] = {str(r.day.date()): r.cnt for r in signup_rows}

    # 오래된 날 → 최근 날 순서로 7개 슬롯 채우기
    daily_chats   = [chat_by_day.get(str((now - timedelta(days=6 - i)).date()), 0) for i in range(7)]
    daily_signups = [signup_by_day.get(str((now - timedelta(days=6 - i)).date()), 0) for i in range(7)]

    return StatsOut(
        total_users=row.total_users,
        active_users=row.active_users,
        total_chats=total_chats,
        new_this_week=row.new_this_week,
        daily_chats=daily_chats,
        daily_signups=daily_signups,
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
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        ErrCode.USER_NOT_FOUND.raise_it()
    return user


# ── 유저 수정 ──────────────────────────────────────────────────────────────────

@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: uuid.UUID,
    body: UpdateUserRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        ErrCode.USER_NOT_FOUND.raise_it()

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

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        ErrCode.USER_NOT_FOUND.raise_it()

    await db.delete(user)


# ── Ollama 프록시 ───────────────────────────────────────────────────────────────

def _infer_capabilities(name: str, families: list[str]) -> list[str]:
    """모델 이름과 family 기반으로 지원 기능 추론."""
    caps: list[str] = []
    nl = name.lower()
    fl = [f.lower() for f in families]

    # Vision / multimodal
    if any(f in fl for f in ("clip", "llava")) or any(
        k in nl for k in ("llava", "moondream", "minicpm-v", "bakllava", "vision")
    ):
        caps.append("vision")
        caps.append("ocr")  # vision 모델은 OCR도 가능

    # Function calling / tool use
    if any(k in nl for k in ("mistral", "qwen2.5", "qwen2", "llama3.1", "llama3.2", "llama3.3", "functionary", "firefunction")):
        caps.append("tools")

    # Code generation
    if any(k in nl for k in ("codellama", "deepseek-coder", "starcoder", "qwen2.5-coder", "codegemma", "codeqwen", "phind")):
        caps.append("code")

    return caps


@router.get("/ollama/models")
async def list_ollama_models(_admin: User = Depends(require_admin)):
    """Proxy GET /api/tags from the local Ollama server."""
    ollama_url = settings.OLLAMA_URL
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{ollama_url}/api/tags")
            r.raise_for_status()
        return r.json()  # {"models": [{"name": "llama3.2", "size": ...}, ...]}
    except Exception:
        raise HTTPException(503, "Ollama unreachable")


@router.get("/ollama/models/{model_name:path}/capabilities")
async def get_ollama_model_capabilities(
    model_name: str,
    _admin: User = Depends(require_admin),
):
    """Proxy GET /api/show and return enriched capability metadata."""
    ollama_url = settings.OLLAMA_URL
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{ollama_url}/api/show",
                json={"name": model_name},
            )
            r.raise_for_status()
        raw = r.json()
    except Exception:
        raise HTTPException(503, "Ollama unreachable")

    details = raw.get("details", {})
    model_info = raw.get("model_info", {})

    families: list[str] = details.get("families") or []
    if isinstance(families, str):
        families = [families]

    # context_length: 모델 아키텍처에 따라 필드명 다름
    context_length = 0
    for key, val in model_info.items():
        if key.endswith(".context_length") and isinstance(val, int):
            context_length = val
            break

    return {
        "name": model_name,
        "family": details.get("family", ""),
        "families": families,
        "parameter_size": details.get("parameter_size", ""),
        "quantization": details.get("quantization_level", ""),
        "context_length": context_length,
        "capabilities": _infer_capabilities(model_name, families),
    }


@router.post("/ollama/pull")
async def pull_ollama_model(
    body: dict,
    _admin: User = Depends(require_admin),
):
    """
    Proxy POST /api/pull to Ollama and stream progress as NDJSON.
    body: {"name": "llama3.2"}
    Streams: {"status": "pulling manifest"} ... {"status": "success"}
    """
    model_name = body.get("name", "").strip()
    if not model_name:
        raise HTTPException(400, "model name required")

    ollama_url = settings.OLLAMA_URL

    async def _stream():
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{ollama_url}/api/pull",
                    json={"name": model_name, "stream": True},
                ) as r:
                    async for line in r.aiter_lines():
                        if line:
                            yield line + "\n"
        except Exception as e:
            yield json.dumps({"error": str(e)}) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


@router.delete("/ollama/models/{model_name:path}", status_code=204)
async def delete_ollama_model(
    model_name: str,
    _admin: User = Depends(require_admin),
):
    """Proxy DELETE /api/delete to Ollama."""
    ollama_url = settings.OLLAMA_URL
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.delete(
                f"{ollama_url}/api/delete",
                json={"name": model_name},
            )
            if r.status_code == 404:
                raise HTTPException(404, "Model not found")
            r.raise_for_status()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Ollama unreachable")


# ── 시스템 설정 헬퍼 ─────────────────────────────────────────────────────────────

async def _get_settings_row(db: AsyncSession) -> SystemSettings:
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    row = result.scalar_one_or_none()
    if row is None:
        row = SystemSettings(id=1, data=json.dumps(DEFAULT_SETTINGS))
        db.add(row)
        await db.flush()
    return row


def _parse_settings(row: SystemSettings) -> dict:
    try:
        data = json.loads(row.data)
    except Exception:
        data = {}
    # Deep merge with defaults to handle missing keys from older schemas
    merged: dict = {}
    for section, defaults in DEFAULT_SETTINGS.items():
        merged[section] = {**defaults, **(data.get(section) or {})}
    return merged


def _deep_merge(base: dict, patch: dict) -> dict:
    result = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


# ── GET /models (인증 유저) ───────────────────────────────────────────────────────

@router.get("/models")
async def list_enabled_models(
    _user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    시스템 설정의 활성화된 모델 목록 반환.
    Ollama는 설정된 URL로 live query.
    """
    row = await _get_settings_row(db)
    data = _parse_settings(row)
    models_cfg = data.get("models", {})
    connections = data.get("connections", {})

    result = []

    # OpenAI
    for mid in models_cfg.get("openai_enabled", []):
        result.append({"id": mid, "name": mid, "provider": "OpenAI"})

    # Anthropic
    for mid in models_cfg.get("anthropic_enabled", []):
        result.append({"id": mid, "name": mid, "provider": "Anthropic"})

    # Google
    for mid in models_cfg.get("google_enabled", []):
        result.append({"id": mid, "name": mid, "provider": "Google"})

    # Ollama — live query
    ollama_url = connections.get("ollama_url", "") or settings.OLLAMA_URL
    if ollama_url:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"{ollama_url}/api/tags")
                r.raise_for_status()
            raw = r.json()
            enabled_ollama = set(models_cfg.get("ollama_enabled", []))
            for m in raw.get("models", []):
                name = m["name"]
                # Only include if in ollama_enabled (or if list is empty = all enabled)
                if not enabled_ollama or name in enabled_ollama:
                    result.append({"id": name, "name": name, "provider": "Ollama"})
        except Exception:
            pass  # Ollama unreachable — skip silently

    return result


# ── GET /admin/settings/public (인증 불필요) ─────────────────────────────────────

@router.get("/settings/public")
async def get_public_settings(db: AsyncSession = Depends(get_db)):
    """OAuth 활성화 여부 및 회원가입 허용 여부 반환 (로그인 화면에서 사용)."""
    row = await _get_settings_row(db)
    data = _parse_settings(row)
    oauth = data.get("oauth", {})
    general = data.get("general", {})
    return {
        "google_oauth_enabled": bool(oauth.get("google_enabled", False)),
        "github_oauth_enabled": bool(oauth.get("github_enabled", False)),
        "allow_signup": bool(general.get("allow_signup", True)),
    }


# ── GET /admin/settings (admin only) ────────────────────────────────────────────

@router.get("/settings")
async def get_settings(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """전체 시스템 설정 반환."""
    row = await _get_settings_row(db)
    return _parse_settings(row)


# ── PATCH /admin/settings (admin only) ──────────────────────────────────────────

@router.patch("/settings")
async def patch_settings(
    body: dict,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """시스템 설정 부분 업데이트 (섹션 단위 또는 필드 단위)."""
    row = await _get_settings_row(db)
    current = _parse_settings(row)
    merged = _deep_merge(current, body)
    row.data = json.dumps(merged)
    row.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return merged


# ── GET /admin/ratings (admin only) ─────────────────────────────────────────

@router.get("/ratings", response_model=list[RatingEntryOut])
async def list_ratings(
    rating: Optional[str] = Query(None, description="positive | negative | None(전체)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """평가된 메시지 목록. 어드민 Evaluations 탭에서 사용."""
    q = (
        select(Message, Chat, User)
        .join(Chat, Message.chat_id == Chat.id)
        .join(User, Chat.user_id == User.id)
        .where(Message.rating.isnot(None))
    )
    if rating in ("positive", "negative"):
        q = q.where(Message.rating == rating)
    q = q.order_by(Message.created_at.desc()).offset(skip).limit(limit)

    rows = (await db.execute(q)).all()
    return [
        RatingEntryOut(
            message_id=str(msg.id),
            chat_id=str(chat.id),
            model=chat.model,
            rating=msg.rating,
            message_preview=msg.content[:120],
            user_email=user.email,
            created_at=msg.created_at,
        )
        for msg, chat, user in rows
    ]
