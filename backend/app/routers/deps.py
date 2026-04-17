"""
FastAPI 공통 의존성 — 인증 미들웨어 및 권한 검사.

## 인증 파이프라인 (get_current_user)

요청당 최대 4단계를 거쳐 현재 유저를 결정한다:

```
Step 0: JWT 형식 검사 (3-part, header.payload.sig)   ~1µs
Step 1: JWT 서명 검증 (HMAC-SHA256)                  ~100µs
Step 2: Redis 토큰 유효성 확인 (만료/로그아웃 여부)   ~1ms
Step 3: Redis 유저 캐시 조회 (DB N+1 방지)            ~1ms   ← Step 2와 병렬
Step 4: PostgreSQL 조회 (캐시 miss 시만)              ~5ms
```

Step 2+3은 `asyncio.gather`로 병렬 실행 → 왕복 2번 대신 1번.
캐시 히트율이 95%+ 이면 대부분 요청이 DB 없이 처리된다.

## 토큰 폐기 방식

JWT는 서명 검증만으로는 발급 후 무효화가 불가능하다 (상태가 없으므로).
모든 액세스 토큰을 Redis에 등록하고 인증 미들웨어에서 Redis를 확인한다:
  - 로그아웃 시 `access_del(token)` → 즉시 폐기, 15분 대기 불필요
  - refresh 시 새 토큰 등록, 기존은 15분 후 자동 만료

## DEBUG 전용: 'Bearer dev' 토큰

DEBUG=True 환경에서 `Authorization: Bearer dev` 헤더를 보내면 첫 번째
admin 유저로 자동 인증된다. 로컬 개발 및 통합 테스트에서 로그인 절차를
생략할 수 있게 해 준다. 프로덕션(DEBUG=False)에서는 이 경로가 비활성화된다.
"""
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
from app.core.redis import user_cache_get, user_cache_set, access_get, dau_add
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
        # DAU HyperLogLog 기록 (캐시 히트 경로 — fire-and-forget)
        _today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        asyncio.ensure_future(dau_add(user_id, _today))
        return SimpleNamespace(**data)  # type: ignore[return-value]

    # ── Step 4: DB 조회 (캐시 miss) ──────────────────────────────────────────
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        ErrCode.USER_SUSPENDED.raise_it()

    # last_seen_at 갱신 — 캐시 TTL(5분) 주기로 자연스럽게 업데이트됨
    user.last_seen_at = datetime.now(timezone.utc)

    # DAU HyperLogLog 기록 (DB 조회 경로 — fire-and-forget)
    _today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    asyncio.ensure_future(dau_add(user_id, _today))

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
