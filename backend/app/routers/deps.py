"""FastAPI 공통 의존성"""
import json
import uuid
from types import SimpleNamespace
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_subject
from app.core.redis import user_cache_get, user_cache_set
from app.models.user import User

bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    user_id = get_subject(creds.credentials)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    # ── Redis 캐시에서 먼저 조회 (DB hit 방지) ───────────────────────────────
    cached = await user_cache_get(user_id)
    if cached:
        data = json.loads(cached)
        if not data.get("is_active", True):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User suspended")
        # UUID 문자열 → uuid.UUID 복원 (SQLAlchemy 쿼리 파라미터 호환)
        data["id"] = uuid.UUID(data["id"])
        return SimpleNamespace(**data)  # type: ignore[return-value]

    # ── DB 조회 (캐시 miss) ──────────────────────────────────────────────────
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or suspended")

    # 캐시에 저장 (직렬화: id는 str로)
    payload = {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "role": user.role,
        "is_active": user.is_active,
        "oauth_provider": user.oauth_provider,
        "is_onboarded": user.is_onboarded,
        "notification_email": user.notification_email,
    }
    await user_cache_set(user_id, json.dumps(payload))
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user
