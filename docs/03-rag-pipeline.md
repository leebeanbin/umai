# RAG 파이프라인 (Retrieval-Augmented Generation)

## 개요

사용자가 업로드한 문서(PDF, DOCX, Markdown, 텍스트)를 청크로 분할하고 임베딩 벡터를 생성해
PostgreSQL pgvector에 저장합니다. LLM에 질문할 때 관련 청크를 검색해 컨텍스트로 주입합니다.

```
문서 업로드                    RAG 검색
────────────                   ──────────
PDF/DOCX/MD                    사용자 질문
    │                               │
    ▼                               ▼
[파싱 → 청크 분할]           [쿼리 임베딩]
    │                               │
    ▼                               ▼
[임베딩 생성 × N]         [pgvector HNSW 검색]
    │                               │
    ▼                               ▼
[pgvector 저장]           [상위 K개 청크 반환]
                                    │
                                    ▼
                          [LLM 프롬프트에 삽입]
```

---

## 문서 처리 파이프라인

### 1단계: 파일 파싱

```python
# backend/app/routers/tasks.py — extract_document endpoint
_EXT_TYPE = {
    ".pdf":      "application/pdf",
    ".docx":     "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".md":       "text/markdown",
    ".markdown": "text/markdown",
}
content_type = next(
    (ct for ext, ct in _EXT_TYPE.items() if filename.lower().endswith(ext)),
    "text/plain",
)
```

파싱은 CPU 집약적 작업이므로 FastAPI 이벤트 루프를 블로킹하지 않도록 threadpool에서 실행합니다:

```python
text = await run_in_threadpool(_parse_document, raw, content_type, filename)
```

### 2단계: 청크 분할 (Chunking)

```python
# backend/app/tasks/knowledge.py
CHUNK_SIZE = 400        # 청크당 문자 수
CHUNK_OVERLAP = 50      # 인접 청크 간 겹침 — 문맥 연속성 보장
```

겹침(overlap)을 두는 이유: 중요한 문장이 청크 경계에서 잘리면 검색 시 누락될 수 있습니다.
50자 겹침으로 경계 근처의 내용이 양쪽 청크에 모두 포함됩니다.

### 3단계: 중복 임베딩 방지 (Bloom Filter)

```python
# backend/app/core/redis.py:316
async def bloom_add(doc_hash: str) -> None:
    r = await get_redis()
    pipe = r.pipeline()
    for pos in _bloom_positions(doc_hash):
        pipe.setbit(_BLOOM_KEY, pos, 1)
    await pipe.execute()

async def bloom_check(doc_hash: str) -> bool:
    # True = 이미 임베딩됨 (오탐 가능), False = 확실히 미처리
```

**Bloom filter를 사용하는 이유:**
- 같은 문서를 두 번 업로드하면 임베딩 API를 또 호출하게 됨 (비용 낭비)
- DB에 hash를 저장해서 비교하면 O(1)이지만 문서가 100만 개면 100만 행을 조회
- Bloom filter: 8 MB 비트맵으로 100만 문서를 0.1% 오탐률로 처리

오탐(False Positive)은 허용됩니다: "이미 처리됨"이라고 잘못 판단해도
단순히 재임베딩을 건너뛰는 것뿐, 데이터 손실이 없습니다.

### 4단계: 임베딩 생성

```python
# backend/app/services/embedding_service.py
def embed_texts_sync(texts, provider="ollama", model=""):
    if provider == "openai":
        # OpenAI text-embedding-3-small (1536-dim)
        ...
    # Ollama: /api/embeddings는 단일 텍스트만 지원
    # → ThreadPoolExecutor(8)로 병렬화: 100청크 10s → ~1.5s
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(_single, t) for t in texts]
        return [f.result() for f in futures]
```

Ollama는 배치 임베딩 API가 없어서 청크마다 HTTP 요청이 필요합니다.
직렬 처리하면 100청크 × 100ms = 10초. 8개 워커로 병렬 처리하면 약 1.5초.

---

## pgvector HNSW 인덱스

```sql
-- backend/app/models/workspace.py (SQLAlchemy 모델에서 생성)
CREATE INDEX ix_knowledge_embedding_hnsw ON knowledge_items
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**HNSW (Hierarchical Navigable Small World) 선택 이유:**

| 인덱스 | 검색 속도 | 메모리 | 정확도 | 빌드 속도 |
|---|---|---|---|---|
| IVFFlat | 빠름 | 적음 | 근사치 | 느림 (학습 필요) |
| **HNSW** | **매우 빠름** | **많음** | **높음** | **빠름** |

HNSW는 그래프 기반 인덱스로, 검색 시 계층적 그래프를 탐색합니다.
문서 수가 수만 개 수준인 지식 베이스에 적합하며, 인덱스를 다시 빌드할 필요가 없습니다.

파라미터:
- `m=16`: 각 노드의 최대 연결 수. 높을수록 정확하지만 메모리 사용 증가
- `ef_construction=64`: 인덱스 빌드 시 탐색 깊이. 높을수록 인덱스 품질 향상

---

## 3단계 검색 Fallback

```python
# backend/app/tasks/ai.py — _knowledge_search()
# backend/app/routers/rag.py

# 단계 1: HNSW 벡터 검색 (pgvector)
results = await db.execute(
    select(KnowledgeItem)
    .order_by(KnowledgeItem.embedding.cosine_distance(query_vector))
    .limit(top_k)
)

# 단계 2: JSONB 코사인 유사도 (임베딩 없는 레거시 문서)
#         Python에서 직접 계산 (dot product / |a||b|)

# 단계 3: 키워드 검색 (임베딩 자체가 없을 때)
#         쿼리 단어가 content에 포함된 청크 반환
```

**왜 3단계 Fallback?**
1. pgvector HNSW: 가장 빠르고 정확. 임베딩이 있고 pgvector 인덱스가 있을 때
2. JSONB 코사인: 임베딩은 있지만 pgvector 컬럼이 없는 레거시 데이터
3. 키워드: 임베딩이 아예 없는 문서도 최소한의 검색은 가능하게

실제 배포에서는 단계 1만 사용되지만, 데이터 마이그레이션 중이거나
임베딩 생성이 실패한 문서에 대한 안전망 역할을 합니다.

---

## 쿼리 임베딩 캐시

```python
# backend/app/routers/rag.py

_cache_seed = f"{q}\x00{settings.OPENAI_EMBED_MODEL}\x00{settings.OLLAMA_EMBED_MODEL}"
_query_hash = hashlib.md5(_cache_seed.encode()).hexdigest()

query_vector = await embed_query_cache_get(_query_hash)

# 캐시 히트 후 dimension 검증 — 모델 교체 시 stale 벡터 방지
if query_vector is not None and items_with_embeddings:
    stored_dim = len((items_with_embeddings[0].embeddings_json or {})
                     .get("vectors", [[]])[0] or [])
    if stored_dim and stored_dim != len(query_vector):
        query_vector = None  # 차원 불일치 → 캐시 무효화

if query_vector is None:
    # NX lock: 동시 요청이 모두 캐시 미스일 때 OpenAI API 중복 호출 방지
    acquired = await redis.set(f"embed_lock:{_query_hash}", "1", nx=True, px=3000)
    if acquired:
        query_vector = await embed_query_async(q)
        await embed_query_cache_set(_query_hash, query_vector)
    else:
        await asyncio.sleep(0.15)         # lock 보유자가 채울 때까지 대기
        query_vector = await embed_query_cache_get(_query_hash) or \
                       await embed_query_async(q)  # fallback
```

**캐시 전략 세 가지 보호:**

| 보호 | 이유 |
|---|---|
| `MD5(query + model_name)` | 모델 변경 시 자동으로 다른 캐시 키 사용 |
| dimension 검증 | 동일 모델명이라도 차원 불일치 시 stale 벡터 폐기 |
| NX lock (3초) | 동시 동일 쿼리 → 단 한 번만 OpenAI 호출, 나머지는 캐시 재사용 |

TTL: 24시간 — 반복적인 RAG 검색에서 임베딩 API 호출 40~60% 절감.

---

## 임베딩 모델 선택 가이드

| 모델 | 차원 | 특징 | 추천 용도 |
|---|---|---|---|
| OpenAI text-embedding-3-small | 1536 | 균형잡힌 성능, 비용 낮음 | 일반 사용 |
| qwen3-embedding:8b (Ollama) | 4096 | 100+ 언어, 2025 다국어 SOTA | 한국어 문서 |
| mxbai-embed-large (Ollama) | 1024 | MTEB English 1위 | 영어 문서 |
| bge-m3 (Ollama) | 1024 | dense+sparse 하이브리드 | 혼합 검색 |

다국어 문서(특히 한국어)에는 qwen3-embedding 또는 bge-m3이 OpenAI보다 성능이 좋습니다.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `backend/app/tasks/knowledge.py` | 청크 분할, 임베딩 저장, Bloom filter 체크 |
| `backend/app/services/embedding_service.py` | OpenAI/Ollama 임베딩, Redis 캐시 |
| `backend/app/routers/rag.py` | `GET /rag/search` — 실시간 쿼리 검색 |
| `backend/app/routers/tasks.py` | `POST /tasks/documents/extract` — 문서 파싱 |
| `backend/app/models/workspace.py` | `KnowledgeItem` DB 모델, HNSW 인덱스 |
| `frontend/src/app/workspace/knowledge/page.tsx` | 문서 업로드 UI |
