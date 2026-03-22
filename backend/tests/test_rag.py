"""
RAG 검색 API 테스트.

TDD 커버 항목:
- GET /rag/search : 인증 필요 (401)
- GET /rag/search : 빈 Knowledge Base → 200 + empty results + 안내 메시지
- GET /rag/search : 문서 업로드 후 키워드 검색 → 결과 반환
- GET /rag/search : 검색어 공백 → 422 (min_length=1 검증)
- GET /rag/search : top_k 파라미터 반영 → 결과 수 제한
- GET /rag/search : 유저 격리 — 다른 유저 문서는 검색 불가
- GET /rag/search : 임베딩 없는 문서 → keyword_fallback 방식 사용
"""
import io
import pytest


# ── 인증 ──────────────────────────────────────────────────────────────────────

async def test_rag_search_requires_auth(client):
    res = await client.get("/api/v1/rag/search?q=hello")
    assert res.status_code == 401


# ── 빈 Knowledge Base ─────────────────────────────────────────────────────────

async def test_rag_search_empty_kb(client, admin_headers):
    """Knowledge Base가 비어있으면 results:[] 와 안내 메시지 반환."""
    res = await client.get("/api/v1/rag/search?q=anything", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["results"] == []
    assert "note" in data


# ── 파라미터 검증 ─────────────────────────────────────────────────────────────

async def test_rag_search_empty_query_rejected(client, admin_headers):
    """q 파라미터가 없으면 422."""
    res = await client.get("/api/v1/rag/search", headers=admin_headers)
    assert res.status_code == 422


async def test_rag_search_top_k_limits_results(client, admin_headers):
    """top_k=2 이면 결과가 최대 2개."""
    # 여러 문서 업로드
    for i in range(4):
        await client.post(
            "/api/v1/workspace/knowledge",
            headers=admin_headers,
            files={"file": (f"doc{i}.txt", io.BytesIO(f"python testing framework doc {i}".encode()), "text/plain")},
        )

    res = await client.get("/api/v1/rag/search?q=python&top_k=2", headers=admin_headers)
    assert res.status_code == 200
    assert len(res.json()["results"]) <= 2


# ── 키워드 검색 (임베딩 없는 fallback) ────────────────────────────────────────

async def test_rag_keyword_search_finds_uploaded_doc(client, admin_headers):
    """업로드 문서의 내용이 검색어와 매칭되면 결과에 포함."""
    content = b"The quick brown fox jumps over the lazy dog. FastAPI is awesome."
    await client.post(
        "/api/v1/workspace/knowledge",
        headers=admin_headers,
        files={"file": ("fox.txt", io.BytesIO(content), "text/plain")},
    )

    res = await client.get("/api/v1/rag/search?q=fastapi", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data["results"]) >= 1
    # 키워드 fallback 방식이어야 함 (임베딩 없으므로)
    assert data.get("method") == "keyword_fallback"
    # 결과에 score 필드 존재
    assert "score" in data["results"][0]
    assert "chunk" in data["results"][0]
    assert "source" in data["results"][0]


async def test_rag_search_no_match_returns_empty(client, admin_headers):
    """매칭 없는 검색어는 빈 배열 반환."""
    content = b"Hello world. This is a simple test document."
    await client.post(
        "/api/v1/workspace/knowledge",
        headers=admin_headers,
        files={"file": ("hello.txt", io.BytesIO(content), "text/plain")},
    )

    res = await client.get("/api/v1/rag/search?q=zzzyyyxxx", headers=admin_headers)
    assert res.status_code == 200
    assert res.json()["results"] == []


# ── 유저 격리 ─────────────────────────────────────────────────────────────────

async def test_rag_search_user_isolation(client, admin_headers, user_headers):
    """admin이 업로드한 문서가 regular_user 검색 결과에 나오지 않아야 함."""
    content = b"Secret admin document about quantum computing."
    await client.post(
        "/api/v1/workspace/knowledge",
        headers=admin_headers,
        files={"file": ("secret.txt", io.BytesIO(content), "text/plain")},
    )

    # regular_user로 검색 — admin 문서가 보이면 안 됨
    res = await client.get("/api/v1/rag/search?q=quantum", headers=user_headers)
    assert res.status_code == 200
    data = res.json()
    # 결과가 없거나 (빈 KB) 있어도 admin 문서가 아니어야 함
    sources = [r.get("source", "") for r in data.get("results", [])]
    assert "secret.txt" not in sources
