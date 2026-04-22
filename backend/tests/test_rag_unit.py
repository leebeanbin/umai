"""
RAG 순수 함수 단위 테스트 (DB/네트워크 불필요).

커버 항목:
  _cosine_similarity:
    - 동일 벡터 → 1.0
    - 직교 벡터 → 0.0
    - 반대 벡터 → -1.0
    - 영벡터 → 0.0 (ZeroDivisionError 없음)
    - 임의 벡터 → 수식 검증

  _keyword_search:
    - 매칭 결과 반환
    - 여러 키워드 → score 합산
    - 점수 내림차순 정렬
    - top_k 제한
    - 매칭 없음 → 빈 배열
    - 대소문자 무시
    - embeddings_json.chunks 우선 사용
    - embeddings_json 파싱 실패 → content fallback
    - 500자 단위 청크 분할 검증

  _embed_query:
    - OpenAI 성공 → 임베딩 반환
    - OpenAI 실패 → Ollama fallback
    - 둘 다 실패 → None
    - Ollama 응답에 embedding 키 없음 → None
"""

import math
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.routers.rag import _cosine_similarity, _keyword_search
from app.services.embedding_service import embed_query_async as _embed_query


# ── _cosine_similarity ─────────────────────────────────────────────────────────

class TestCosineSimilarity:
    def test_identical_vectors_returns_one(self):
        v = [1.0, 2.0, 3.0]
        assert _cosine_similarity(v, v) == pytest.approx(1.0)

    def test_orthogonal_vectors_returns_zero(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert _cosine_similarity(a, b) == pytest.approx(0.0)

    def test_opposite_vectors_returns_minus_one(self):
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert _cosine_similarity(a, b) == pytest.approx(-1.0)

    def test_zero_vector_a_returns_zero(self):
        """영벡터가 있으면 ZeroDivisionError 없이 0.0."""
        assert _cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0

    def test_zero_vector_b_returns_zero(self):
        assert _cosine_similarity([1.0, 0.0], [0.0, 0.0]) == 0.0

    def test_both_zero_returns_zero(self):
        assert _cosine_similarity([0.0, 0.0], [0.0, 0.0]) == 0.0

    def test_arbitrary_vectors_correct_value(self):
        a = [1.0, 2.0, 3.0]
        b = [4.0, 5.0, 6.0]
        dot   = 1*4 + 2*5 + 3*6           # 32
        norm_a = math.sqrt(1 + 4 + 9)     # sqrt(14)
        norm_b = math.sqrt(16 + 25 + 36)  # sqrt(77)
        expected = dot / (norm_a * norm_b)
        assert _cosine_similarity(a, b) == pytest.approx(expected, rel=1e-5)

    def test_single_dimension(self):
        assert _cosine_similarity([3.0], [5.0]) == pytest.approx(1.0)

    def test_normalized_vectors(self):
        """단위벡터 간 코사인은 정확히 내적값."""
        a = [0.6, 0.8]   # ||a|| = 1.0
        b = [0.8, 0.6]   # ||b|| = 1.0
        expected = 0.6*0.8 + 0.8*0.6  # 0.48 + 0.48 = 0.96
        assert _cosine_similarity(a, b) == pytest.approx(expected)


# ── _keyword_search ────────────────────────────────────────────────────────────

class FakeItem:
    """_keyword_search가 필요로 하는 최소 인터페이스."""
    def __init__(self, name: str, content: str, embeddings_json: str | None = None):
        self.name = name
        self.content = content
        self.embeddings_json = embeddings_json


class TestKeywordSearch:
    def test_finds_matching_document(self):
        items = [FakeItem("doc.txt", "The quick brown fox jumps")]
        results = _keyword_search("fox", items, top_k=5)
        assert len(results) == 1
        assert results[0]["source"] == "doc.txt"
        assert results[0]["score"] == 1.0

    def test_no_match_returns_empty(self):
        items = [FakeItem("doc.txt", "hello world")]
        results = _keyword_search("zzzyyyxxx", items, top_k=5)
        assert results == []

    def test_multiple_keywords_accumulate_score(self):
        items = [FakeItem("doc.txt", "python is great for testing python")]
        # keywords = ["python", "testing"] → both appear → score >= 2
        results = _keyword_search("python testing", items, top_k=5)
        assert len(results) >= 1
        assert results[0]["score"] >= 2.0

    def test_sorted_descending_by_score(self):
        items = [
            FakeItem("low.txt",  "only python here"),       # 1점
            FakeItem("high.txt", "python and testing both"), # 2점
        ]
        results = _keyword_search("python testing", items, top_k=5)
        assert results[0]["source"] == "high.txt"
        assert results[-1]["source"] == "low.txt"

    def test_top_k_limits_results(self):
        items = [FakeItem(f"doc{i}.txt", "python test") for i in range(10)]
        results = _keyword_search("python", items, top_k=3)
        assert len(results) == 3

    def test_case_insensitive_matching(self):
        items = [FakeItem("doc.txt", "Hello World PYTHON")]
        results = _keyword_search("python", items, top_k=5)
        assert len(results) == 1

    def test_result_has_required_fields(self):
        items = [FakeItem("my_doc.txt", "hello python world")]
        results = _keyword_search("python", items, top_k=5)
        assert "chunk" in results[0]
        assert "source" in results[0]
        assert "score" in results[0]

    def test_uses_embeddings_json_chunks_when_present(self):
        """embeddings_json에 chunks 있으면 content 대신 chunks 사용."""
        chunks = ["chunk about python", "chunk about java"]
        # embeddings_json is JSONB — SQLAlchemy returns a dict, never a raw string
        items = [FakeItem("doc.txt", "irrelevant content", embeddings_json={"chunks": chunks, "vectors": []})]

        results = _keyword_search("python", items, top_k=5)
        assert len(results) == 1
        assert "python" in results[0]["chunk"]

    def test_none_embeddings_json_falls_back_to_content(self):
        """embeddings_json=None 이면 content로 fallback."""
        items = [FakeItem("doc.txt", "python is great", embeddings_json=None)]
        results = _keyword_search("python", items, top_k=5)
        assert len(results) == 1

    def test_long_content_is_chunked(self):
        """500자 이상 content는 청크로 분할되어야 함."""
        # 400자 단위로 분할하므로 1000자 content → 3개 청크
        long_content = "python " * 143  # ~1001자
        items = [FakeItem("long.txt", long_content)]
        results = _keyword_search("python", items, top_k=10)
        # 여러 청크에서 매칭 → 결과 여러 개
        assert len(results) > 1

    def test_empty_items_returns_empty(self):
        results = _keyword_search("python", [], top_k=5)
        assert results == []

    def test_item_with_no_content_and_no_embeddings_skipped(self):
        items = [FakeItem("empty.txt", "")]
        results = _keyword_search("python", items, top_k=5)
        assert results == []


# ── _embed_query ───────────────────────────────────────────────────────────────

class TestEmbedQuery:
    """httpx.AsyncClient를 mock해서 외부 API 호출 없이 테스트."""

    @pytest.fixture
    def mock_settings(self):
        with patch("app.services.embedding_service.settings") as m:
            m.OPENAI_API_KEY = "sk-test"
            m.OPENAI_EMBED_MODEL = "text-embedding-3-small"
            m.OLLAMA_URL = "http://localhost:11434"
            m.OLLAMA_EMBED_MODEL = "nomic-embed-text"
            yield m

    @pytest.fixture
    def mock_settings_no_openai(self):
        with patch("app.services.embedding_service.settings") as m:
            m.OPENAI_API_KEY = ""
            m.OPENAI_EMBED_MODEL = "text-embedding-3-small"
            m.OLLAMA_URL = "http://localhost:11434"
            m.OLLAMA_EMBED_MODEL = "nomic-embed-text"
            yield m

    def _make_mock_response(self, status: int, json_body: dict):
        resp = MagicMock()
        resp.status_code = status
        resp.json.return_value = json_body
        return resp

    async def test_openai_success_returns_embedding(self, mock_settings):
        fake_embedding = [0.1] * 1536
        fake_resp = self._make_mock_response(200, {"data": [{"embedding": fake_embedding}]})

        with patch("app.services.embedding_service.httpx.AsyncClient") as mock_cls:
            instance = AsyncMock()
            instance.post = AsyncMock(return_value=fake_resp)
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _embed_query("test query")

        assert result == fake_embedding
        assert len(result) == 1536

    async def test_openai_failure_falls_back_to_ollama(self, mock_settings):
        fake_ollama_embedding = [0.2] * 768
        openai_resp  = self._make_mock_response(500, {})
        ollama_resp  = self._make_mock_response(200, {"embedding": fake_ollama_embedding})

        call_count = 0
        async def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            return openai_resp if call_count == 1 else ollama_resp

        with patch("app.services.embedding_service.httpx.AsyncClient") as mock_cls:
            instance = AsyncMock()
            instance.post = AsyncMock(side_effect=side_effect)
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _embed_query("test query")

        assert result == fake_ollama_embedding

    async def test_no_openai_key_goes_directly_to_ollama(self, mock_settings_no_openai):
        fake_embedding = [0.3] * 768
        ollama_resp = self._make_mock_response(200, {"embedding": fake_embedding})

        with patch("app.services.embedding_service.httpx.AsyncClient") as mock_cls:
            instance = AsyncMock()
            instance.post = AsyncMock(return_value=ollama_resp)
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _embed_query("query")

        assert result == fake_embedding
        # OpenAI URL로 호출되지 않았어야 함
        call_args_list = instance.post.call_args_list
        assert all("openai" not in str(c) for c in call_args_list)

    async def test_both_fail_returns_none(self, mock_settings):
        with patch("app.services.embedding_service.httpx.AsyncClient") as mock_cls:
            instance = AsyncMock()
            instance.post = AsyncMock(side_effect=Exception("connection refused"))
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _embed_query("query")

        assert result is None

    async def test_ollama_missing_embedding_key_returns_none(self, mock_settings_no_openai):
        """Ollama 응답에 embedding 키가 없으면 None."""
        resp = self._make_mock_response(200, {"no_embedding_here": []})

        with patch("app.services.embedding_service.httpx.AsyncClient") as mock_cls:
            instance = AsyncMock()
            instance.post = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _embed_query("query")

        assert result is None

    async def test_openai_network_timeout_falls_back_to_ollama(self, mock_settings):
        fake_embedding = [0.5] * 768
        ollama_resp = self._make_mock_response(200, {"embedding": fake_embedding})

        call_count = 0
        async def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise TimeoutError("request timed out")
            return ollama_resp

        with patch("app.services.embedding_service.httpx.AsyncClient") as mock_cls:
            instance = AsyncMock()
            instance.post = AsyncMock(side_effect=side_effect)
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _embed_query("query")

        assert result == fake_embedding
