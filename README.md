# Umai — AI Platform

> Full-stack AI platform with multi-provider chat, RAG knowledge base, visual workflow automation, and fine-tuning — built for production from day one.

![Next.js](https://img.shields.io/badge/Next.js_15-black?logo=next.js&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-316192?logo=postgresql&logoColor=white)
![pgvector](https://img.shields.io/badge/pgvector-HNSW-informational)
![Redis](https://img.shields.io/badge/Redis_7-DC382D?logo=redis&logoColor=white)
![Celery](https://img.shields.io/badge/Celery_5-37814A?logo=celery&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript_5-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Table of Contents

- [Features](#features)
- [System Architecture](#system-architecture)
- [Feature Deep-Dives](#feature-deep-dives)
  - [Authentication](#1-authentication)
  - [Real-time Chat & AI Agent](#2-real-time-chat--ai-agent)
  - [RAG Knowledge Base](#3-rag-knowledge-base)
  - [Workflow Engine](#4-workflow-engine)
  - [Fine-Tuning Engine](#5-fine-tuning-engine)
  - [Image Generation](#6-image-generation)
  - [Admin Dashboard](#7-admin-dashboard)
- [Engineering Decisions](#engineering-decisions)
  - [Redis Data Structures](#probabilistic-data-structures)
  - [Security Architecture](#security-architecture)
  - [Task Queue Design](#celery-task-queue-design)
- [Codebase Map](#codebase-map)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Production Deployment](#production-deployment)

---

## Features

| Area | Capability |
|---|---|
| **Chat** | Streaming responses (SSE), image attachments, chat sharing, folder organization |
| **AI Agent** | Multi-step tool-use loop: web search, Python execution, RAG retrieval |
| **Knowledge Base** | PDF/DOCX/TXT/MD → auto-chunk → embed → pgvector HNSW search |
| **Workflow Engine** | Visual DAG builder: LLM, Tool, Branch, HumanNode, Output nodes |
| **Fine-Tuning** | LoRA/QLoRA wizard for LLaMA 3, Gemma 4, Mistral, Qwen, Phi families |
| **Image Generation** | DALL·E 3, ComfyUI, Automatic1111 integration |
| **Authentication** | Email/password + Google/GitHub OAuth, JWT (15 min) + Refresh (30 days) |
| **Admin Dashboard** | User management, DAU analytics (HyperLogLog), system settings |
| **i18n** | Korean / English |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│    └── Next.js 15 (App Router, React 19)                           │
│         ├── /api/* → rewrite proxy → FastAPI  (no client CORS)     │
│         └── /ws/*  → WebSocket      FastAPI                        │
└─────────────────────────────────────────────────────────────────────┘
                              │ HTTP / WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FastAPI  (Python 3.12, async)                                      │
│    ├── Routers: auth, chats, rag, workflows, fine_tune, admin, ws  │
│    ├── Deps:    get_current_user (4-step JWT + Redis pipeline)      │
│    ├── SlowAPI: global 200 req/min + per-endpoint limits            │
│    └── Publishes → Redis Pub/Sub channels                           │
└──────────────┬─────────────────────┬───────────────────────────────┘
               │ SQLAlchemy async     │ redis.asyncio
               ▼                     ▼
┌──────────────────────┐   ┌──────────────────────────────────────────┐
│  PostgreSQL 16        │   │  Redis 7                                 │
│  ├── users            │   │  db0 — sessions, JWT store, user cache   │
│  ├── chats/messages   │   │        HyperLogLog (DAU), Bloom filter   │
│  ├── knowledge_items  │   │        embed query cache, pub/sub        │
│  ├── knowledge_chunks │   │  db1 — Celery broker                     │
│  │   └── pgvector     │   │  db2 — Celery result backend             │
│  ├── workflows/runs   │   └──────────────────────────────────────────┘
│  └── fine_tune_jobs   │                      │ Celery tasks
└──────────────────────┘            ┌──────────┴──────────┐
                                    ▼                      ▼
                           ┌─────────────────┐   ┌─────────────────┐
                           │  Celery Worker  │   │  Celery Worker  │
                           │  queue: ai      │   │  queue: image   │
                           │  queue: default │   │  queue: knowledge│
                           └─────────────────┘   └─────────────────┘
```

**Why this shape:**
- The browser talks to exactly **one origin** (`/api/*` rewrites). No client-side CORS config, no token leakage in cross-origin requests.
- **Four Celery queues** isolate workloads: a slow DALL·E image job cannot block a fast chat-title generation.
- Redis serves **three roles** in three DB numbers — a `FLUSHDB` on db1 clears only the Celery broker, never sessions.

---

## Feature Deep-Dives

### 1. Authentication

> [`backend/app/routers/auth.py`](backend/app/routers/auth.py) · [`backend/app/routers/deps.py`](backend/app/routers/deps.py) · [`backend/app/core/security.py`](backend/app/core/security.py)

**Auth request pipeline — `get_current_user` in [`deps.py`](backend/app/routers/deps.py):**

```
Incoming request  (Authorization: Bearer <jwt>)
  │
  ├─ Step 0: JWT format check  "header.payload.sig"  — ~1 µs  (rejects garbage early)
  ├─ Step 1: HMAC-SHA256 signature verify             — ~100 µs
  ├─ Step 2: Redis access-token liveness check ─┐
  │                                             ├─ asyncio.gather (parallel)
  ├─ Step 3: Redis user-object cache hit  ──────┘  — ~1 ms round-trip
  └─ Step 4: PostgreSQL fallback (cache miss only)   — ~5 ms
```

Steps 2 and 3 run in **parallel** via `asyncio.gather` — one Redis round-trip instead of two.  
Cache hit rate above 95% means most requests never touch the database.

**Token revocation** — JWT signatures cannot be invalidated after issuance. Every issued access token is stored in Redis with its expiry. Logout calls `access_del(token)`, making the token unusable immediately, without waiting for the 15-minute natural expiry.

**OAuth flow** — The one-time authorization code stored in Redis contains **only `user_id`** (a plain string). No tokens are stored in Redis. A Redis breach yields nothing usable:

```
Browser → GET /auth/oauth/google  →  Google consent screen
       ←  redirect_uri=/auth/oauth/google/callback
       
Google callback → FastAPI stores {code → user_id} in Redis (TTL 5 min)
               → redirects browser to /auth/callback?code=<opaque>

Browser → GET /auth/token/exchange?code=<opaque>
        FastAPI: pops user_id from Redis (getdel — atomic, one-time)
               → generates access + refresh tokens
               → access token: JSON response body
               → refresh token: HttpOnly Secure cookie
```

---

### 2. Real-time Chat & AI Agent

> [`backend/app/routers/chats.py`](backend/app/routers/chats.py) · [`backend/app/routers/ws.py`](backend/app/routers/ws.py) · [`backend/app/tasks/ai.py`](backend/app/tasks/ai.py) · [`frontend/src/lib/hooks/useWebSocket.ts`](frontend/src/lib/hooks/useWebSocket.ts)

**Streaming pipeline:**

```
User sends message
  │
  ├─ FastAPI POST /chats/{id}/messages
  │     └─ persists user message to PostgreSQL
  │     └─ launches Celery task (ai queue)
  │
  Celery Worker (ai queue)
  │     ├─ calls AI provider (OpenAI / Anthropic / Ollama)
  │     ├─ streams tokens → Redis PUBLISH ch:chat:{chat_id}
  │     └─ persists final assistant message to PostgreSQL
  │
  FastAPI WebSocket /ws/{chat_id}
  │     └─ Redis SUBSCRIBE ch:chat:{chat_id}
  │     └─ forwards each chunk → browser over WS
  │
  Browser (useWebSocket hook)
        └─ appends tokens to message bubble in real-time
```

**WebSocket authentication** — JWT is **never** sent as a URL query parameter (it would appear in Nginx access logs and browser history). Instead:

```
Client: ws.connect("/ws/{chat_id}")  ← no token in URL
Server: accepts connection, starts 5-second timeout
Client: ws.send({"type":"auth","token":"<jwt>"})
Server: validates token → grants stream access
        timeout reached without auth → close(4001)
```

**AI Agent tool-use loop** — [`backend/app/tasks/ai.py`](backend/app/tasks/ai.py):

```
LLM call (with tool definitions)
  │
  ├─ response has tool_calls?
  │     ├─ YES → execute tool (web_search / execute_python / rag_search)
  │     │         → append tool result to messages
  │     │         → loop back to LLM call
  │     └─ NO  → final answer → publish to Redis → done
  │
  └─ max_steps reached → force-terminate loop
```

Tools available to the agent: `web_search` (DuckDuckGo, no API key), `execute_python` (subprocess sandbox with AST validation), `rag_search` (knowledge base retrieval).

---

### 3. RAG Knowledge Base

> [`backend/app/routers/rag.py`](backend/app/routers/rag.py) · [`backend/app/tasks/knowledge.py`](backend/app/tasks/knowledge.py) · [`backend/app/services/embedding_service.py`](backend/app/services/embedding_service.py) · [`frontend/src/app/workspace/knowledge/page.tsx`](frontend/src/app/workspace/knowledge/page.tsx)

**Document ingestion pipeline (background, Celery `knowledge` queue):**

```
Upload PDF/DOCX/TXT/MD
  │
  ├─ magic-byte validation  (%PDF / PK\x03\x04 / UTF-8)
  ├─ text extraction  (PyMuPDF / python-docx / plain text)
  ├─ chunking  (500-char chunks, 100-char stride overlap)
  ├─ Bloom filter dedup  (skip already-embedded chunks)
  └─ embed each chunk
       ├─ OPENAI_API_KEY set  → text-embedding-3-small  (1536-dim)
       └─ not set             → Ollama OLLAMA_EMBED_MODEL (default: qwen3-embedding:8b)
            └─ store in knowledge_chunks.embedding  (pgvector)
               └─ HNSW index auto-used on next search
```

**Search pipeline — 3-tier fallback:**

```
Query string
  │
  ├─ Redis cache check  MD5(query + model)  TTL 24h
  │     └─ HIT  → skip embedding API call
  │
  ├─ MISS → generate query embedding
  │
  └─ pgvector search (3-tier fallback)
       ├─ Tier 1: knowledge_chunks HNSW index  O(log n)  ← preferred
       │          cosine distance, ef_search=40
       ├─ Tier 2: knowledge_items.embeddings_json JSONB   O(n) full-scan
       │          fallback when HNSW table is empty (pre-migration data)
       └─ Tier 3: keyword ilike %query%
                  fallback when embedding fails entirely
```

**Why HNSW over a plain vector column?** A cosine similarity scan on a plain `vector` column without an index is O(n) — performance degrades linearly as documents grow. HNSW (Hierarchical Navigable Small World) finds approximate nearest neighbors in O(log n), trading ~5% accuracy for 100× speed at scale. The `knowledge_chunks` table with a dedicated `vector` column exists specifically because pgvector HNSW indexes cannot be built on JSONB arrays.

**Embedding cache design** — Key: `MD5(query_text + model_name)`. The model name is included so switching providers automatically produces a different cache key. TTL: 24 hours. Estimated API cost reduction: 40–60% on repeated queries.

---

### 4. Workflow Engine

> [`backend/app/routers/workflows.py`](backend/app/routers/workflows.py) · [`backend/app/tasks/workflow.py`](backend/app/tasks/workflow.py) · [`backend/app/models/workflow.py`](backend/app/models/workflow.py) · [`frontend/src/app/workflow/[id]/page.tsx`](frontend/src/app/workflow/%5Bid%5D/page.tsx)

**Node types:**

| Node | Role | Key behavior |
|---|---|---|
| `InputNode` | Entry point | Injects user-supplied values into execution context |
| `LLMNode` | AI call | Calls OpenAI/Anthropic/Ollama; stores result in context |
| `ToolNode` | Side effects | Runs `web_search` or `execute_python` |
| `BranchNode` | Conditional routing | Evaluates `context[key] op value`; routes on `sourceHandle` ID |
| `HumanNode` | Human-in-the-loop | Suspends run; waits for `/resume` API call |
| `OutputNode` | Terminal | Writes final outputs to `WorkflowRun.outputs` |

**Execution model:**

```
POST /workflow/{id}/run
  │
  ├─ Create WorkflowRun  (status = "running")  in PostgreSQL
  └─ Celery task: execute_workflow (ai queue)

  Celery worker:
  ├─ Topological sort (Kahn's algorithm) → execution order
  ├─ For each node in order:
  │     ├─ LLMNode    → provider API call → context["node_id"] = result
  │     ├─ ToolNode   → execute tool → context["node_id"] = result
  │     ├─ BranchNode → eval condition → follow matching sourceHandle edge
  │     ├─ HumanNode  → store {node_id, context} in Redis (TTL 24h)
  │     │              → publish "workflow_suspended" WebSocket event
  │     │              → return (task ends, run.status = "suspended")
  │     └─ OutputNode → run.outputs = context[source_node_id]
  │
  └─ run.status = "completed"  →  publish "workflow_done" event
```

**HumanNode suspend / resume:**

```
[Suspend]                              [Resume]
execute_workflow task                  POST /workflow/runs/{run_id}/resume
  → Redis SET                            { approved: true }
      key: workflow:suspend:{run_id}    │
      val: {node_id, context}           ├─ pop Redis suspend key
      TTL: 24h                          ├─ approved=true  → re-queue Celery task
  → run.status = "suspended"           │                    (already-done nodes skipped)
  → task exits                         └─ approved=false → run.status = "failed"
```

**Why Kahn's algorithm?** Standard DFS topological sort fails on diamond graphs (A→B, A→C, B→D, C→D) — it can visit D before both B and C finish. Kahn's in-degree reduction naturally processes nodes only when all predecessors are complete.

**Run history** — Every run is persisted in `WorkflowRun` + `WorkflowRunStep`. Worker restarts don't lose state. Run cancellation sends `SIGTERM` via `celery_app.control.revoke(terminate=True)` then marks `run.status = "failed"`.

---

### 5. Fine-Tuning Engine

> [`backend/app/routers/fine_tune.py`](backend/app/routers/fine_tune.py) · [`backend/app/models/fine_tune.py`](backend/app/models/fine_tune.py) · [`frontend/src/app/workspace/fine-tune/new/page.tsx`](frontend/src/app/workspace/fine-tune/new/page.tsx)

Visual wizard for LoRA / QLoRA fine-tuning — no coding required.

**Training pipeline:**

```
Chat UI (fine-tune mode toggle)
  └─ conversation pair saved as JSONL dataset
       {"messages": [{"role":"user","content":"..."}, {"role":"assistant","content":"..."}]}

POST /fine-tune/datasets   (upload JSONL or auto-collect from chat)
POST /fine-tune/jobs       (select base model + hyperparameters)
  │
  └─ FastAPI BackgroundTask: _simulate_training()
       ├─ dev:  exponential-decay loss simulation, emits progress via WebSocket
       └─ prod: replace with Celery task → Unsloth / HuggingFace Trainer

WebSocket stream → browser shows live loss curve, step count, ETA
Job cancellation → Celery task revocation + job.status = "cancelled"
```

**Supported model families:**

| Family | Models | Min VRAM | Notes |
|---|---|---|---|
| **Gemma 4** *(Apr 2025)* | 1B / 4B / 12B / 27B IT | 4 GB | 128K ctx, multimodal, multilingual SOTA |
| **Gemma 2** | 2B / 9B / 27B IT | 8 GB | Previous generation |
| **LLaMA 3.x** | 3B / 8B / 70B Instruct | 8 GB | Meta, broad ecosystem |
| **Mistral** | 7B / Nemo 12B | 14 GB | Strong code + reasoning |
| **Qwen 2.5** | 7B / 14B / 72B Instruct | 14 GB | Best CJK language support |
| **Phi 3.5** | Mini 3.8B / Medium 14B | 8 GB | Microsoft, edge-device ready |

Gemma 4 1B / 4B run on consumer GPUs (4–10 GB VRAM), making fine-tuning viable without cloud infrastructure.

---

### 6. Image Generation

> [`backend/app/tasks/image.py`](backend/app/tasks/image.py) · [`frontend/src/app/editor/[id]/page.tsx`](frontend/src/app/editor/%5Bid%5D/page.tsx)

**Provider routing:**

```
POST /tasks/image/generate
  │
  ├─ provider = "dalle"     → OpenAI DALL·E 3 API
  ├─ provider = "comfyui"   → ComfyUI HTTP API  (self-hosted)
  └─ provider = "a1111"     → Automatic1111 HTTP API  (self-hosted)
```

**Idempotency** — DALL·E calls are expensive and non-deterministic. On Celery retry, a second API call would charge the user again and return a different image. Each task checks a Redis key `task:dalle:{task_id}` before calling the API. On first run: call API → cache result (TTL 2h). On retry: return cached result, skip API call entirely.

**Mask editor** — Canvas-based inpainting tool in [`frontend/src/components/canvas/MaskCanvas.tsx`](frontend/src/components/canvas/MaskCanvas.tsx). The user draws a mask over a base image; the masked region is sent to the generation endpoint for inpainting.

---

### 7. Admin Dashboard

> [`backend/app/routers/admin.py`](backend/app/routers/admin.py) · [`frontend/src/app/admin/page.tsx`](frontend/src/app/admin/page.tsx) · [`frontend/src/app/admin/analytics/page.tsx`](frontend/src/app/admin/analytics/page.tsx)

All admin routes use `require_admin` dependency — `role != "admin"` returns 403 before any business logic runs.

**DAU tracking with HyperLogLog:**

```python
# backend/app/core/redis.py
await redis.pfadd(f"dau:{today}", user_id)   # O(1), ~12 KB fixed memory
count = await redis.pfcount(f"dau:{today}")  # ±0.81% accuracy
```

A naive `SADD dau:{today} user_id` would grow O(n) — 1 million DAU × 20 bytes = 20 MB per day, unbounded. HyperLogLog uses 12 KB regardless of cardinality.

**System settings** — Admin can update AI provider keys, rate limits, and feature flags through a typed Pydantic schema with `extra="forbid"`. Arbitrary JSON keys are rejected at the schema layer, not after DB write.

---

## Engineering Decisions

### Probabilistic Data Structures

> [`backend/app/core/redis.py`](backend/app/core/redis.py) — all three structures implemented here

Chosen when O(1) bounded memory matters more than 100% precision:

| Structure | Location | Use case | Space | Accuracy |
|---|---|---|---|---|
| **Bloom filter** | `bloom_add` / `bloom_check` | Skip re-embedding identical chunks | 8 MB fixed (2²³ bits, k=7) | ~0.1% false positive |
| **HyperLogLog** | `dau_add` / `dau_count` | Daily active user count | 12 KB fixed | ±0.81% |
| **Sorted Set + Lua** | `check_http_rate_limit` | Sliding-window rate limiting | O(requests in window) | Exact |

The Bloom filter uses `k=7` hash functions over a 2²³-bit BITFIELD. A standard Python `set` of SHA-256 hashes for 1 million chunks would use ~32 MB and grow unbounded; the Bloom filter caps at 8 MB forever.

The Lua script for rate limiting makes ZADD + ZREMRANGEBYSCORE + ZCARD **atomic** — a non-atomic version has a TOCTOU race where two concurrent requests can both read "under limit" before either increments.

### Security Architecture

> [`backend/app/routers/deps.py`](backend/app/routers/deps.py) · [`backend/app/core/config.py`](backend/app/core/config.py) · [`backend/app/core/constants.py`](backend/app/core/constants.py)

9 hardening decisions made during security audit:

| Decision | Where | Tradeoff |
|---|---|---|
| WebSocket auth via first message, not URL | [`ws.py`](backend/app/routers/ws.py) | Slight latency vs token never in logs/history |
| OAuth code stores only `user_id`, not tokens | [`auth.py`](backend/app/routers/auth.py) | Extra DB lookup vs Redis breach yields nothing |
| Access tokens stored in Redis for instant revocation | [`deps.py`](backend/app/routers/deps.py) | Redis dependency vs logout works immediately |
| `SESSION_SECRET_KEY` ≠ `SECRET_KEY` (key separation) | [`config.py`](backend/app/core/config.py) | Two secrets to manage vs single-key SPOF |
| HTTPS enforced at startup (fail-fast, not warning) | [`config.py`](backend/app/core/config.py) | Hard failure vs misconfigured prod silently serving HTTP |
| Magic-byte file validation in addition to Content-Type | [`workspace.py`](backend/app/routers/workspace.py) | Extra read vs client-controlled MIME bypass |
| Pydantic `extra="forbid"` on admin settings | [`admin.py`](backend/app/routers/admin.py) | Strict schema vs accidental key injection |
| Owner check on every resource fetch | all routers | Explicit `_assert_owner()` vs IDOR vulnerabilities |
| Rate limits centralized in `constants.py` | [`constants.py`](backend/app/core/constants.py) | Single file to audit vs scattered magic numbers |

### Celery Task Queue Design

> [`backend/app/core/celery_app.py`](backend/app/core/celery_app.py) · [`backend/app/tasks/`](backend/app/tasks/)

```
Queue     Tasks                          Why separate?
──────────────────────────────────────────────────────────────────
ai        run_agent, execute_workflow    Slow (multiple LLM calls); isolate from fast tasks
image     generate_image (DALL·E etc.)  Very slow + expensive; never blocks chat title gen
knowledge parse_document, embed_chunks  I/O-bound; can run many concurrently
default   title_generation, misc        Fast; catch-all for lightweight tasks
```

Without queue separation, a single slow DALL·E job (10–30 sec) would prevent a title generation task (< 1 sec) from running on a single-worker setup.

**Idempotent paid API calls** — pattern in [`backend/app/tasks/image.py`](backend/app/tasks/image.py):

```python
cache_key = f"task:dalle:{self.request.id}"
if cached := redis.get(cache_key):
    return json.loads(cached)          # retry: return cached, no second charge
result = call_dalle_api(...)
redis.setex(cache_key, 7200, json.dumps(result))   # cache 2h
return result
```

---

## Codebase Map

```
umai/
├── backend/
│   ├── main.py                          ← FastAPI app, middleware, routers, health
│   ├── app/
│   │   ├── core/
│   │   │   ├── config.py                ← pydantic-settings, fail-fast prod validation
│   │   │   ├── constants.py             ← ALL rate limits, magic numbers (one place)
│   │   │   ├── redis.py                 ← all Redis ops: auth, cache, HLL, Bloom, Lua
│   │   │   ├── redis_keys.py            ← key name factory (no hardcoded strings)
│   │   │   ├── security.py              ← JWT sign/verify (HMAC-SHA256)
│   │   │   ├── database.py              ← SQLAlchemy async engine, session factory
│   │   │   ├── celery_app.py            ← Celery config, 4-queue routing
│   │   │   ├── model_registry.py        ← AI provider model IDs
│   │   │   └── errors.py                ← ErrCode enum → AppException
│   │   ├── routers/
│   │   │   ├── deps.py                  ← get_current_user (4-step, parallel Redis)
│   │   │   ├── auth.py                  ← JWT, OAuth (Google/GitHub), token exchange
│   │   │   ├── chats.py                 ← chat CRUD, message streaming trigger
│   │   │   ├── rag.py                   ← semantic search, 3-tier fallback
│   │   │   ├── workflows.py             ← DAG CRUD, run/cancel/resume
│   │   │   ├── fine_tune.py             ← dataset CRUD, job lifecycle
│   │   │   ├── workspace.py             ← knowledge upload, model/prompt/tool settings
│   │   │   ├── admin.py                 ← user mgmt, DAU stats, system settings
│   │   │   └── ws.py                    ← WebSocket: first-message auth, pub/sub relay
│   │   ├── tasks/
│   │   │   ├── ai.py                    ← agent loop, web_search, execute_python
│   │   │   ├── workflow.py              ← DAG executor, Kahn sort, HumanNode suspend
│   │   │   ├── knowledge.py             ← doc parse, chunk, embed, Bloom dedup
│   │   │   └── image.py                 ← DALL·E / ComfyUI / A1111, idempotency
│   │   ├── models/
│   │   │   ├── user.py                  ← User (id, email, role, oauth_provider)
│   │   │   ├── chat.py                  ← Chat, Message, Folder
│   │   │   ├── workspace.py             ← KnowledgeItem, KnowledgeChunk (pgvector)
│   │   │   ├── workflow.py              ← Workflow, WorkflowRun, WorkflowRunStep
│   │   │   ├── fine_tune.py             ← TrainingDataset, FineTuneJob
│   │   │   └── settings.py             ← SystemSettings (singleton)
│   │   ├── services/
│   │   │   ├── embedding_service.py     ← embed_query_async/sync, OpenAI→Ollama fallback
│   │   │   ├── auth_service.py          ← get_or_create_oauth_user, make_tokens
│   │   │   └── workspace_service.py     ← knowledge item CRUD helpers
│   │   └── schemas/
│   │       ├── auth.py                  ← AccessTokenResponse, UserOut, OnboardRequest
│   │       ├── chat.py                  ← ChatCreate, MessageCreate, streaming events
│   │       └── ...
│   └── tests/
│       ├── conftest.py                  ← pytest fixtures: DB, app client, auth headers
│       ├── test_auth.py                 ← OAuth flow, token refresh, logout
│       ├── test_chats.py                ← chat CRUD, message pagination
│       ├── test_workflows.py            ← run lifecycle, ownership, resume/cancel
│       ├── test_fine_tune.py            ← dataset upload, job creation, cancellation
│       └── test_settings_sections.py    ← admin settings typed schema validation
│
└── frontend/
    └── src/
        ├── app/
        │   ├── chat/[id]/page.tsx        ← main chat UI, streaming message rendering
        │   ├── workflow/[id]/page.tsx     ← ReactFlow DAG editor
        │   ├── workflow/[id]/runs/page.tsx ← execution history, live status
        │   ├── workspace/
        │   │   ├── knowledge/page.tsx     ← file upload, embedding status
        │   │   ├── models/page.tsx        ← AI provider model selection
        │   │   ├── fine-tune/new/page.tsx ← LoRA training wizard
        │   │   └── prompts/page.tsx       ← system prompt library
        │   └── admin/
        │       ├── page.tsx              ← user management table
        │       └── analytics/page.tsx    ← DAU charts, system metrics
        ├── components/
        │   ├── chat/
        │   │   ├── MessageInput.tsx       ← image attach, voice, send
        │   │   ├── MessageList.tsx        ← streaming token render, tool-call display
        │   │   └── ChatNavbar.tsx         ← model selector, share, settings
        │   ├── workflow/
        │   │   ├── nodes/                 ← LLMNode, ToolNode, BranchNode, HumanNode ...
        │   │   ├── NodeConfigPanel.tsx    ← right-side config drawer
        │   │   └── NodePalette.tsx        ← drag-to-canvas node picker
        │   ├── canvas/MaskCanvas.tsx      ← image inpainting mask editor
        │   └── layout/
        │       ├── Sidebar.tsx            ← nav, chat list, folder tree
        │       └── SettingsModal.tsx      ← user preferences, API key entry
        └── lib/
            ├── hooks/
            │   ├── useWebSocket.ts        ← WS connect, first-message auth, reconnect
            │   └── useChat.ts             ← message state, streaming accumulation
            ├── api/
            │   ├── backendClient.ts       ← apiFetch wrapper (auth header, error norm)
            │   └── endpoints.ts           ← typed API endpoint constants
            └── store.ts                   ← localStorage-based global state (no external state lib)
```

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | Next.js (App Router) | 15 |
| UI library | React | 19 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | 3 |
| Workflow canvas | ReactFlow | — |
| Backend framework | FastAPI | latest |
| ORM | SQLAlchemy (async) | 2.0 |
| Migrations | Alembic | — |
| Schema validation | Pydantic | v2 |
| Database | PostgreSQL + pgvector | 16 |
| Cache / broker | Redis (hiredis) | 7 |
| Task queue | Celery | 5 |
| Auth | JWT (HS256) + OAuth 2.0 | — |
| AI providers | OpenAI, Anthropic, Google AI, Ollama | — |
| Rate limiting | SlowAPI (slowapi) | — |
| Infra | Docker Compose, Nginx | — |

---

## Quick Start

**Recommended: Docker infrastructure + native Next.js (hot reload)**

```bash
# 1. Clone
git clone https://github.com/<your-org>/umai.git && cd umai

# 2. Environment
cp backend/.env.example backend/.env
# Edit SECRET_KEY, SESSION_SECRET_KEY, and at least one AI provider key

cp frontend/.env.local.example frontend/.env.local
# INTERNAL_API_URL=http://localhost:8001  (already set in example)

# 3. Start infrastructure (PostgreSQL, Redis, FastAPI, Celery)
docker compose -f docker-compose.dev.yml up --build -d

# 4. Frontend with hot reload
cd frontend && npm install && npm run dev
# → http://localhost:3000
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API + Swagger | http://localhost:8001/docs |
| PostgreSQL | localhost:5434 |
| Redis | localhost:6380 |

**Optional: local Celery worker (for AI/image/embedding tasks outside Docker)**

```bash
cd backend
pip install -r requirements.txt
celery -A app.core.celery_app worker \
  -Q ai,image,knowledge,default \
  -c 2 --loglevel=info
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | **yes** | — | JWT signing key. `openssl rand -hex 32` |
| `SESSION_SECRET_KEY` | prod | — | Session middleware key, **must differ** from `SECRET_KEY` |
| `DATABASE_URL` | **yes** | `postgresql+asyncpg://umai:umai@localhost:5434/umai` | asyncpg driver required |
| `REDIS_URL` | **yes** | `redis://localhost:6380/0` | db0 for sessions/cache |
| `CELERY_BROKER_URL` | **yes** | `redis://localhost:6380/1` | db1 |
| `CELERY_RESULT_BACKEND` | **yes** | `redis://localhost:6380/2` | db2 |
| `BACKEND_URL` | **yes** | `http://localhost:8001` | OAuth callback base URL |
| `FRONTEND_URL` | **yes** | `http://localhost:3000` | Post-OAuth redirect target |
| `OPENAI_API_KEY` | opt | — | GPT-4o, DALL·E 3, text-embedding-3-small |
| `ANTHROPIC_API_KEY` | opt | — | Claude 3.5 / Sonnet / Haiku |
| `GOOGLE_API_KEY` | opt | — | Gemini 1.5 Pro / Flash |
| `XAI_API_KEY` | opt | — | Grok |
| `OLLAMA_URL` | opt | `http://localhost:11434` | Self-hosted models |
| `OLLAMA_EMBED_MODEL` | opt | `qwen3-embedding:8b` | Local embedding model |
| `GOOGLE_CLIENT_ID` | opt | — | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | opt | — | Google OAuth |
| `GITHUB_CLIENT_ID` | opt | — | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | opt | — | GitHub OAuth |
| `COMFYUI_URL` | opt | `http://localhost:8188` | ComfyUI image gen |
| `A1111_URL` | opt | `http://localhost:7860` | Automatic1111 image gen |
| `DEBUG` | opt | `false` | Enables Swagger UI; disables HTTPS enforcement |

> In production, the app **refuses to start** if `BACKEND_URL`/`FRONTEND_URL` uses HTTP, `SECRET_KEY` is the default value, or `SECRET_KEY` is under 32 characters. Warnings are not used — misconfiguration causes an immediate `RuntimeError`.

---

## Production Deployment

See [`DEPLOY.md`](DEPLOY.md) for a full step-by-step guide covering Oracle Cloud Free Tier, SSL setup, OAuth callback registration, and monitoring.

```bash
# Quick production start
cp backend/.env.example backend/.env
# Set SECRET_KEY, SESSION_SECRET_KEY, BACKEND_URL (https://), FRONTEND_URL (https://)

docker compose up --build -d
docker compose exec umai-backend alembic upgrade head
```

---

## License

MIT
