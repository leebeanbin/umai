"""
인증 관련 테스트.

TDD 커버 항목:
- GET /auth/me  : 인증된 유저 정보 반환
- GET /auth/me  : 토큰 없으면 401
- GET /auth/me  : 'Bearer dev' bypass는 항상 401 (보안 정책)
- POST /auth/refresh : 유효한 refresh 토큰으로 갱신
- OAuth 비활성화 시 403 반환
"""
from app.core.security import create_refresh_token
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


async def test_dev_bypass_token_rejected(client, admin_user):
    """'Bearer dev' bypass is forbidden even in DEBUG mode."""
    res = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer dev"})
    assert res.status_code == 401


# ── /auth/refresh ─────────────────────────────────────────────────────────────

async def test_refresh_issues_new_tokens(client, admin_user):
    refresh_token = create_refresh_token(str(admin_user.id))
    await session_set(refresh_token, str(admin_user.id))

    # refresh token은 HttpOnly 쿠키로 전달 (request body 아님)
    res = await client.post(
        "/api/v1/auth/refresh",
        cookies={"umai_refresh": refresh_token},
    )
    assert res.status_code == 200
    body = res.json()
    assert "access_token" in body
    # 기존 refresh 토큰은 폐기되어야 함
    res2 = await client.post(
        "/api/v1/auth/refresh",
        cookies={"umai_refresh": refresh_token},
    )
    assert res2.status_code == 401


async def test_refresh_invalid_token(client):
    res = await client.post(
        "/api/v1/auth/refresh",
        cookies={"umai_refresh": "invalid-token"},
    )
    assert res.status_code == 401


# ── OAuth disabled / enabled ─────────────────────────────────────────────────

async def test_google_oauth_returns_403_when_disabled(client, admin_headers):
    """기본값 google_enabled=False → OAuth 엔드포인트는 403."""
    # public settings 조회로 기본 settings row 생성 유도
    await client.get("/api/v1/admin/settings/public")

    res = await client.get("/api/v1/auth/oauth/google")
    assert res.status_code == 403


async def test_github_oauth_returns_403_when_disabled(client, admin_headers):
    """기본값 github_enabled=False → OAuth 엔드포인트는 403."""
    await client.get("/api/v1/admin/settings/public")

    res = await client.get("/api/v1/auth/oauth/github")
    assert res.status_code == 403


async def test_google_oauth_not_forbidden_when_enabled(client, admin_headers):
    """admin이 google_enabled=True로 변경하면 403이 해제됨."""
    await client.patch(
        "/api/v1/admin/settings",
        headers=admin_headers,
        json={"oauth": {"google_enabled": True}},
    )
    res = await client.get("/api/v1/auth/oauth/google")
    # 403이 아니어야 함 — credentials 없으면 422/500/302 가능
    assert res.status_code != 403


async def test_github_oauth_not_forbidden_when_enabled(client, admin_headers):
    """admin이 github_enabled=True로 변경하면 403이 해제됨."""
    await client.patch(
        "/api/v1/admin/settings",
        headers=admin_headers,
        json={"oauth": {"github_enabled": True}},
    )
    res = await client.get("/api/v1/auth/oauth/github")
    assert res.status_code != 403


async def test_oauth_toggle_round_trip(client, admin_headers):
    """활성화 후 다시 비활성화하면 다시 403."""
    # Enable
    await client.patch(
        "/api/v1/admin/settings",
        headers=admin_headers,
        json={"oauth": {"google_enabled": True}},
    )
    res_enabled = await client.get("/api/v1/auth/oauth/google")
    assert res_enabled.status_code != 403

    # Disable
    await client.patch(
        "/api/v1/admin/settings",
        headers=admin_headers,
        json={"oauth": {"google_enabled": False}},
    )
    res_disabled = await client.get("/api/v1/auth/oauth/google")
    assert res_disabled.status_code == 403
