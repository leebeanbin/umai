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
from urllib.parse import urlparse
from pydantic import BaseModel, Field, field_validator
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.responses import RedirectResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from authlib.integrations.starlette_client import OAuth, OAuthError

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import ErrCode
from app.models.settings import SystemSettings
from app.core.redis import (
    session_get, session_del,
    access_del,
    user_cache_del, oauth_code_set, oauth_code_pop,
    oauth_origin_set, oauth_origin_pop,
)
from app.models.user import User
from fastapi.responses import JSONResponse
from app.schemas.auth import (
    TokenResponse, AccessTokenResponse, UserOut, OnboardRequest,
)
from app.routers.deps import get_current_user
from app.services.auth_service import get_or_create_oauth_user, make_tokens

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)
bearer = HTTPBearer(auto_error=False)
_DEV_TOKEN = "dev"

# ── Refresh-token 쿠키 설정 ───────────────────────────────────────────────────
REFRESH_COOKIE = "umai_refresh"

def _set_refresh_cookie(response: JSONResponse, token: str) -> None:
    """HttpOnly + Secure(프로덕션) 쿠키로 refresh token 저장."""
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=not settings.DEBUG,   # 개발: http 허용, 프로덕션: https 전용
        samesite="strict",
        max_age=60 * 60 * 24 * 30,  # 30일 (settings.REFRESH_TOKEN_EXPIRE_DAYS 와 동기화)
        path="/",
    )

def _clear_refresh_cookie(response: JSONResponse) -> None:
    response.delete_cookie(key=REFRESH_COOKIE, path="/")


async def _check_oauth_enabled(db: AsyncSession, provider: str) -> None:
    """시스템 설정에서 해당 OAuth provider가 활성화되어 있는지 확인."""
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    row = result.scalar_one_or_none()
    enabled = False
    if row is not None:
        data: dict = row.data or {}
        enabled = data.get("oauth", {}).get(f"{provider}_enabled", False)
    if not enabled:
        ErrCode.OAUTH_DISABLED.raise_it(f"{provider.capitalize()} OAuth is disabled")

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



def _extract_frontend_origin(request: Request) -> str:
    """
    브라우저의 실제 origin을 추출한다.
    Next.js rewrite proxy를 거쳐오므로 X-Forwarded-Host 또는 Referer에서 읽는다.
    개발 환경(localhost)에서만 동적 origin을 허용하고,
    그 외에는 settings.FRONTEND_URL을 fallback으로 사용한다.
    """
    # Next.js가 프록시하면서 X-Forwarded-Host를 설정한다
    forwarded_host = request.headers.get("x-forwarded-host", "")
    forwarded_proto = request.headers.get("x-forwarded-proto", "http")
    if forwarded_host:
        origin = f"{forwarded_proto}://{forwarded_host}"
        if origin.startswith("http://localhost") or origin.startswith("https://localhost"):
            return origin

    # Referer 헤더에서 origin 추출 (내비게이션 요청 시 브라우저가 전송)
    referer = request.headers.get("referer", "")
    if referer:
        parsed = urlparse(referer)
        if parsed.hostname == "localhost":
            port = f":{parsed.port}" if parsed.port else ""
            return f"{parsed.scheme}://{parsed.hostname}{port}"

    return settings.FRONTEND_URL


async def _redirect_with_code(tokens: TokenResponse, frontend_origin: str) -> RedirectResponse:
    """토큰을 URL에 직접 노출하지 않고 5분 one-time 코드로 교환"""
    code = secrets.token_urlsafe(32)
    payload = json.dumps({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
    })
    await oauth_code_set(code, payload)
    return RedirectResponse(f"{frontend_origin}/auth/callback?code={code}")



@router.post("/refresh", response_model=AccessTokenResponse)
@limiter.limit("30/minute")
async def refresh(request: Request):
    """
    refresh token은 HttpOnly 쿠키에서 읽는다 (요청 body에 포함하지 않음).
    Redis rotation: 기존 토큰 폐기 → 새 토큰 쌍 발급 → 새 refresh를 쿠키에 설정.
    """
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No refresh token")

    user_id = await session_get(token)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token")

    # M3: 새 토큰 먼저 생성 → 성공 후 기존 토큰 폐기
    # (기존 순서: delete → create 시 create 실패 → 재로그인 강요)
    new_tokens = await make_tokens(user_id)
    await session_del(token)

    res = JSONResponse({"access_token": new_tokens.access_token, "token_type": "bearer"})
    _set_refresh_cookie(res, new_tokens.refresh_token)
    return res


@router.post("/logout")
async def logout(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    """
    로그아웃.
    - 리프레시 토큰: HttpOnly 쿠키에서 읽어 Redis에서 즉시 삭제
    - 액세스 토큰: Redis에서 즉시 삭제 (15분 만료 전에도 바로 폐기)
    - 쿠키 클리어
    """
    token = request.cookies.get(REFRESH_COOKIE)
    if token:
        await session_del(token)
    if creds and creds.credentials not in (_DEV_TOKEN, ""):
        await access_del(creds.credentials)

    res = JSONResponse({"detail": "Logged out"})
    _clear_refresh_cookie(res)
    return res


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


class UpdateMeRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    notification_email: str | None = Field(None, max_length=254)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip() if v else v


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """현재 유저 프로필 업데이트 (이름, 알림 이메일)."""
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one_or_none()
    if not user:
        ErrCode.USER_NOT_FOUND.raise_it()

    if body.name is not None:
        user.name = body.name.strip()
    if body.notification_email is not None:
        user.notification_email = body.notification_email.strip() or user.email

    await user_cache_del(str(user.id))
    return user


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
        ErrCode.INVALID_NAME.raise_it()

    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one_or_none()
    if not user:
        ErrCode.USER_NOT_FOUND.raise_it()

    user.name = name
    user.notification_email = body.notification_email.strip() or user.email
    user.is_onboarded = True
    await user_cache_del(str(user.id))  # 캐시 무효화 → 다음 /me 요청에서 DB 재조회
    return user


# ── OAuth 코드 교환 (one-time) ────────────────────────────────────────────────

@router.get("/token/exchange", response_model=AccessTokenResponse)
@limiter.limit("10/minute")
async def token_exchange(request: Request, code: str):
    """
    OAuth 콜백 후 프론트엔드가 code를 제출하면 access_token만 응답 body로 반환.
    refresh_token은 HttpOnly 쿠키에 설정 — JS에서 접근 불가.
    5분 내 1회만 사용 가능 (one-time use).
    """
    payload = await oauth_code_pop(code)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired code")
    data = json.loads(payload)

    res = JSONResponse({"access_token": data["access_token"], "token_type": "bearer"})
    _set_refresh_cookie(res, data["refresh_token"])
    return res


# ── OAuth 공통 헬퍼 ───────────────────────────────────────────────────────────

async def _oauth_start(provider: str, oauth_client, request: Request, db: AsyncSession):
    """OAuth 로그인 시작 — provider 활성화 확인 후 provider 인증 페이지로 리다이렉트."""
    await _check_oauth_enabled(db, provider)
    redirect_uri = f"{settings.BACKEND_URL}/api/v1/auth/oauth/{provider}/callback"
    state = secrets.token_urlsafe(16)
    await oauth_origin_set(state, _extract_frontend_origin(request))
    return await oauth_client.authorize_redirect(request, redirect_uri, state=state)


async def _oauth_finish(state: str, user_kwargs: dict, db: AsyncSession):
    """OAuth 콜백 공통 처리 — 유저 조회/생성 후 one-time code로 리다이렉트."""
    frontend_origin = (await oauth_origin_pop(state)) or settings.FRONTEND_URL
    user = await get_or_create_oauth_user(db, **user_kwargs)
    tokens = await make_tokens(str(user.id))
    return await _redirect_with_code(tokens, frontend_origin)


# ── Google OAuth ──────────────────────────────────────────────────────────────

@router.get("/oauth/google")
async def google_login(request: Request, db: AsyncSession = Depends(get_db)):
    return await _oauth_start("google", oauth.google, request, db)


@router.get("/oauth/google/callback")
async def google_callback(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError as e:
        import logging; logging.getLogger(__name__).warning("Google OAuth error: %s", e)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Authentication failed")

    state = request.query_params.get("state")
    if not state:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing OAuth state")

    userinfo = token.get("userinfo") or await oauth.google.userinfo(token=token)
    return await _oauth_finish(
        state=state,
        user_kwargs={
            "provider": "google",
            "sub": userinfo["sub"],
            "email": userinfo["email"],
            "name": userinfo.get("name", ""),
            "avatar_url": userinfo.get("picture"),
        },
        db=db,
    )


# ── GitHub OAuth ──────────────────────────────────────────────────────────────

@router.get("/oauth/github")
async def github_login(request: Request, db: AsyncSession = Depends(get_db)):
    return await _oauth_start("github", oauth.github, request, db)


@router.get("/oauth/github/callback")
async def github_callback(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        token = await oauth.github.authorize_access_token(request)
    except OAuthError as e:
        import logging; logging.getLogger(__name__).warning("GitHub OAuth error: %s", e)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Authentication failed")

    state = request.query_params.get("state")
    if not state:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing OAuth state")

    resp = await oauth.github.get("user", token=token)
    profile = resp.json()

    email = profile.get("email")
    if not email:
        email_resp = await oauth.github.get("user/emails", token=token)
        emails = email_resp.json()
        primary = next((e for e in emails if e.get("primary")), None)
        email = primary["email"] if primary else f"{profile['login']}@github.noemail"

    return await _oauth_finish(
        state=state,
        user_kwargs={
            "provider": "github",
            "sub": str(profile["id"]),
            "email": email,
            "name": profile.get("name") or profile.get("login", ""),
            "avatar_url": profile.get("avatar_url"),
        },
        db=db,
    )
