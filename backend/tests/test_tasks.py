"""
Tasks API 테스트 — 문서 텍스트 추출.

TDD 커버 항목:
- POST /tasks/documents/extract : 인증 필요 (401)
- POST /tasks/documents/extract : TXT 파일 → 200 + text 반환
- POST /tasks/documents/extract : MD 파일 → 200 + text 반환
- POST /tasks/documents/extract : 지원하지 않는 타입 (image/png) → 400
- POST /tasks/documents/extract : max_chars 초과 시 잘림 (truncated=True)
- POST /tasks/documents/extract : first_pages 모드 파라미터 전달
- POST /tasks/documents/extract : 빈 텍스트 파일 → 200 (char_count=0)
- POST /tasks/documents/extract : 응답 구조 검증 (text, char_count, filename, mode, truncated)
"""
import io
import pytest


# ── 인증 ──────────────────────────────────────────────────────────────────────

async def test_extract_requires_auth(client):
    res = await client.post(
        "/api/v1/tasks/documents/extract",
        files={"file": ("test.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert res.status_code == 401


# ── TXT 추출 ──────────────────────────────────────────────────────────────────

async def test_extract_txt_returns_text(client, admin_headers):
    content = b"Hello, this is a plain text document for testing."
    res = await client.post(
        "/api/v1/tasks/documents/extract",
        headers=admin_headers,
        files={"file": ("sample.txt", io.BytesIO(content), "text/plain")},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["text"] == content.decode()
    assert data["filename"] == "sample.txt"
    assert data["char_count"] == len(content)
    assert data["mode"] == "full"
    assert data["truncated"] is False


# ── Markdown 추출 ─────────────────────────────────────────────────────────────

async def test_extract_markdown_returns_text(client, admin_headers):
    content = b"# Title\n\nSome **markdown** content with [links](https://example.com)."
    res = await client.post(
        "/api/v1/tasks/documents/extract",
        headers=admin_headers,
        files={"file": ("README.md", io.BytesIO(content), "text/markdown")},
    )
    assert res.status_code == 200
    data = res.json()
    assert "# Title" in data["text"]
    assert data["filename"] == "README.md"
    assert data["truncated"] is False


# ── 응답 구조 ─────────────────────────────────────────────────────────────────

async def test_extract_response_has_required_fields(client, admin_headers):
    """응답에 필수 필드가 모두 있어야 함."""
    res = await client.post(
        "/api/v1/tasks/documents/extract",
        headers=admin_headers,
        files={"file": ("doc.txt", io.BytesIO(b"test content"), "text/plain")},
    )
    assert res.status_code == 200
    data = res.json()
    for field in ("text", "char_count", "page_count", "filename", "mode", "truncated"):
        assert field in data, f"Missing field: {field}"


# ── 비지원 파일 타입 ──────────────────────────────────────────────────────────

async def test_extract_unsupported_type_returns_400(client, admin_headers):
    """image/png은 지원하지 않으므로 400."""
    res = await client.post(
        "/api/v1/tasks/documents/extract",
        headers=admin_headers,
        files={"file": ("photo.png", io.BytesIO(b"\x89PNG\r\n\x1a\n"), "image/png")},
    )
    assert res.status_code == 400


# ── max_chars 트런케이션 ──────────────────────────────────────────────────────

async def test_extract_truncates_at_max_chars(client, admin_headers):
    """max_chars=10 이면 텍스트가 10자로 잘리고 truncated=True."""
    long_content = b"A" * 500
    res = await client.post(
        "/api/v1/tasks/documents/extract",
        headers=admin_headers,
        data={"max_chars": "10"},
        files={"file": ("long.txt", io.BytesIO(long_content), "text/plain")},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["char_count"] == 10
    assert data["truncated"] is True
    assert data["text"] == "A" * 10


async def test_extract_no_truncation_within_limit(client, admin_headers):
    """내용이 max_chars 이하이면 truncated=False."""
    content = b"Short text."
    res = await client.post(
        "/api/v1/tasks/documents/extract",
        headers=admin_headers,
        data={"max_chars": "1000"},
        files={"file": ("short.txt", io.BytesIO(content), "text/plain")},
    )
    assert res.status_code == 200
    assert res.json()["truncated"] is False


# ── first_pages 모드 ──────────────────────────────────────────────────────────

async def test_extract_first_pages_mode_accepted(client, admin_headers):
    """first_pages 모드로 TXT 파일 추출 시 mode 필드가 반환됨."""
    content = b"Line 1\nLine 2\nLine 3\n"
    res = await client.post(
        "/api/v1/tasks/documents/extract",
        headers=admin_headers,
        data={"mode": "first_pages", "pages": "2"},
        files={"file": ("multiline.txt", io.BytesIO(content), "text/plain")},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["mode"] == "first_pages"
    # TXT는 페이지 없으므로 page_count는 None
    assert data["page_count"] is None


# ── 빈 파일 ──────────────────────────────────────────────────────────────────

async def test_extract_empty_file(client, admin_headers):
    """빈 파일은 text=""로 반환."""
    res = await client.post(
        "/api/v1/tasks/documents/extract",
        headers=admin_headers,
        files={"file": ("empty.txt", io.BytesIO(b""), "text/plain")},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["text"] == ""
    assert data["char_count"] == 0
    assert data["truncated"] is False
