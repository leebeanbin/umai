# Umai — AI Platform

> Open-source AI platform integrating multi-provider chat, RAG knowledge base, workflow automation, and image generation.

![Next.js](https://img.shields.io/badge/Next.js_15-black?logo=next.js) ![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-316192?logo=postgresql&logoColor=white) ![Redis](https://img.shields.io/badge/Redis_7-DC382D?logo=redis&logoColor=white) ![Celery](https://img.shields.io/badge/Celery_5-37814A?logo=celery&logoColor=white) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

| Area | Capability |
|---|---|
| **Chat** | Streaming AI responses, image attachments, mask editor, chat sharing |
| **AI Agent** | Tool-use loop (web search, Python execution, knowledge retrieval), Celery parallel execution |
| **Knowledge Base** | PDF/DOCX/TXT/MD upload → auto parse → chunk → embed (background via Celery) |
| **Image Generation** | DALL·E 3, ComfyUI, Automatic1111 (A1111) integration |
| **Workflow Engine** | Visual DAG builder — LLM, Tool, Branch, HumanNode, Output nodes |
| **Authentication** | Email/password + Google/GitHub OAuth, JWT (15min) + Refresh Token (30d) |
| **Admin Dashboard** | User management, DAU analytics, system settings, fine-tuning |
| **i18n** | Korean / English |

---

## Architecture

```
Browser
  └─ Next.js 15  (port 3000)
       └─ /api/* rewrite proxy ──→ FastAPI  (port 8000)
                                      ├─ PostgreSQL 16 + pgvector  (primary data + vector search)
                                      ├─ Redis 7                   (sessions, cache, pub/sub, Celery broker)
                                      └─ Celery Workers            (ai / image / knowledge / default queues)
```

**Key design decisions:**
- The browser only ever talks to one origin — `/api/*` relative paths are silently rewritten by Next.js to the backend. No CORS complexity on the client.
- Four independent Celery queues keep AI, image, and embedding workloads from blocking each other.
- Redis serves triple duty: session cache (db0), Celery broker (db1), task results (db2).

---

## Technical Highlights

### Security Architecture
A full security audit was performed, resulting in 9 hardening fixes:

| Fix | Detail |
|---|---|
| WebSocket auth | JWT is **never** sent in the URL query string. Instead, the server accepts the connection and waits up to 5 seconds for a first-message `{"type":"auth","token":"..."}` — preventing token leakage into Nginx access logs and browser history. |
| OAuth code flow | The authorization code stored in Redis contains only the `user_id` string. Actual tokens are generated at `token_exchange` time — a Redis breach cannot yield usable credentials. |
| Rate limiting | Every mutating endpoint uses `slowapi` decorators. Limits are centralized in `constants.py` for easy adjustment. |
| File upload | Magic-byte validation (e.g., `%PDF` for PDFs) is checked against the `Content-Type` header. Filenames are sanitized against path traversal before storage. |
| Input validation | Admin `SettingsPatch` uses typed Pydantic section models with `extra="forbid"` — arbitrary keys are rejected at the schema layer. |
| Secrets | `SESSION_SECRET_KEY` and `SECRET_KEY` are enforced as separate values. Production startup fails fast if `FRONTEND_URL` uses HTTP or `SECRET_KEY` is under 32 characters. |

### Workflow Engine
A visual DAG builder where each node is a typed step executed by Celery workers:

```
InputNode → LLMNode → BranchNode ──(condition=true)──→ ToolNode → OutputNode
                              └──(condition=false)──→ HumanNode (waits for approval)
```

- **HumanNode** suspends the run, stores state in Redis, and resumes when a human approves/rejects via API — enabling human-in-the-loop AI pipelines.
- Branch edges use `sourceHandle` IDs to route to different downstream nodes, not simple boolean splits.
- Run state is persisted in PostgreSQL (`WorkflowRun` + `WorkflowRunStep`) so execution history survives worker restarts.

### Probabilistic Data Structures (Redis)
Chosen for O(1) space-bounded operations at scale — a simple `SET` or counter would grow unbounded with users:

| Structure | Use case | Why not a simpler approach |
|---|---|---|
| **Bloom filter** | Prevent duplicate chunk embeddings in the RAG pipeline | A `SET` of all chunk hashes would grow indefinitely; Bloom filter uses fixed 2²³ bits with k=7 hash functions |
| **HyperLogLog** | Daily Active User count | A `SET` of user IDs per day would be O(n) space; HLL gives ±0.8% accuracy in 12 KB |
| **Sorted Set + Lua** | Sliding-window distributed rate limiting | A simple counter resets at fixed intervals; Sorted Set enables a true sliding window. Lua script makes the check-and-increment atomic, preventing race conditions under concurrent requests |

### Semantic Search — pgvector HNSW
```
1. Query → embed (OpenAI / local model, cached in Redis)
2. HNSW index scan (approximate nearest neighbor, sub-linear)
3. Fallback to JSONB cosine similarity scan if HNSW unavailable
```
Embedding results are cached in Redis to avoid redundant API calls on repeated queries.

### Idempotent Celery Tasks
DALL·E and other paid-API tasks cache their result in Redis keyed by `task_id` with a 2-hour TTL. On retry, the worker reads the cached result instead of making a second API call — preventing double billing.

### Real-time Streaming
```
FastAPI task  →  Redis PUBLISH  →  WebSocket handler  →  Browser
```
Each chat/workflow run publishes incremental events to a Redis channel. The WebSocket handler subscribes and streams chunks to the client without polling.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS |
| Backend | FastAPI, SQLAlchemy 2.0 (async), Alembic, Pydantic v2 |
| Database | PostgreSQL 16 + pgvector extension |
| Cache / Broker | Redis 7 (hiredis) |
| Task Queue | Celery 5 |
| AI Providers | OpenAI, Anthropic, Google AI, Ollama (self-hosted) |
| Auth | JWT + HTTPOnly refresh cookie, Google/GitHub OAuth 2.0 |
| Infra | Docker Compose, Nginx |

---

## Local Development

**Recommended: Docker infra + native Next.js (hot reload)**

```bash
# 1. Environment variables
cp backend/.env.example backend/.env
# Required: SECRET_KEY, BACKEND_URL, FRONTEND_URL

cp frontend/.env.local.example frontend/.env.local
# INTERNAL_API_URL defaults to http://localhost:8001

# 2. Start infrastructure (Postgres, Redis, backend, Celery)
docker compose -f docker-compose.dev.yml up --build -d

# 3. Frontend with hot reload
cd frontend && npm install && npm run dev
# → http://localhost:3000

# 4. (Optional) Local Celery worker for AI/image/embedding tasks
cd backend
pip install -r requirements.txt
celery -A app.core.celery_app worker -Q image,ai,knowledge,default -c 2 --loglevel=info
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8001 |
| Swagger Docs | http://localhost:8001/docs |
| PostgreSQL | localhost:5434 |
| Redis | localhost:6380 |

---

## OAuth Setup

Google and GitHub OAuth callbacks must point to the **backend URL** directly.

**Google** — [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
```
Redirect URI: http://localhost:8001/api/v1/auth/oauth/google/callback
```

**GitHub** — [GitHub Developer Settings](https://github.com/settings/applications/new):
```
Authorization callback URL: http://localhost:8001/api/v1/auth/oauth/github/callback
```

---

## Key Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `SECRET_KEY` | **required** | JWT signing key — `openssl rand -hex 32` |
| `SESSION_SECRET_KEY` | — | Session middleware key (separate from `SECRET_KEY`) |
| `DATABASE_URL` | `postgresql+asyncpg://umai:umai@localhost:5434/umai` | Async driver required |
| `REDIS_URL` | `redis://localhost:6380/0` | |
| `BACKEND_URL` | `http://localhost:8001` | Used to construct OAuth callback URIs |
| `FRONTEND_URL` | `http://localhost:3000` | OAuth redirect target after login |
| `OPENAI_API_KEY` | — | GPT-4o, DALL·E |
| `ANTHROPIC_API_KEY` | — | Claude models |
| `GOOGLE_AI_API_KEY` | — | Gemini models |
| `OLLAMA_URL` | `http://localhost:11434` | Self-hosted models |

---

## Production Deployment

```bash
cp backend/.env.example backend/.env
# Set SECRET_KEY, SESSION_SECRET_KEY, POSTGRES_PASSWORD, BACKEND_URL (https://), FRONTEND_URL (https://)

docker compose up --build -d

# DB migrations
docker compose exec umai-backend alembic upgrade head
```

> In production, the server enforces HTTPS for both `BACKEND_URL` and `FRONTEND_URL` at startup. An HTTP value will cause an immediate `RuntimeError`.

---

## Common Commands

```bash
# View logs
docker logs umai-backend -f

# Run DB migrations
docker compose -f docker-compose.dev.yml exec umai-backend alembic upgrade head

# Full reset (deletes DB data)
docker compose -f docker-compose.dev.yml down -v

# TypeScript check
cd frontend && npx tsc --noEmit

# Lint
cd frontend && npx eslint src --ext .ts,.tsx
```

---

## License

MIT
