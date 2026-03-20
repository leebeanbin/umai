"""
Admin API 테스트.

TDD 커버 항목:
- GET  /admin/users    : 200 + UUID 직렬화 올바름 (500 픽스 검증)
- GET  /admin/users    : 일반 유저는 403
- GET  /admin/users    : 미인증은 401
- PATCH/DELETE /admin/users/{id} : role/is_active 변경, 삭제
- GET  /admin/stats    : 숫자 필드 반환
- GET  /admin/settings : 기본값 반환
- PATCH /admin/settings: 부분 업데이트 후 조회 일치
- GET  /admin/settings/public : 인증 없이 접근 가능
- GET  /admin/models   : 인증 유저에게 모델 목록 반환
"""
import pytest
import uuid


# ── /admin/users ──────────────────────────────────────────────────────────────

async def test_list_users_returns_200(client, admin_headers, admin_user, regular_user):
    """핵심 회귀 테스트: UUID 직렬화 버그로 인한 500 재발 방지."""
    res = await client.get("/api/v1/admin/users", headers=admin_headers)
    assert res.status_code == 200
    users = res.json()
    assert isinstance(users, list)
    assert len(users) >= 1
    # id가 유효한 UUID 문자열이어야 함
    for u in users:
        assert uuid.UUID(u["id"])  # 파싱 실패 시 ValueError
        assert "email" in u
        assert "role" in u


async def test_list_users_forbidden_for_regular_user(client, user_headers):
    res = await client.get("/api/v1/admin/users", headers=user_headers)
    assert res.status_code == 403


async def test_list_users_requires_auth(client):
    res = await client.get("/api/v1/admin/users")
    assert res.status_code == 401


async def test_update_user_role(client, admin_headers, regular_user):
    res = await client.patch(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=admin_headers,
        json={"role": "admin"},
    )
    assert res.status_code == 200
    assert res.json()["role"] == "admin"


async def test_update_user_deactivate(client, admin_headers, regular_user):
    res = await client.patch(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=admin_headers,
        json={"is_active": False},
    )
    assert res.status_code == 200
    assert res.json()["is_active"] is False


async def test_admin_cannot_demote_self(client, admin_headers, admin_user):
    res = await client.patch(
        f"/api/v1/admin/users/{admin_user.id}",
        headers=admin_headers,
        json={"role": "user"},
    )
    assert res.status_code == 400


async def test_delete_user(client, admin_headers, regular_user):
    res = await client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=admin_headers,
    )
    assert res.status_code == 204

    # 삭제 후 404
    res2 = await client.get(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=admin_headers,
    )
    assert res2.status_code == 404


async def test_admin_cannot_delete_self(client, admin_headers, admin_user):
    res = await client.delete(
        f"/api/v1/admin/users/{admin_user.id}",
        headers=admin_headers,
    )
    assert res.status_code == 400


# ── /admin/stats ──────────────────────────────────────────────────────────────

async def test_stats_returns_counts(client, admin_headers, admin_user, regular_user):
    res = await client.get("/api/v1/admin/stats", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total_users"] >= 2
    assert "active_users" in data
    assert "total_chats" in data
    assert "new_this_week" in data


# ── /admin/settings ───────────────────────────────────────────────────────────

async def test_get_settings_returns_defaults(client, admin_headers):
    res = await client.get("/api/v1/admin/settings", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "general" in data
    assert "connections" in data
    assert "models" in data
    assert "oauth" in data
    assert "features" in data


async def test_patch_settings_persists(client, admin_headers):
    # 변경
    patch = {"general": {"instance_name": "TDD-Test-Instance"}}
    res = await client.patch("/api/v1/admin/settings", headers=admin_headers, json=patch)
    assert res.status_code == 200
    assert res.json()["general"]["instance_name"] == "TDD-Test-Instance"

    # 다시 조회해서 유지됨을 확인
    res2 = await client.get("/api/v1/admin/settings", headers=admin_headers)
    assert res2.json()["general"]["instance_name"] == "TDD-Test-Instance"


async def test_patch_settings_deep_merge(client, admin_headers):
    """부분 업데이트가 다른 필드를 덮어쓰지 않아야 함."""
    # 먼저 allow_signup 확인
    initial = (await client.get("/api/v1/admin/settings", headers=admin_headers)).json()
    original_signup = initial["general"]["allow_signup"]

    # instance_name만 변경
    await client.patch(
        "/api/v1/admin/settings",
        headers=admin_headers,
        json={"general": {"instance_name": "MergeTest"}},
    )

    updated = (await client.get("/api/v1/admin/settings", headers=admin_headers)).json()
    assert updated["general"]["instance_name"] == "MergeTest"
    # allow_signup은 그대로
    assert updated["general"]["allow_signup"] == original_signup


async def test_public_settings_no_auth(client):
    """인증 없이 public settings 접근 가능."""
    res = await client.get("/api/v1/admin/settings/public")
    assert res.status_code == 200
    data = res.json()
    assert "google_oauth_enabled" in data
    assert "github_oauth_enabled" in data
    assert "allow_signup" in data


async def test_settings_requires_admin(client, user_headers):
    res = await client.get("/api/v1/admin/settings", headers=user_headers)
    assert res.status_code == 403


# ── /admin/models ──────────────────────────────────────────────────────────────

async def test_list_models_returns_list(client, admin_headers):
    """인증 유저에게 모델 목록을 반환한다."""
    res = await client.get("/api/v1/admin/models", headers=admin_headers)
    assert res.status_code == 200
    models = res.json()
    assert isinstance(models, list)
    # 기본 설정에 OpenAI 모델이 있어야 함
    providers = {m["provider"] for m in models}
    assert "OpenAI" in providers or "Anthropic" in providers or "Google" in providers


async def test_list_models_requires_auth(client):
    res = await client.get("/api/v1/admin/models")
    assert res.status_code == 401
