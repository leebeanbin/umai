"""
인증 서비스 — OAuth 유저 프로비저닝, 토큰 생성.

라우터에서 분리된 비즈니스 로직:
- OAuth 유저 조회/생성 (provider + sub 기준)
- 이메일로 기존 계정 연결
- 첫 번째 유저 자동 admin 승격
- IntegrityError → 409 HTTP 예외 (동시 요청 레이스 처리)
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ErrCode
from app.core.redis import session_set, access_set, user_cache_del
from app.core.security import create_access_token, create_refresh_token
from app.models.user import User
from app.schemas.auth import TokenResponse


async def get_or_create_oauth_user(
    db: AsyncSession,
    *,
    provider: str,
    sub: str,
    email: str,
    name: str,
    avatar_url: str | None,
) -> User:
    """
    OAuth 로그인 시 유저를 조회하거나 신규 생성한다.

    우선순위:
    1. 동일 provider + sub 계정 존재 → 반환
    2. 동일 이메일 계정 존재 → provider 연결 후 반환
    3. 신규 계정 생성 (첫 번째 유저이면 admin 승격)

    동시 요청 레이스: DB UniqueConstraint 위반 → 409 반환.
    """
    # 1. 동일 OAuth 계정 조회
    result = await db.execute(
        select(User).where(User.oauth_provider == provider, User.oauth_sub == sub)
    )
    user = result.scalar_one_or_none()
    if user:
        return user

    # 2. 동일 이메일로 기존 계정 연결
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        if user.oauth_provider and user.oauth_provider != provider:
            ErrCode.OAUTH_CONFLICT.raise_it(
                f"이 이메일은 {user.oauth_provider} 계정으로 이미 연결되어 있습니다."
            )
        user.oauth_provider = provider
        user.oauth_sub = sub
        if avatar_url and not user.avatar_url:
            user.avatar_url = avatar_url
        await user_cache_del(str(user.id))
        return user

    # 3. 신규 계정 생성
    count_result = await db.execute(select(func.count()).select_from(User))
    is_first_user = count_result.scalar_one() == 0

    user = User(
        email=email,
        name=name,
        avatar_url=avatar_url,
        oauth_provider=provider,
        oauth_sub=sub,
        role="admin" if is_first_user else "user",
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        # 동시 요청이 먼저 삽입한 경우 — 재조회
        result = await db.execute(
            select(User).where(User.oauth_provider == provider, User.oauth_sub == sub)
        )
        user = result.scalar_one_or_none()
        if user:
            return user
        ErrCode.CREATE_CONFLICT.raise_it()
    return user


async def make_tokens(user_id: str) -> TokenResponse:
    """
    액세스 + 리프레시 토큰 쌍 생성 및 Redis 등록.

    두 토큰 모두 Redis에 등록된다:
    - access:{token}  → user_id  (TTL 15분, 인증 미들웨어가 매 요청마다 확인)
    - session:{token} → user_id  (TTL 30일, refresh 엔드포인트가 확인)

    로그아웃 시 access 토큰을 즉시 삭제하면 15분 만료 전에도 바로 무효화된다.
    """
    tokens = TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )
    # 두 토큰 동시 등록 (순서 무관, 독립적인 Redis 키)
    await session_set(tokens.refresh_token, user_id)
    await access_set(tokens.access_token, user_id)
    return tokens
