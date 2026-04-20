# Umai — AI 플랫폼

> 멀티 프로바이더 채팅, RAG 지식 베이스, 시각적 워크플로우 자동화, 파인튜닝을 갖춘 풀스택 AI 플랫폼 — 처음부터 프로덕션을 위해 설계되었습니다.

[English](README.md) | **한국어**

![Next.js](https://img.shields.io/badge/Next.js_15-black?logo=next.js&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-316192?logo=postgresql&logoColor=white)
![pgvector](https://img.shields.io/badge/pgvector-HNSW-informational)
![Redis](https://img.shields.io/badge/Redis_7-DC382D?logo=redis&logoColor=white)
![Celery](https://img.shields.io/badge/Celery_5-37814A?logo=celery&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript_5-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## 목차

- [기능](#기능)
- [시스템 아키텍처](#시스템-아키텍처)
- [기능 상세](#기능-상세)
  - [인증](#1-인증)
  - [실시간 채팅 & AI 에이전트](#2-실시간-채팅--ai-에이전트)
  - [RAG 지식 베이스](#3-rag-지식-베이스)
  - [워크플로우 엔진](#4-워크플로우-엔진)
  - [파인튜닝 엔진](#5-파인튜닝-엔진)
  - [이미지 생성](#6-이미지-생성)
  - [관리자 대시보드](#7-관리자-대시보드)
- [엔지니어링 결정](#엔지니어링-결정)
  - [확률적 자료구조](#확률적-자료구조)
  - [보안 아키텍처](#보안-아키텍처)
  - [Celery 태스크 큐 설계](#celery-태스크-큐-설계)
- [코드베이스 맵](#코드베이스-맵)
- [기술 스택](#기술-스택)
- [빠른 시작](#빠른-시작)
- [환경 변수](#환경-변수)
- [프로덕션 배포](#프로덕션-배포)

---

## 기능

| 영역 | 기능 |
|---|---|
| **채팅** | 스트리밍 응답 (SSE), 이미지 첨부, 채팅 공유, 폴더 정리 |
| **AI 에이전트** | 멀티스텝 도구 사용 루프: 웹 검색, Python 실행, RAG 검색 |
| **지식 베이스** | PDF/DOCX/TXT/MD → 자동 청킹 → 임베딩 → pgvector HNSW 검색 |
| **워크플로우 엔진** | 시각적 DAG 빌더: LLM, Tool, Branch, HumanNode, Output 노드 |
| **파인튜닝** | Together AI LoRA/QLoRA — LLaMA 4, Gemma 4, Qwen3, DeepSeek R2, Phi-4 (32개 모델) |
| **이미지 생성** | DALL·E 3, ComfyUI, Automatic1111 통합 |
| **인증** | 이메일/비밀번호 + Google/GitHub OAuth, JWT (15분) + 리프레시 (30일) |
| **관리자 대시보드** | 사용자 관리, DAU 분석 (HyperLogLog), 시스템 설정 |
| **다국어** | 한국어 / 영어 |

---

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│  브라우저                                                             │
│    └── Next.js 15 (App Router, React 19)                            │
│         ├── /api/* → rewrite proxy → FastAPI  (클라이언트 CORS 없음) │
│         └── /ws/*  → WebSocket      FastAPI                         │
└─────────────────────────────────────────────────────────────────────┘
                              │ HTTP / WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FastAPI  (Python 3.12, async)                                      │
│    ├── 라우터: auth, chats, rag, workflows, fine_tune, admin, ws    │
│    ├── 의존성:  get_current_user (4단계 JWT + Redis 파이프라인)      │
│    ├── SlowAPI: 전역 200 req/min + 엔드포인트별 제한                 │
│    └── Redis Pub/Sub 채널에 발행                                     │
└──────────────┬─────────────────────┬───────────────────────────────┘
               │ SQLAlchemy async     │ redis.asyncio
               ▼                     ▼
┌──────────────────────┐   ┌──────────────────────────────────────────┐
│  PostgreSQL 16        │   │  Redis 7                                 │
│  ├── users            │   │  db0 — 세션, JWT 저장소, 사용자 캐시     │
│  ├── chats/messages   │   │        HyperLogLog (DAU), Bloom 필터     │
│  ├── knowledge_items  │   │        임베딩 쿼리 캐시, pub/sub         │
│  ├── knowledge_chunks │   │  db1 — Celery 브로커                     │
│  │   └── pgvector     │   │  db2 — Celery 결과 백엔드                │
│  ├── workflows/runs   │   └──────────────────────────────────────────┘
│  └── fine_tune_jobs   │                      │ Celery 태스크
└──────────────────────┘            ┌──────────┴──────────┐
                                    ▼                      ▼
                           ┌─────────────────┐   ┌─────────────────┐
                           │  Celery 워커     │   │  Celery 워커     │
                           │  큐: ai          │   │  큐: image       │
                           │  큐: default     │   │  큐: knowledge   │
                           └─────────────────┘   └─────────────────┘
```

**이 구조를 선택한 이유:**
- 브라우저는 정확히 **하나의 오리진**(`/api/*` 리라이트)과만 통신합니다. 클라이언트 사이드 CORS 설정이 없고 크로스 오리진 요청에서 토큰 누출이 없습니다.
- **4개의 Celery 큐**가 워크로드를 격리합니다: 느린 DALL·E 이미지 작업이 빠른 채팅 제목 생성을 블록할 수 없습니다.
- Redis는 3개의 DB 번호에서 **3가지 역할**을 수행합니다 — db1의 `FLUSHDB`는 Celery 브로커만 지우고 세션에는 영향 없습니다.

---

## 기능 상세

### 1. 인증

> [`backend/app/routers/auth.py`](backend/app/routers/auth.py) · [`backend/app/routers/deps.py`](backend/app/routers/deps.py) · [`backend/app/core/security.py`](backend/app/core/security.py)

**인증 요청 파이프라인 — [`deps.py`](backend/app/routers/deps.py)의 `get_current_user`:**

```
요청 수신  (Authorization: Bearer <jwt>)
  │
  ├─ 0단계: JWT 포맷 검사  "header.payload.sig"  — ~1 µs  (쓰레기 조기 거부)
  ├─ 1단계: HMAC-SHA256 서명 검증                — ~100 µs
  ├─ 2단계: Redis 액세스 토큰 활성 검사   ─┐
  │                                        ├─ asyncio.gather (병렬 실행)
  ├─ 3단계: Redis 사용자 객체 캐시 히트   ─┘  — ~1 ms 왕복
  └─ 4단계: PostgreSQL 폴백 (캐시 미스 시만)    — ~5 ms
```

2단계와 3단계는 `asyncio.gather`로 **병렬** 실행됩니다 — Redis 왕복 2번이 아닌 1번.
캐시 히트율 95% 이상으로 대부분의 요청은 데이터베이스를 건드리지 않습니다.

**토큰 즉시 무효화** — JWT 서명은 발급 후 무효화할 수 없습니다. 발급된 모든 액세스 토큰은 만료 시간과 함께 Redis에 저장됩니다. 로그아웃 시 `access_del(token)`을 호출해 15분 자연 만료를 기다리지 않고 즉시 토큰을 사용 불가 상태로 만듭니다.

**OAuth 플로우** — Redis에 저장되는 일회용 인증 코드에는 **`user_id` (평문 문자열)만** 포함됩니다. Redis 침해 시 사용 가능한 토큰이 없습니다:

```
브라우저 → GET /auth/oauth/google  →  Google 동의 화면
        ←  redirect_uri=/auth/oauth/google/callback

Google 콜백 → FastAPI가 {code → user_id}를 Redis에 저장 (TTL 5분)
           → 브라우저를 /auth/callback?code=<불투명>으로 리디렉션

브라우저 → GET /auth/token/exchange?code=<불투명>
         FastAPI: Redis에서 user_id 팝 (getdel — 원자적, 일회성)
                → 액세스 + 리프레시 토큰 생성
                → 액세스 토큰: JSON 응답 본문
                → 리프레시 토큰: HttpOnly Secure 쿠키
```

---

### 2. 실시간 채팅 & AI 에이전트

> [`backend/app/routers/chats.py`](backend/app/routers/chats.py) · [`backend/app/routers/ws.py`](backend/app/routers/ws.py) · [`backend/app/tasks/ai.py`](backend/app/tasks/ai.py) · [`frontend/src/lib/hooks/useWebSocket.ts`](frontend/src/lib/hooks/useWebSocket.ts)

**스트리밍 파이프라인:**

```
사용자가 메시지 전송
  │
  ├─ FastAPI POST /chats/{id}/messages
  │     └─ 사용자 메시지를 PostgreSQL에 저장
  │     └─ Celery 태스크 실행 (ai 큐)
  │
  Celery 워커 (ai 큐)
  │     ├─ AI 프로바이더 호출 (OpenAI / Anthropic / Ollama)
  │     ├─ 토큰 스트리밍 → Redis PUBLISH ch:chat:{chat_id}
  │     └─ 최종 어시스턴트 메시지를 PostgreSQL에 저장
  │
  FastAPI WebSocket /ws/{chat_id}
  │     └─ Redis SUBSCRIBE ch:chat:{chat_id}
  │     └─ 각 청크를 WS를 통해 브라우저로 전달
  │
  브라우저 (useWebSocket 훅)
        └─ 실시간으로 메시지 버블에 토큰 추가
```

**WebSocket 인증** — JWT는 **절대** URL 쿼리 파라미터로 전송하지 않습니다 (Nginx 액세스 로그와 브라우저 히스토리에 노출됨). 대신:

```
클라이언트: ws.connect("/ws/{chat_id}")  ← URL에 토큰 없음
서버: 연결 수락, 5초 타임아웃 시작
클라이언트: ws.send({"type":"auth","token":"<jwt>"})
서버: 토큰 검증 → 스트림 액세스 허용
      타임아웃 내 인증 없음 → close(4001)
```

**AI 에이전트 도구 사용 루프** — [`backend/app/tasks/ai.py`](backend/app/tasks/ai.py):

```
LLM 호출 (도구 정의 포함)
  │
  ├─ 응답에 tool_calls가 있나요?
  │     ├─ 있음 → 도구 실행 (web_search / execute_python / rag_search)
  │     │         → 메시지에 도구 결과 추가
  │     │         → LLM 호출로 루프백
  │     └─ 없음 → 최종 답변 → Redis에 발행 → 완료
  │
  └─ max_steps 도달 → 루프 강제 종료
```

에이전트가 사용 가능한 도구: `web_search` (DuckDuckGo, API 키 불필요), `execute_python` (AST 검증이 포함된 subprocess 샌드박스), `rag_search` (지식 베이스 검색).

---

### 3. RAG 지식 베이스

> [`backend/app/routers/rag.py`](backend/app/routers/rag.py) · [`backend/app/tasks/knowledge.py`](backend/app/tasks/knowledge.py) · [`backend/app/services/embedding_service.py`](backend/app/services/embedding_service.py)

**문서 수집 파이프라인 (백그라운드, Celery `knowledge` 큐):**

```
PDF/DOCX/TXT/MD 업로드
  │
  ├─ 매직 바이트 검증  (%PDF / PK\x03\x04 / UTF-8)
  ├─ 텍스트 추출  (PyMuPDF / python-docx / 일반 텍스트)
  ├─ 청킹  (500자 청크, 100자 스트라이드 오버랩)
  ├─ Bloom 필터 중복 제거  (이미 임베딩된 청크 건너뜀)
  └─ 각 청크 임베딩
       ├─ OPENAI_API_KEY 설정됨  → text-embedding-3-small  (1536차원)
       └─ 미설정              → Ollama OLLAMA_EMBED_MODEL (기본: qwen3-embedding:8b)
            └─ knowledge_chunks.embedding에 저장  (pgvector)
               └─ 다음 검색부터 HNSW 인덱스 자동 사용
```

**검색 파이프라인 — 3단계 폴백:**

```
쿼리 문자열
  │
  ├─ Redis 캐시 확인  MD5(쿼리 + 모델)  TTL 24시간
  │     └─ 히트  → 임베딩 API 호출 건너뜀
  │
  ├─ 미스 → 쿼리 임베딩 생성
  │
  └─ pgvector 검색 (3단계 폴백)
       ├─ 1단계: knowledge_chunks HNSW 인덱스  O(log n)  ← 우선
       │          코사인 거리, ef_search=40
       ├─ 2단계: knowledge_items.embeddings_json JSONB   O(n) 전체 스캔
       │          HNSW 테이블이 비어 있을 때 폴백 (마이그레이션 전 데이터)
       └─ 3단계: 키워드 ilike %쿼리%
                  임베딩이 완전히 실패했을 때 폴백
```

**왜 HNSW인가?** 인덱스 없는 평범한 `vector` 컬럼의 코사인 유사도 스캔은 O(n)으로 문서가 늘어날수록 선형적으로 느려집니다. HNSW(Hierarchical Navigable Small World)는 약 5%의 정확도를 희생하고 O(log n)에 근사 최근접 이웃을 찾아 대규모에서 100배 속도를 제공합니다.

**임베딩 캐시 설계** — 키: `MD5(쿼리 텍스트 + 모델명)`. TTL: 24시간. 예상 API 비용 절감: 반복 쿼리 대비 40~60%.

캐시 히트 시 두 가지 추가 보호 적용:
1. **차원 검증** — 캐시된 벡터 차원이 저장된 벡터와 불일치하면 (예: OpenAI 1536차원 → Ollama 768차원 전환 후) 오래된 캐시를 폐기하고 새 임베딩을 생성합니다.
2. **스탬피드 잠금** — 캐시 미스 시 3초 Redis `SET NX` 잠금이 주어진 쿼리에 대해 하나의 코루틴만 임베딩 API를 호출하도록 보장합니다; 동시 대기자들은 150ms 대기 후 새로 캐시된 결과를 재사용합니다.

---

### 4. 워크플로우 엔진

> [`backend/app/routers/workflows.py`](backend/app/routers/workflows.py) · [`backend/app/tasks/workflow.py`](backend/app/tasks/workflow.py) · [`backend/app/models/workflow.py`](backend/app/models/workflow.py)

**노드 타입:**

| 노드 | 역할 | 주요 동작 |
|---|---|---|
| `InputNode` | 진입점 | 사용자 제공 값을 실행 컨텍스트에 주입 |
| `LLMNode` | AI 호출 | OpenAI/Anthropic/Ollama 호출; 결과를 컨텍스트에 저장 |
| `ToolNode` | 사이드 이펙트 | `web_search` 또는 `execute_python` 실행 |
| `BranchNode` | 조건부 라우팅 | `context[key] op value` 평가; `sourceHandle` ID로 라우팅 |
| `HumanNode` | 사람 개입 | 실행 중단; `/resume` API 호출 대기 |
| `OutputNode` | 터미널 | 최종 출력을 `WorkflowRun.outputs`에 기록 |

**실행 모델:**

```
POST /workflow/{id}/run
  │
  ├─ WorkflowRun 생성  (status = "running")  in PostgreSQL
  └─ Celery 태스크: execute_workflow (ai 큐)

  Celery 워커:
  ├─ 위상 정렬 (Kahn 알고리즘) → 실행 순서
  ├─ 순서대로 각 노드 처리:
  │     ├─ LLMNode    → 프로바이더 API 호출 → context["node_id"] = 결과
  │     ├─ ToolNode   → 도구 실행 → context["node_id"] = 결과
  │     ├─ BranchNode → 조건 평가 → 매칭 sourceHandle 엣지 따라가기
  │     ├─ HumanNode  → Redis에 {node_id, context} 저장 (TTL 24h)
  │     │              → "workflow_suspended" WebSocket 이벤트 발행
  │     │              → 반환 (태스크 종료, run.status = "suspended")
  │     └─ OutputNode → run.outputs = context[source_node_id]
  │
  └─ run.status = "completed"  →  "workflow_done" 이벤트 발행
```

**왜 Kahn 알고리즘인가?** 표준 DFS 위상 정렬은 다이아몬드 그래프(A→B, A→C, B→D, C→D)에서 실패합니다 — B와 C가 모두 완료되기 전에 D를 방문할 수 있습니다. Kahn의 진입 차수 감소 방식은 모든 선행 노드가 완료될 때만 자연스럽게 노드를 처리합니다.

---

### 5. 파인튜닝 엔진

> [`backend/app/routers/fine_tune.py`](backend/app/routers/fine_tune.py) · [`backend/app/models/fine_tune.py`](backend/app/models/fine_tune.py)

코딩 없이 LoRA / QLoRA 파인튜닝을 위한 시각적 위저드입니다.

**학습 파이프라인:**

```
채팅 UI (파인튜닝 모드 토글)
  └─ 대화 쌍을 JSONL 데이터셋으로 저장
       {"messages": [{"role":"user","content":"..."}, {"role":"assistant","content":"..."}]}

POST /fine-tune/datasets   (JSONL 업로드 또는 채팅에서 자동 수집)
POST /fine-tune/jobs       (베이스 모델 + 하이퍼파라미터 선택)
  │
  └─ Celery 태스크: _run_together_fine_tune()
       ├─ 예제를 OpenAI 호환 JSONL로 변환
       ├─ Together AI Files API에 업로드
       ├─ 파인튜닝 작업 생성 (LoRA/QLoRA 설정)
       ├─ 30초 간격 폴링 → DB 진행률 + WebSocket 이벤트 업데이트
       └─ TOGETHER_API_KEY 미설정 → 시뮬레이션 폴백 (개발용)

WebSocket 스트림 → 브라우저에서 실시간 손실 곡선, 스텝 수, ETA 표시
작업 취소 → Together AI 작업 취소 API + job.status = "cancelled"
```

**지원 모델 계열 (Together AI, 32개 모델):**

| 계열 | 주요 모델 | 비고 |
|---|---|---|
| **LLaMA 4** *(2025)* | Scout 17B-16E, Maverick 17B-128E | Meta의 최신 MoE 아키텍처 |
| **LLaMA 3.x** | 3.3 70B, 3.1 8B/70B/405B | Meta, 넓은 생태계 |
| **Gemma 4** | 1B / 4B / 12B / 27B IT | 128K 컨텍스트, 멀티모달, 다국어 SOTA |
| **Qwen3** | 4B / 8B / 14B / 30B / 72B | 최고 CJK + 수학 추론 |
| **DeepSeek** | R2 (MoE), V3, R1 | 상위 추론 벤치마크 |
| **Phi-4** | phi-4, phi-4-mini, phi-4-reasoning | Microsoft, 엣지 디바이스 지원 |
| **Mistral** | Mistral Small 3.1 | 강력한 코드 + 추론 |

LLaMA 4 Scout / Gemma 4 4B는 소비자용 GPU(VRAM 8~12GB)에서 실행 가능하여 클라우드 인프라 없이도 파인튜닝이 가능합니다.

---

### 6. 이미지 생성

> [`backend/app/tasks/image.py`](backend/app/tasks/image.py)

**프로바이더 라우팅:**

```
POST /tasks/image/generate
  │
  ├─ provider = "dalle"     → OpenAI DALL·E 3 API
  ├─ provider = "comfyui"   → ComfyUI HTTP API  (자체 호스팅)
  └─ provider = "a1111"     → Automatic1111 HTTP API  (자체 호스팅)
```

**멱등성** — DALL·E 호출은 비용이 크고 비결정론적입니다. Celery 재시도 시 두 번째 API 호출로 추가 청구와 다른 이미지가 반환됩니다. 각 태스크는 API를 호출하기 전 Redis 키 `task:dalle:{task_id}`를 확인합니다. 첫 번째 실행: API 호출 → 결과 캐시 (TTL 2시간). 재시도: 캐시된 결과 반환, API 호출 완전 건너뜀.

**마스크 에디터** — [`frontend/src/components/canvas/MaskCanvas.tsx`](frontend/src/components/canvas/MaskCanvas.tsx)의 캔버스 기반 인페인팅 도구. 사용자가 기본 이미지 위에 마스크를 그리면 마스크 영역이 인페인팅을 위해 생성 엔드포인트로 전송됩니다.

---

### 7. 관리자 대시보드

> [`backend/app/routers/admin.py`](backend/app/routers/admin.py) · [`frontend/src/app/admin/page.tsx`](frontend/src/app/admin/page.tsx)

모든 관리자 라우트는 `require_admin` 의존성을 사용합니다 — `role != "admin"`이면 비즈니스 로직 실행 전 403을 반환합니다.

**HyperLogLog를 활용한 DAU 추적:**

```python
# backend/app/core/redis.py
await redis.pfadd(f"dau:{today}", user_id)   # O(1), ~12 KB 고정 메모리
count = await redis.pfcount(f"dau:{today}")  # ±0.81% 정확도
```

단순 `SADD dau:{today} user_id`는 O(n)으로 증가합니다 — DAU 100만 명 × 20바이트 = 하루 20 MB, 무제한 증가. HyperLogLog는 카디널리티에 관계없이 12 KB를 사용합니다.

---

## 엔지니어링 결정

### 확률적 자료구조

> [`backend/app/core/redis.py`](backend/app/core/redis.py) — 세 가지 구조 모두 여기에 구현

100% 정밀도보다 O(1) 제한된 메모리가 더 중요할 때 선택:

| 구조 | 위치 | 사용 사례 | 공간 | 정확도 |
|---|---|---|---|---|
| **Bloom 필터** | `bloom_add` / `bloom_check` | 동일한 청크 재임베딩 건너뜀 | 8 MB 고정 (2²³비트, k=7) | ~0.1% 오탐 |
| **HyperLogLog** | `dau_add` / `dau_count` | 일일 활성 사용자 수 | 12 KB 고정 | ±0.81% |
| **Sorted Set + Lua** | `check_http_rate_limit` | 슬라이딩 윈도우 레이트 리밋 | O(윈도우 내 요청 수) | 정확 |

Bloom 필터는 2²³비트 BITFIELD에서 `k=7`개의 해시 함수를 사용합니다. 100만 개 청크에 대한 SHA-256 해시의 Python `set`은 ~32 MB를 사용하고 무제한 증가하지만 Bloom 필터는 영원히 8 MB에 고정됩니다.

레이트 리밋을 위한 Lua 스크립트는 ZADD + ZREMRANGEBYSCORE + ZCARD를 **원자적**으로 만듭니다 — 비원자적 버전은 두 개의 동시 요청이 어느 쪽도 증가하기 전에 "한도 미만"으로 읽는 TOCTOU 레이스 조건이 있습니다.

### 보안 아키텍처

> [`backend/app/routers/deps.py`](backend/app/routers/deps.py) · [`backend/app/core/config.py`](backend/app/core/config.py) · [`backend/app/core/constants.py`](backend/app/core/constants.py)

보안 감사 중 내린 9가지 강화 결정:

| 결정 | 위치 | 트레이드오프 |
|---|---|---|
| URL이 아닌 첫 번째 메시지로 WS 인증 | [`ws.py`](backend/app/routers/ws.py) | 약간의 지연 vs 토큰이 로그/히스토리에 절대 없음 |
| OAuth 코드에 토큰 아닌 `user_id`만 저장 | [`auth.py`](backend/app/routers/auth.py) | 추가 DB 조회 vs Redis 침해 시 사용 가능한 것 없음 |
| 즉시 취소를 위해 Redis에 액세스 토큰 저장 | [`deps.py`](backend/app/routers/deps.py) | Redis 의존성 vs 로그아웃 즉시 적용 |
| `SESSION_SECRET_KEY` ≠ `SECRET_KEY` (키 분리) | [`config.py`](backend/app/core/config.py) | 관리할 두 개의 시크릿 vs 단일 키 SPOF |
| 시작 시 HTTPS 강제 (경고 아닌 즉시 실패) | [`config.py`](backend/app/core/config.py) | 하드 실패 vs 잘못 설정된 프로덕션이 HTTP로 조용히 서빙 |
| Content-Type에 더해 매직 바이트 파일 검증 | [`workspace.py`](backend/app/routers/workspace.py) | 추가 읽기 vs 클라이언트 제어 MIME 우회 |
| 관리자 설정에 Pydantic `extra="forbid"` | [`admin.py`](backend/app/routers/admin.py) | 엄격한 스키마 vs 우발적 키 주입 |
| 모든 리소스 조회에 소유자 확인 | 모든 라우터 | 명시적 `_assert_owner()` vs IDOR 취약점 |
| `constants.py`에 레이트 리밋 중앙 집중 | [`constants.py`](backend/app/core/constants.py) | 감사할 단일 파일 vs 분산된 매직 넘버 |

### Celery 태스크 큐 설계

> [`backend/app/core/celery_app.py`](backend/app/core/celery_app.py) · [`backend/app/tasks/`](backend/app/tasks/)

```
큐          태스크                         분리 이유
──────────────────────────────────────────────────────────────────
ai          run_agent, execute_workflow    느림 (여러 LLM 호출); 빠른 태스크에서 격리
image       generate_image (DALL·E 등)    매우 느리고 비쌈; 채팅 제목 생성을 절대 블록하지 않음
knowledge   parse_document, embed_chunks  I/O 바운드; 많은 수의 동시 실행 가능
default     title_generation, 기타        빠름; 경량 태스크를 위한 catch-all
```

큐 분리 없이는 단일 느린 DALL·E 작업(10~30초)이 단일 워커 설정에서 제목 생성 태스크(< 1초)가 실행되는 것을 막을 수 있습니다.

**멱등 유료 API 호출** — [`backend/app/tasks/image.py`](backend/app/tasks/image.py)의 패턴:

```python
cache_key = f"task:dalle:{self.request.id}"
if cached := redis.get(cache_key):
    return json.loads(cached)          # 재시도: 캐시된 것 반환, 이중 청구 없음
result = call_dalle_api(...)
redis.setex(cache_key, 7200, json.dumps(result))   # 2시간 캐시
return result
```

---

## 코드베이스 맵

```
umai/
├── backend/
│   ├── main.py                          ← FastAPI 앱, 미들웨어, 라우터, 헬스
│   ├── app/
│   │   ├── core/
│   │   │   ├── config.py                ← pydantic-settings, 프로덕션 즉시 실패 검증
│   │   │   ├── constants.py             ← 모든 레이트 리밋, 매직 넘버 (한 곳에)
│   │   │   ├── redis.py                 ← 모든 Redis 작업: 인증, 캐시, HLL, Bloom, Lua
│   │   │   ├── redis_keys.py            ← 키 이름 팩토리 (하드코딩 문자열 없음)
│   │   │   ├── security.py              ← JWT 서명/검증 (HMAC-SHA256)
│   │   │   ├── database.py              ← SQLAlchemy 비동기 엔진, 세션 팩토리
│   │   │   ├── celery_app.py            ← Celery 설정, 4큐 라우팅
│   │   │   ├── model_registry.py        ← AI 프로바이더 모델 ID, 컨텍스트 윈도우
│   │   │   └── errors.py                ← ErrCode enum → AppException
│   │   ├── routers/
│   │   │   ├── deps.py                  ← get_current_user (4단계, 병렬 Redis)
│   │   │   ├── auth.py                  ← JWT, OAuth (Google/GitHub), 토큰 교환
│   │   │   ├── chats.py                 ← 채팅 CRUD, 메시지 스트리밍 트리거
│   │   │   ├── rag.py                   ← 시맨틱 검색, 3단계 폴백
│   │   │   ├── workflows.py             ← DAG CRUD, 실행/취소/재개
│   │   │   ├── fine_tune.py             ← 데이터셋 CRUD, 작업 생명주기
│   │   │   ├── workspace.py             ← 지식 업로드, 모델/프롬프트/도구 설정
│   │   │   ├── admin.py                 ← 사용자 관리, DAU 통계, 시스템 설정
│   │   │   └── ws.py                    ← WebSocket: 첫 메시지 인증, pub/sub 중계
│   │   ├── tasks/
│   │   │   ├── ai.py                    ← 에이전트 루프, web_search, execute_python
│   │   │   ├── workflow.py              ← DAG 실행기, Kahn 정렬, HumanNode 중단
│   │   │   ├── knowledge.py             ← 문서 파싱, 청킹, 임베딩, Bloom 중복 제거
│   │   │   └── image.py                 ← DALL·E / ComfyUI / A1111, 멱등성
│   │   ├── models/
│   │   │   ├── user.py                  ← User (id, email, role, oauth_provider)
│   │   │   ├── chat.py                  ← Chat, Message (+복합 인덱스), Folder
│   │   │   ├── workspace.py             ← KnowledgeItem, KnowledgeChunk (pgvector)
│   │   │   ├── workflow.py              ← Workflow, WorkflowRun, WorkflowRunStep
│   │   │   ├── fine_tune.py             ← TrainingDataset, FineTuneJob
│   │   │   └── settings.py              ← SystemSettings (싱글톤)
│   │   ├── services/
│   │   │   ├── embedding_service.py     ← embed_query_async/sync, OpenAI→Ollama 폴백
│   │   │   ├── auth_service.py          ← get_or_create_oauth_user, make_tokens
│   │   │   └── workspace_service.py     ← 지식 아이템 CRUD 헬퍼
│   │   └── schemas/
│   │       ├── auth.py                  ← AccessTokenResponse, UserOut, OnboardRequest
│   │       ├── chat.py                  ← ChatCreate, MessageCreate, 스트리밍 이벤트
│   │       └── ...
│   └── tests/
│       ├── conftest.py                  ← pytest 픽스처: DB, 앱 클라이언트, 인증 헤더
│       ├── test_auth.py                 ← OAuth 플로우, 토큰 리프레시, 로그아웃
│       ├── test_chats.py                ← 채팅 CRUD, 메시지 페이지네이션
│       ├── test_workflows.py            ← 실행 생명주기, 소유권, 재개/취소
│       ├── test_fine_tune.py            ← 데이터셋 업로드, 작업 생성, 취소
│       └── test_settings_sections.py    ← 관리자 설정 타입 스키마 검증
│
└── frontend/
    └── src/
        ├── app/
        │   ├── chat/[id]/page.tsx        ← 메인 채팅 UI, 스트리밍 메시지 렌더링
        │   ├── workflow/[id]/page.tsx     ← ReactFlow DAG 에디터
        │   ├── workspace/
        │   │   ├── knowledge/page.tsx     ← 파일 업로드, 임베딩 상태
        │   │   ├── models/page.tsx        ← AI 프로바이더 모델 선택
        │   │   ├── fine-tune/new/page.tsx ← LoRA 학습 위저드
        │   │   └── prompts/page.tsx       ← 시스템 프롬프트 라이브러리
        │   └── admin/
        │       ├── page.tsx              ← 사용자 관리 테이블
        │       └── analytics/page.tsx    ← DAU 차트, 시스템 메트릭
        ├── components/
        │   ├── chat/
        │   │   ├── MessageInput.tsx       ← 이미지 첨부, 음성, 전송
        │   │   ├── MessageList.tsx        ← 스트리밍 토큰 렌더링, 도구 호출 표시
        │   │   └── ChatNavbar.tsx         ← 모델 선택기, 공유, 설정
        │   ├── workflow/
        │   │   ├── nodes/                 ← LLMNode, ToolNode, BranchNode, HumanNode ...
        │   │   ├── NodeConfigPanel.tsx    ← 우측 설정 드로어
        │   │   └── NodePalette.tsx        ← 드래그-투-캔버스 노드 피커
        │   ├── canvas/MaskCanvas.tsx      ← 이미지 인페인팅 마스크 에디터
        │   └── layout/
        │       ├── Sidebar.tsx            ← 탐색, 채팅 목록, 폴더 트리
        │       └── SettingsModal.tsx      ← 사용자 환경 설정, API 키 입력
        └── lib/
            ├── hooks/
            │   ├── useWebSocket.ts        ← WS 연결, 첫 메시지 인증, 재연결
            │   └── useChat.ts             ← 메시지 상태, 스트리밍 누적
            ├── api/
            │   ├── backendClient.ts       ← apiFetch 래퍼 (인증 헤더, 오류 정규화)
            │   └── endpoints.ts           ← 타입된 API 엔드포인트 상수
            └── store.ts                   ← localStorage 기반 전역 상태 (외부 상태 라이브러리 없음)
```

---

## 기술 스택

| 레이어 | 기술 | 버전 |
|---|---|---|
| 프론트엔드 프레임워크 | Next.js (App Router) | 15 |
| UI 라이브러리 | React | 19 |
| 언어 | TypeScript | 5 |
| 스타일링 | Tailwind CSS | 3 |
| 워크플로우 캔버스 | ReactFlow | — |
| 백엔드 프레임워크 | FastAPI | 최신 |
| ORM | SQLAlchemy (async) | 2.0 |
| 마이그레이션 | Alembic | — |
| 스키마 검증 | Pydantic | v2 |
| 데이터베이스 | PostgreSQL + pgvector | 16 |
| 캐시 / 브로커 | Redis (hiredis) | 7 |
| 태스크 큐 | Celery | 5 |
| 인증 | JWT (HS256) + OAuth 2.0 | — |
| AI 프로바이더 | OpenAI, Anthropic, Google AI, Ollama | — |
| 레이트 리밋 | SlowAPI | — |
| 인프라 | Docker Compose, Nginx | — |

---

## 빠른 시작

**권장: Docker 인프라 + 네이티브 Next.js (핫 리로드)**

```bash
# 1. 클론
git clone https://github.com/<your-org>/umai.git && cd umai

# 2. 환경 설정
cp backend/.env.example backend/.env
# SECRET_KEY, SESSION_SECRET_KEY, AI 프로바이더 키 중 하나 이상 수정

cp frontend/.env.local.example frontend/.env.local
# INTERNAL_API_URL=http://localhost:8001  (예제에 이미 설정됨)

# 3. 인프라 시작 (PostgreSQL, Redis, FastAPI, Celery)
docker compose -f docker-compose.dev.yml up --build -d

# 4. 핫 리로드가 포함된 프론트엔드
cd frontend && npm install && npm run dev
# → http://localhost:3000
```

| 서비스 | URL |
|---|---|
| 프론트엔드 | http://localhost:3000 |
| 백엔드 API + Swagger | http://localhost:8001/docs |
| PostgreSQL | localhost:5434 |
| Redis | localhost:6380 |

**선택: 로컬 Celery 워커 (Docker 외부에서 AI/이미지/임베딩 태스크)**

```bash
cd backend
pip install -r requirements.txt
celery -A app.core.celery_app worker \
  -Q ai,image,knowledge,default \
  -c 2 --loglevel=info
```

---

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `SECRET_KEY` | **필수** | — | JWT 서명 키. `openssl rand -hex 32` |
| `SESSION_SECRET_KEY` | 프로덕션 | — | 세션 미들웨어 키, `SECRET_KEY`와 **반드시 달라야 함** |
| `DATABASE_URL` | **필수** | `postgresql+asyncpg://umai:umai@localhost:5434/umai` | asyncpg 드라이버 필요 |
| `REDIS_URL` | **필수** | `redis://localhost:6380/0` | 세션/캐시용 db0 |
| `CELERY_BROKER_URL` | **필수** | `redis://localhost:6380/1` | db1 |
| `CELERY_RESULT_BACKEND` | **필수** | `redis://localhost:6380/2` | db2 |
| `BACKEND_URL` | **필수** | `http://localhost:8001` | OAuth 콜백 기본 URL |
| `FRONTEND_URL` | **필수** | `http://localhost:3000` | OAuth 후 리디렉션 대상 |
| `OPENAI_API_KEY` | 선택 | — | GPT-4o, DALL·E 3, text-embedding-3-small |
| `ANTHROPIC_API_KEY` | 선택 | — | Claude 3.5 / Sonnet / Haiku |
| `GOOGLE_API_KEY` | 선택 | — | Gemini 1.5 Pro / Flash |
| `XAI_API_KEY` | 선택 | — | Grok (xAI) |
| `TOGETHER_API_KEY` | 선택 | — | Together AI 파인튜닝. 미설정 = 시뮬레이션 모드 |
| `TAVILY_API_KEY` | 선택 | — | Tavily 웹 검색 |
| `OLLAMA_URL` | 선택 | `http://localhost:11434` | 자체 호스팅 모델 |
| `OLLAMA_EMBED_MODEL` | 선택 | `qwen3-embedding:8b` | 로컬 임베딩 모델 |
| `GOOGLE_CLIENT_ID` | 선택 | — | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | 선택 | — | Google OAuth |
| `GITHUB_CLIENT_ID` | 선택 | — | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | 선택 | — | GitHub OAuth |
| `COMFYUI_URL` | 선택 | `http://localhost:8188` | ComfyUI 이미지 생성 |
| `A1111_URL` | 선택 | `http://localhost:7860` | Automatic1111 이미지 생성 |
| `DEBUG` | 선택 | `false` | Swagger UI 활성화; HTTPS 강제 비활성화 |

> 프로덕션에서 `BACKEND_URL`/`FRONTEND_URL`이 HTTP를 사용하거나, `SECRET_KEY`가 기본값이거나, 32자 미만이면 앱이 **시작을 거부**합니다. 경고는 사용하지 않고 즉시 `RuntimeError`를 발생시킵니다.

---

## 프로덕션 배포

Oracle Cloud Free Tier, SSL 설정, OAuth 콜백 등록, 모니터링을 다루는 전체 단계별 가이드는 [`DEPLOY.ko.md`](DEPLOY.ko.md)를 참조하세요.

```bash
# 빠른 프로덕션 시작
cp backend/.env.example backend/.env
# SECRET_KEY, SESSION_SECRET_KEY, BACKEND_URL (https://), FRONTEND_URL (https://) 설정

docker compose up --build -d
docker compose exec umai-backend alembic upgrade head
```

---

## 라이선스

MIT
