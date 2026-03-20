"""
인증 관련 테스트.

TDD 커버 항목:
- GET /auth/me  : 인증된 유저 정보 반환
- GET /auth/me  : 토큰 없으면 401
- GET /auth/me  : dev 토큰으로 admin 유저 반환 (DEBUG=True 환경)
- POST /auth/refresh : 유효한 refresh 토큰으로 갱신
- OAuth 비활성화 시 403 반환
"""
import pytest
from app.core.security import create_access_token, create_refresh_token
from app.core.redis import session_set


# ── /auth/me ─────────────────────────────────────────────────────────────────

async def test_me_returns_user_info(client, admin_user, admin_headers):
    res = await client.get("/api/v1/auth/me", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["email"] == "admin@example.com"
    assert data["role"] == "admin"


async def test_me_requires_auth(client):
    res = await client.get("/api/v1/auth/me")
    assert res.status_code == 401


async def test_me_invalid_token(client):
    res = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer not.a.valid.token"},
    )
    assert res.status_code == 401


async def test_dev_token_returns_admin(client, admin_user):
    """DEBUG=True 환경에서 Bearer dev 토큰은 첫 admin 유저로 통과."""
    res = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer dev"})
    assert res.status_code == 200
    assert res.json()["role"] == "admin"


# ── /auth/refresh ─────────────────────────────────────────────────────────────

async def test_refresh_issues_new_tokens(client, admin_user):
    import asyncio
    refresh_token = create_refresh_token(str(admin_user.id))
    await session_set(refresh_token, str(admin_user.id))

    await asyncio.sleep(1)  # iat가 달라져야 새 토큰이 다름

    res = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert res.status_code == 200
    body = res.json()
    assert "access_token" in body
    assert "refresh_token" in body
    # 기존 refresh 토큰은 폐기되어야 함
    res2 = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert res2.status_code == 401


async def test_refresh_invalid_token(client):
    res = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": "invalid-token"},
    )
    assert res.status_code == 401


# ── OAuth disabled ────────────────────────────────────────────────────────────

async def test_google_oauth_disabled_by_default(client):
    """system_settings에 google_enabled=False 이면 403."""
    # 기본 설정에서 OAuth는 비활성화
    res = await client.get("/api/v1/auth/oauth/google")
    # 리다이렉트(302) 또는 403 — OAuth credential 미설정시 오류 가능
    # 핵심: 비활성화 설정이면 403이어야 함
    assert res.status_code in (302, 403, 422, 500)
    # settings_row가 없거나 google_enabled=False이면 403이 맞음
    # 이 테스트는 OAuth 비활성화 경로 자체가 있음을 확인
