"""
채팅 API 테스트.

TDD 커버 항목:
- POST   /chats           : 생성 201, 401 미인증
- GET    /chats           : 목록 200, 내 채팅만 반환
- GET    /chats/{id}      : 상세 200, 메시지 포함, 403 비멤버
- PATCH  /chats/{id}      : 수정 200, 403 비오너
- DELETE /chats/{id}      : 삭제 204 + 404, 403 비오너
- POST   /chats/{id}/messages : 추가 201, editor 가능, viewer 403
- GET    /chats/{id}/export   : Markdown 반환
- GET    /chats/{id}/members  : 멤버 목록
- POST   /chats/{id}/members  : 초대 201, 중복 409, 자기자신 400
- PATCH  /chats/{id}/members/{uid} : 역할 변경, owner 변경 불가
- DELETE /chats/{id}/members/{uid} : 추방, owner 추방 불가
"""
import pytest
from app.models.user import User


# ── 헬퍼 픽스처 ──────────────────────────────────────────────────────────────

@pytest.fixture
async def chat(client, admin_headers):
    """admin_user 소유의 채팅 하나 생성."""
    res = await client.post(
        "/api/v1/chats",
        headers=admin_headers,
        json={"title": "Test Chat", "model": "gpt-4o"},
    )
    assert res.status_code == 201
    return res.json()


@pytest.fixture
async def editor_user(db):
    u = User(email="editor@test.local", name="Editor",
             role="user", is_active=True, is_onboarded=True)
    db.add(u)
    await db.flush()
    return u


# ── POST /chats ───────────────────────────────────────────────────────────────

async def test_create_chat_returns_201(client, admin_headers):
    res = await client.post(
        "/api/v1/chats",
        headers=admin_headers,
        json={"title": "My Chat", "model": "gpt-4o"},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["title"] == "My Chat"
    assert data["my_role"] == "owner"


async def test_create_chat_requires_auth(client):
    res = await client.post("/api/v1/chats", json={"title": "x"})
    assert res.status_code == 401


# ── GET /chats ────────────────────────────────────────────────────────────────

async def test_list_chats_returns_own_chats(client, admin_headers, chat):
    res = await client.get("/api/v1/chats", headers=admin_headers)
    assert res.status_code == 200
    ids = [c["id"] for c in res.json()]
    assert chat["id"] in ids


async def test_list_chats_excludes_others_chats(client, user_headers, chat):
    """regular_user는 admin의 채팅을 볼 수 없다."""
    res = await client.get("/api/v1/chats", headers=user_headers)
    assert res.status_code == 200
    ids = [c["id"] for c in res.json()]
    assert chat["id"] not in ids


# ── GET /chats/{id} ───────────────────────────────────────────────────────────

async def test_get_chat_returns_detail(client, admin_headers, chat):
    res = await client.get(f"/api/v1/chats/{chat['id']}", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == chat["id"]
    assert "messages" in data


async def test_get_chat_forbidden_for_non_member(client, user_headers, chat):
    res = await client.get(f"/api/v1/chats/{chat['id']}", headers=user_headers)
    assert res.status_code == 403


async def test_get_chat_not_found(client, admin_headers):
    res = await client.get(
        "/api/v1/chats/00000000-0000-0000-0000-000000000000",
        headers=admin_headers,
    )
    assert res.status_code == 404


# ── PATCH /chats/{id} ────────────────────────────────────────────────────────

async def test_update_chat_title(client, admin_headers, chat):
    res = await client.patch(
        f"/api/v1/chats/{chat['id']}",
        headers=admin_headers,
        json={"title": "Updated Title"},
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Updated Title"


async def test_update_chat_forbidden_for_non_owner(client, user_headers, chat):
    res = await client.patch(
        f"/api/v1/chats/{chat['id']}",
        headers=user_headers,
        json={"title": "Hack"},
    )
    assert res.status_code == 403


# ── DELETE /chats/{id} ───────────────────────────────────────────────────────

async def test_delete_chat(client, admin_headers, chat):
    res = await client.delete(f"/api/v1/chats/{chat['id']}", headers=admin_headers)
    assert res.status_code == 204

    res2 = await client.get(f"/api/v1/chats/{chat['id']}", headers=admin_headers)
    assert res2.status_code == 404


async def test_delete_chat_forbidden_for_non_owner(client, user_headers, chat):
    res = await client.delete(f"/api/v1/chats/{chat['id']}", headers=user_headers)
    assert res.status_code == 403


# ── POST /chats/{id}/messages ─────────────────────────────────────────────────

async def test_add_message(client, admin_headers, chat):
    res = await client.post(
        f"/api/v1/chats/{chat['id']}/messages",
        headers=admin_headers,
        json={"role": "user", "content": "Hello"},
    )
    assert res.status_code == 201
    assert "id" in res.json()


async def test_add_message_viewer_forbidden(client, admin_headers, user_headers, chat, regular_user):
    """viewer 역할은 메시지 추가 불가."""
    # viewer로 초대
    await client.post(
        f"/api/v1/chats/{chat['id']}/members",
        headers=admin_headers,
        json={"email": regular_user.email, "role": "viewer"},
    )
    res = await client.post(
        f"/api/v1/chats/{chat['id']}/messages",
        headers=user_headers,
        json={"role": "user", "content": "I should not be able to do this"},
    )
    assert res.status_code == 403


# ── GET /chats/{id}/export ────────────────────────────────────────────────────

async def test_export_chat_returns_markdown(client, admin_headers, chat):
    # 메시지 추가 후 export
    await client.post(
        f"/api/v1/chats/{chat['id']}/messages",
        headers=admin_headers,
        json={"role": "user", "content": "Hi"},
    )
    res = await client.get(f"/api/v1/chats/{chat['id']}/export", headers=admin_headers)
    assert res.status_code == 200
    assert "Test Chat" in res.text
    assert "Hi" in res.text


# ── GET /chats/{id}/members ───────────────────────────────────────────────────

async def test_list_members_includes_owner(client, admin_headers, admin_user, chat):
    res = await client.get(f"/api/v1/chats/{chat['id']}/members", headers=admin_headers)
    assert res.status_code == 200
    members = res.json()
    roles = {m["role"] for m in members}
    assert "owner" in roles


# ── POST /chats/{id}/members ──────────────────────────────────────────────────

async def test_invite_member(client, admin_headers, user_headers, chat, regular_user):
    res = await client.post(
        f"/api/v1/chats/{chat['id']}/members",
        headers=admin_headers,
        json={"email": regular_user.email, "role": "editor"},
    )
    assert res.status_code == 201
    assert res.json()["role"] == "editor"

    # 초대된 유저가 채팅에 접근 가능
    res2 = await client.get(f"/api/v1/chats/{chat['id']}", headers=user_headers)
    assert res2.status_code == 200


async def test_invite_duplicate_member_returns_409(client, admin_headers, chat, regular_user):
    await client.post(
        f"/api/v1/chats/{chat['id']}/members",
        headers=admin_headers,
        json={"email": regular_user.email, "role": "editor"},
    )
    res = await client.post(
        f"/api/v1/chats/{chat['id']}/members",
        headers=admin_headers,
        json={"email": regular_user.email, "role": "editor"},
    )
    assert res.status_code == 409


async def test_invite_self_returns_400(client, admin_headers, admin_user, chat):
    res = await client.post(
        f"/api/v1/chats/{chat['id']}/members",
        headers=admin_headers,
        json={"email": admin_user.email, "role": "editor"},
    )
    assert res.status_code == 400


async def test_invite_nonexistent_user_returns_404(client, admin_headers, chat):
    res = await client.post(
        f"/api/v1/chats/{chat['id']}/members",
        headers=admin_headers,
        json={"email": "nobody@nowhere.com", "role": "editor"},
    )
    assert res.status_code == 404


# ── PATCH /chats/{id}/members/{uid} ──────────────────────────────────────────

async def test_update_member_role(client, admin_headers, chat, regular_user):
    await client.post(
        f"/api/v1/chats/{chat['id']}/members",
        headers=admin_headers,
        json={"email": regular_user.email, "role": "editor"},
    )
    res = await client.patch(
        f"/api/v1/chats/{chat['id']}/members/{regular_user.id}",
        headers=admin_headers,
        json={"role": "viewer"},
    )
    assert res.status_code == 200
    assert res.json()["role"] == "viewer"


async def test_cannot_assign_owner_role(client, admin_headers, chat, regular_user):
    await client.post(
        f"/api/v1/chats/{chat['id']}/members",
        headers=admin_headers,
        json={"email": regular_user.email, "role": "editor"},
    )
    res = await client.patch(
        f"/api/v1/chats/{chat['id']}/members/{regular_user.id}",
        headers=admin_headers,
        json={"role": "owner"},
    )
    assert res.status_code == 400


# ── DELETE /chats/{id}/members/{uid} ─────────────────────────────────────────

async def test_remove_member(client, admin_headers, user_headers, chat, regular_user):
    await client.post(
        f"/api/v1/chats/{chat['id']}/members",
        headers=admin_headers,
        json={"email": regular_user.email, "role": "editor"},
    )
    res = await client.delete(
        f"/api/v1/chats/{chat['id']}/members/{regular_user.id}",
        headers=admin_headers,
    )
    assert res.status_code == 204

    # 추방 후 접근 불가
    res2 = await client.get(f"/api/v1/chats/{chat['id']}", headers=user_headers)
    assert res2.status_code == 403


async def test_cannot_remove_owner(client, admin_headers, admin_user, chat):
    res = await client.delete(
        f"/api/v1/chats/{chat['id']}/members/{admin_user.id}",
        headers=admin_headers,
    )
    assert res.status_code == 400
