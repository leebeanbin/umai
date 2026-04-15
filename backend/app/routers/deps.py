"""FastAPI 공통 의존성"""
import asyncio
import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import ErrCode
from app.core.security import get_subject
from app.core.redis import user_cache_get, user_cache_set, access_get
from app.models.user import User

bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not creds:
        ErrCode.NOT_AUTHENTICATED.raise_it()

    # ── Step 0: JWT 형식 조기 거부 (암호화 연산 전, ~1µs) ─────────────────────
    # JWT 는 정확히 header.payload.signature 의 3-파트 구조.
    # 형식이 틀리면 서명 검증 자체가 불가능 → 즉시 거부해 CPU 낭비 방지.
    if creds.credentials.count(".") != 2:
        ErrCode.INVALID_TOKEN.raise_it()

    # ── Step 1: JWT 서명 검증 (변조 여부) ────────────────────────────────────
    user_id = get_subject(creds.credentials)
    if not user_id:
        ErrCode.INVALID_TOKEN.raise_it()

    # ── Step 2 + 3: Redis 검증 & 유저 캐시 조회 (병렬) ───────────────────────
    # access_get: 토큰 유효성 확인 (만료/로그아웃 여부)
    # user_cache_get: 캐시 히트 시 DB 조회 불필요
    redis_uid, cached = await asyncio.gather(
        access_get(creds.credentials),
        user_cache_get(user_id),
    )

    if not redis_uid:
        ErrCode.TOKEN_EXPIRED.raise_it()

    if cached:
        data = json.loads(cached)
        if not data.get("is_active", True):
            ErrCode.USER_SUSPENDED.raise_it()
        data["id"] = uuid.UUID(data["id"])
        return SimpleNamespace(**data)  # type: ignore[return-value]

    # ── Step 4: DB 조회 (캐시 miss) ──────────────────────────────────────────
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        ErrCode.USER_SUSPENDED.raise_it()

    # last_seen_at 갱신 — 캐시 TTL(5분) 주기로 자연스럽게 업데이트됨
    user.last_seen_at = datetime.now(timezone.utc)

    await user_cache_set(user_id, json.dumps({
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "role": user.role,
        "is_active": user.is_active,
        "oauth_provider": user.oauth_provider,
        "is_onboarded": user.is_onboarded,
        "notification_email": user.notification_email,
    }))
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        ErrCode.FORBIDDEN.raise_it()
    return user
