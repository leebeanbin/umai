"""
워크스페이스 API 테스트.

TDD 커버 항목:
- GET/POST/PATCH/DELETE /workspace/items    : CRUD, 유저 격리
- GET/POST/DELETE       /workspace/knowledge : 파일 업로드, 유저 격리
- 지원하지 않는 파일 타입 → 415
"""
import io
import pytest


# ── /workspace/items ──────────────────────────────────────────────────────────

async def test_create_workspace_item(client, admin_headers):
    res = await client.post(
        "/api/v1/workspace/items",
        headers=admin_headers,
        json={"item_type": "prompt", "name": "My Prompt", "data": {"text": "Hello"}},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "My Prompt"
    assert data["item_type"] == "prompt"
    assert data["data"] == {"text": "Hello"}


async def test_list_workspace_items(client, admin_headers):
    await client.post(
        "/api/v1/workspace/items",
        headers=admin_headers,
        json={"item_type": "model", "name": "Custom Model"},
    )
    res = await client.get("/api/v1/workspace/items", headers=admin_headers)
    assert res.status_code == 200
    assert isinstance(res.json(), list)
    assert len(res.json()) >= 1


async def test_list_workspace_items_user_isolation(client, admin_headers, user_headers):
    """admin의 아이템이 regular_user 목록에 보이지 않아야 한다."""
    await client.post(
        "/api/v1/workspace/items",
        headers=admin_headers,
        json={"item_type": "prompt", "name": "Admin Only"},
    )
    res = await client.get("/api/v1/workspace/items", headers=user_headers)
    assert res.status_code == 200
    names = [i["name"] for i in res.json()]
    assert "Admin Only" not in names


async def test_filter_workspace_items_by_type(client, admin_headers):
    await client.post(
        "/api/v1/workspace/items",
        headers=admin_headers,
        json={"item_type": "tool", "name": "My Tool"},
    )
    res = await client.get(
        "/api/v1/workspace/items?item_type=tool", headers=admin_headers
    )
    assert res.status_code == 200
    for item in res.json():
        assert item["item_type"] == "tool"


async def test_update_workspace_item(client, admin_headers):
    create_res = await client.post(
        "/api/v1/workspace/items",
        headers=admin_headers,
        json={"item_type": "prompt", "name": "Old Name"},
    )
    item_id = create_res.json()["id"]

    res = await client.patch(
        f"/api/v1/workspace/items/{item_id}",
        headers=admin_headers,
        json={"name": "New Name", "is_enabled": False},
    )
    assert res.status_code == 200
    assert res.json()["name"] == "New Name"
    assert res.json()["is_enabled"] is False


async def test_update_workspace_item_other_user_404(client, admin_headers, user_headers):
    """다른 유저의 아이템은 수정 불가 (404)."""
    create_res = await client.post(
        "/api/v1/workspace/items",
        headers=admin_headers,
        json={"item_type": "prompt", "name": "Admin Item"},
    )
    item_id = create_res.json()["id"]

    res = await client.patch(
        f"/api/v1/workspace/items/{item_id}",
        headers=user_headers,
        json={"name": "Hack"},
    )
    assert res.status_code == 404


async def test_delete_workspace_item(client, admin_headers):
    create_res = await client.post(
        "/api/v1/workspace/items",
        headers=admin_headers,
        json={"item_type": "skill", "name": "Temp Skill"},
    )
    item_id = create_res.json()["id"]

    res = await client.delete(
        f"/api/v1/workspace/items/{item_id}", headers=admin_headers
    )
    assert res.status_code == 204


async def test_workspace_requires_auth(client):
    res = await client.get("/api/v1/workspace/items")
    assert res.status_code == 401


# ── /workspace/knowledge ──────────────────────────────────────────────────────

async def test_upload_text_knowledge(client, admin_headers):
    file_content = b"This is a test document."
    res = await client.post(
        "/api/v1/workspace/knowledge",
        headers=admin_headers,
        files={"file": ("test.txt", io.BytesIO(file_content), "text/plain")},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "test.txt"
    assert data["content_type"] == "text/plain"
    assert data["file_size"] == len(file_content)


async def test_upload_markdown_knowledge(client, admin_headers):
    content = b"# Title\n\nSome markdown content."
    res = await client.post(
        "/api/v1/workspace/knowledge",
        headers=admin_headers,
        files={"file": ("README.md", io.BytesIO(content), "text/markdown")},
    )
    assert res.status_code == 201
    assert res.json()["content_type"] == "text/markdown"


async def test_upload_unsupported_file_type_returns_415(client, admin_headers):
    res = await client.post(
        "/api/v1/workspace/knowledge",
        headers=admin_headers,
        files={"file": ("image.png", io.BytesIO(b"\x89PNG"), "image/png")},
    )
    assert res.status_code == 415


async def test_list_knowledge(client, admin_headers):
    await client.post(
        "/api/v1/workspace/knowledge",
        headers=admin_headers,
        files={"file": ("doc.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    res = await client.get("/api/v1/workspace/knowledge", headers=admin_headers)
    assert res.status_code == 200
    assert len(res.json()) >= 1


async def test_knowledge_user_isolation(client, admin_headers, user_headers):
    """admin의 knowledge가 user 목록에 보이지 않아야 한다."""
    await client.post(
        "/api/v1/workspace/knowledge",
        headers=admin_headers,
        files={"file": ("secret.txt", io.BytesIO(b"admin only"), "text/plain")},
    )
    res = await client.get("/api/v1/workspace/knowledge", headers=user_headers)
    assert res.status_code == 200
    names = [k["name"] for k in res.json()]
    assert "secret.txt" not in names


async def test_delete_knowledge(client, admin_headers):
    upload = await client.post(
        "/api/v1/workspace/knowledge",
        headers=admin_headers,
        files={"file": ("todelete.txt", io.BytesIO(b"bye"), "text/plain")},
    )
    item_id = upload.json()["id"]
    res = await client.delete(
        f"/api/v1/workspace/knowledge/{item_id}", headers=admin_headers
    )
    assert res.status_code == 204


async def test_delete_knowledge_other_user_404(client, admin_headers, user_headers):
    upload = await client.post(
        "/api/v1/workspace/knowledge",
        headers=admin_headers,
        files={"file": ("admin.txt", io.BytesIO(b"data"), "text/plain")},
    )
    item_id = upload.json()["id"]
    res = await client.delete(
        f"/api/v1/workspace/knowledge/{item_id}", headers=user_headers
    )
    assert res.status_code == 404
