"""
인증 라우터 (소셜 로그인 전용)
- POST /auth/refresh               액세스 토큰 갱신
- POST /auth/logout                로그아웃 (리프레시 토큰 무효화)
- GET  /auth/oauth/google          Google OAuth 시작
- GET  /auth/oauth/google/callback
- GET  /auth/oauth/github          GitHub OAuth 시작
- GET  /auth/oauth/github/callback
- GET  /auth/token/exchange        OAuth 코드 → 토큰 교환 (one-time)
- GET  /auth/me                    현재 유저 정보
"""
import json
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from authlib.integrations.starlette_client import OAuth, OAuthError

from app.core.config import settings
from app.core.database import get_db
from app.core.redis import (
    session_set, session_get, session_del,
    user_cache_del, oauth_code_set, oauth_code_pop,
)
from app.core.security import (
    create_access_token, create_refresh_token,
)
from app.models.user import User
from app.schemas.auth import (
    RefreshRequest, TokenResponse, UserOut, OnboardRequest,
)
from app.routers.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)

# ── OAuth 클라이언트 ──────────────────────────────────────────────────────────

oauth = OAuth()

oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)

oauth.register(
    name="github",
    client_id=settings.GITHUB_CLIENT_ID,
    client_secret=settings.GITHUB_CLIENT_SECRET,
    access_token_url="https://github.com/login/oauth/access_token",
    authorize_url="https://github.com/login/oauth/authorize",
    api_base_url="https://api.github.com/",
    client_kwargs={"scope": "user:email"},
)


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

async def _make_tokens(user_id: str) -> TokenResponse:
    tokens = TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )
    await session_set(tokens.refresh_token, user_id)
    return tokens


async def _get_or_create_oauth_user(
    db: AsyncSession, provider: str, sub: str,
    email: str, name: str, avatar_url: str | None,
) -> User:
    # 동일 provider+sub 계정 조회
    result = await db.execute(
        select(User).where(User.oauth_provider == provider, User.oauth_sub == sub)
    )
    user = result.scalar_one_or_none()
    if user:
        return user

    # 같은 이메일 계정이 있으면 연결 (이미 이메일 소유자가 로그인한 상태이므로 안전)
    # 단, 이메일로 연결할 때 기존 OAuth provider가 이미 있으면 충돌 방지
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        if user.oauth_provider and user.oauth_provider != provider:
            # 다른 소셜 계정이 이미 연결된 경우 → 신규 생성하지 않고 오류
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"이 이메일은 {user.oauth_provider} 계정으로 이미 연결되어 있습니다."
            )
        user.oauth_provider = provider
        user.oauth_sub = sub
        if avatar_url and not user.avatar_url:
            user.avatar_url = avatar_url
        await user_cache_del(str(user.id))  # 캐시 무효화
        return user

    # 신규 유저
    user = User(
        email=email, name=name, avatar_url=avatar_url,
        oauth_provider=provider, oauth_sub=sub,
    )
    db.add(user)
    await db.flush()
    return user


async def _redirect_with_code(tokens: TokenResponse) -> RedirectResponse:
    """토큰을 URL에 직접 노출하지 않고 5분 one-time 코드로 교환"""
    code = secrets.token_urlsafe(32)
    payload = json.dumps({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
    })
    await oauth_code_set(code, payload)
    return RedirectResponse(f"{settings.FRONTEND_URL}/auth/callback?code={code}")


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh(request: Request, body: RefreshRequest):
    # Redis가 source of truth — JWT decode 없이 Redis만 확인
    user_id = await session_get(body.refresh_token)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token")

    await session_del(body.refresh_token)
    return await _make_tokens(user_id)


@router.post("/logout")
async def logout(body: RefreshRequest):
    await session_del(body.refresh_token)
    return {"detail": "Logged out"}


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/onboard", response_model=UserOut)
@limiter.limit("10/minute")
async def onboard(
    request: Request,
    body: OnboardRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """첫 소셜 로그인 후 닉네임 & 알림 이메일 설정"""
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "이름을 입력해주세요.")

    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    user.name = name
    user.notification_email = body.notification_email.strip() or user.email
    user.is_onboarded = True
    await user_cache_del(str(user.id))  # 캐시 무효화 → 다음 /me 요청에서 DB 재조회
    return user


# ── OAuth 코드 교환 (one-time) ────────────────────────────────────────────────

@router.get("/token/exchange", response_model=TokenResponse)
@limiter.limit("10/minute")
async def token_exchange(request: Request, code: str):
    """
    OAuth 콜백 후 프론트엔드가 code를 제출하면 실제 토큰 반환.
    5분 내 1회만 사용 가능 (one-time use).
    """
    payload = await oauth_code_pop(code)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired code")
    data = json.loads(payload)
    return TokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
    )


# ── Google OAuth ──────────────────────────────────────────────────────────────

@router.get("/oauth/google")
async def google_login(request: Request):
    redirect_uri = f"{settings.BACKEND_URL}/api/v1/auth/oauth/google/callback"
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/oauth/google/callback")
async def google_callback(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    userinfo = token.get("userinfo") or await oauth.google.userinfo(token=token)
    user = await _get_or_create_oauth_user(
        db,
        provider="google",
        sub=userinfo["sub"],
        email=userinfo["email"],
        name=userinfo.get("name", ""),
        avatar_url=userinfo.get("picture"),
    )
    tokens = await _make_tokens(str(user.id))
    return await _redirect_with_code(tokens)


# ── GitHub OAuth ──────────────────────────────────────────────────────────────

@router.get("/oauth/github")
async def github_login(request: Request):
    redirect_uri = f"{settings.BACKEND_URL}/api/v1/auth/oauth/github/callback"
    return await oauth.github.authorize_redirect(request, redirect_uri)


@router.get("/oauth/github/callback")
async def github_callback(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        token = await oauth.github.authorize_access_token(request)
    except OAuthError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    resp = await oauth.github.get("user", token=token)
    profile = resp.json()

    email = profile.get("email")
    if not email:
        email_resp = await oauth.github.get("user/emails", token=token)
        emails = email_resp.json()
        primary = next((e for e in emails if e.get("primary")), None)
        email = primary["email"] if primary else f"{profile['login']}@github.noemail"

    user = await _get_or_create_oauth_user(
        db,
        provider="github",
        sub=str(profile["id"]),
        email=email,
        name=profile.get("name") or profile.get("login", ""),
        avatar_url=profile.get("avatar_url"),
    )
    tokens = await _make_tokens(str(user.id))
    return await _redirect_with_code(tokens)
