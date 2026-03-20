"""
폴더 API 테스트.

TDD 커버 항목:
- GET    /folders           : 내 폴더 목록, 401
- POST   /folders           : 생성 201, 필드 반환
- GET    /folders/{id}      : 상세 + 채팅 목록, 403 타인 접근
- PATCH  /folders/{id}      : 수정, 403 타인
- DELETE /folders/{id}      : 삭제 204, 403 타인, 폴더 삭제 후 채팅은 유지 (folder_id=NULL)
"""
import pytest
from app.models.user import User


@pytest.fixture
async def folder(client, admin_headers):
    res = await client.post(
        "/api/v1/folders",
        headers=admin_headers,
        json={"name": "Test Folder", "description": "A test"},
    )
    assert res.status_code == 201
    return res.json()


# ── GET /folders ──────────────────────────────────────────────────────────────

async def test_list_folders_returns_own(client, admin_headers, folder):
    res = await client.get("/api/v1/folders", headers=admin_headers)
    assert res.status_code == 200
    ids = [f["id"] for f in res.json()]
    assert folder["id"] in ids


async def test_list_folders_excludes_others(client, user_headers, folder):
    res = await client.get("/api/v1/folders", headers=user_headers)
    assert res.status_code == 200
    ids = [f["id"] for f in res.json()]
    assert folder["id"] not in ids


async def test_list_folders_requires_auth(client):
    res = await client.get("/api/v1/folders")
    assert res.status_code == 401


# ── POST /folders ─────────────────────────────────────────────────────────────

async def test_create_folder(client, admin_headers):
    res = await client.post(
        "/api/v1/folders",
        headers=admin_headers,
        json={"name": "Work", "system_prompt": "You are a work assistant."},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Work"
    assert data["system_prompt"] == "You are a work assistant."


# ── GET /folders/{id} ─────────────────────────────────────────────────────────

async def test_get_folder_returns_detail(client, admin_headers, folder):
    res = await client.get(f"/api/v1/folders/{folder['id']}", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == folder["id"]
    assert "chats" in data


async def test_get_folder_forbidden_for_other_user(client, user_headers, folder):
    res = await client.get(f"/api/v1/folders/{folder['id']}", headers=user_headers)
    assert res.status_code == 403


async def test_get_folder_includes_chats(client, admin_headers, folder):
    """폴더에 속한 채팅이 상세 응답에 포함된다."""
    # 폴더에 채팅 생성
    await client.post(
        "/api/v1/chats",
        headers=admin_headers,
        json={"title": "Folder Chat", "folder_id": folder["id"]},
    )
    res = await client.get(f"/api/v1/folders/{folder['id']}", headers=admin_headers)
    assert res.status_code == 200
    chat_titles = [c["title"] for c in res.json()["chats"]]
    assert "Folder Chat" in chat_titles


# ── PATCH /folders/{id} ───────────────────────────────────────────────────────

async def test_update_folder(client, admin_headers, folder):
    res = await client.patch(
        f"/api/v1/folders/{folder['id']}",
        headers=admin_headers,
        json={"name": "Renamed Folder"},
    )
    assert res.status_code == 200
    assert res.json()["name"] == "Renamed Folder"


async def test_update_folder_forbidden_for_other(client, user_headers, folder):
    res = await client.patch(
        f"/api/v1/folders/{folder['id']}",
        headers=user_headers,
        json={"name": "Hack"},
    )
    assert res.status_code == 403


# ── DELETE /folders/{id} ──────────────────────────────────────────────────────

async def test_delete_folder(client, admin_headers, folder):
    res = await client.delete(f"/api/v1/folders/{folder['id']}", headers=admin_headers)
    assert res.status_code == 204

    res2 = await client.get(f"/api/v1/folders/{folder['id']}", headers=admin_headers)
    assert res2.status_code == 404


async def test_delete_folder_forbidden_for_other(client, user_headers, folder):
    res = await client.delete(f"/api/v1/folders/{folder['id']}", headers=user_headers)
    assert res.status_code == 403


async def test_delete_folder_preserves_chats(client, admin_headers, folder):
    """폴더 삭제 후 채팅은 사라지지 않고 folder_id=NULL이 된다."""
    # 채팅 생성
    chat_res = await client.post(
        "/api/v1/chats",
        headers=admin_headers,
        json={"title": "Orphan Chat", "folder_id": folder["id"]},
    )
    chat_id = chat_res.json()["id"]

    # 폴더 삭제
    await client.delete(f"/api/v1/folders/{folder['id']}", headers=admin_headers)

    # 채팅은 여전히 존재
    res = await client.get(f"/api/v1/chats/{chat_id}", headers=admin_headers)
    assert res.status_code == 200
    assert res.json()["folder_id"] is None
