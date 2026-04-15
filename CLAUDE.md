# Umai — Project Guidelines

Full-stack AI chat + workflow platform.
- **Backend**: FastAPI + PostgreSQL (pgvector) + Redis + Celery
- **Frontend**: Next.js 15 (App Router, React 19) + TypeScript + Tailwind CSS
- **AI**: OpenAI, Anthropic, Google AI, Ollama

---

## Commit Rules

- Never add `Co-Authored-By` trailers to commits.
- Always run `npx tsc --noEmit` and `npx eslint src --ext .ts,.tsx` before committing. Both must pass with 0 errors.
- Commit messages: imperative mood, concise, focused on *why* not *what*.

---

## Security Rules

### Authentication & Authorization
- **No dev bypass tokens.** `Bearer dev` or any hardcoded token that skips auth is forbidden — even under `DEBUG=True`.
- **Every endpoint must use `get_current_user` or `get_current_admin`.** No unauthenticated write endpoints.
- **Owner checks are mandatory.** After fetching a resource by ID, always verify `resource.owner_id == current_user.id` using `_assert_owner()`. Never return or mutate another user's resource.
- **Admin-only routes** must use `get_current_admin`, not just `get_current_user`.

### WebSocket
- WebSocket connections use **first-message auth**: accept connection, then wait up to 5 seconds for `{"type":"auth","token":"..."}`. Close with code 4001 on failure or timeout.
- Never put JWT tokens in WebSocket URL query parameters.
- Token revalidation interval is **60 seconds** (`WS_TOKEN_REVALIDATE_INTERVAL`).

### OAuth
- **Only `user_id` (string) is stored in Redis** for OAuth code exchange. Never store access/refresh tokens in Redis.
- OAuth code TTL is 5 minutes (`OAUTH_CODE_TTL`).

### CORS
- `localhost:3000` is included in CORS origins **only when `DEBUG=True`**.

### Session & Secrets
- `SessionMiddleware` uses `SESSION_SECRET_KEY`, not `SECRET_KEY`. These must be separate values.
- `SECRET_KEY` must be ≥ 32 characters in production.
- `FRONTEND_URL` and `BACKEND_URL` must use `https://` in production.

### File Uploads
- Always validate **magic bytes** against the declared `content_type` (PDF → `%PDF`, DOCX → `PK\x03\x04`).
- Always **sanitize filenames** with `_safe_filename()` to prevent path traversal.
- Enforce `ALLOWED_CONTENT_TYPES` before magic byte check.

### Input Validation
- Pydantic models for request bodies must use `model_config = ConfigDict(extra="forbid")` on admin/settings endpoints.
- Typed section models (not `dict[str, Any]`) for `SettingsPatch` fields.

### Rate Limiting
- **Every mutating endpoint and all AI-triggering endpoints must have a `@limiter.limit(...)` decorator.**
- Rate limit constants live in `backend/app/core/constants.py` (e.g., `RATE_CHAT_CREATE`, `RATE_WORKFLOW_RESUME`).
- Missing a rate limiter on a POST/PATCH/DELETE endpoint is a bug.

### Pagination
- List endpoints must have `page` and `limit` parameters with upper bounds (`le=1000` for page, `le=100` for limit).
- `GET /chats/{id}` loads at most `CHAT_MSG_MAX_LIMIT` (500) messages. Default is `CHAT_MSG_DEFAULT_LIMIT` (200).
- Never use `selectinload` on unbounded one-to-many relations without a row cap.

---

## Backend Code Rules

### FastAPI
- Route parameter order: path params → query params → `Body(...)` → `Depends(get_db)` → `Depends(get_current_user)`.
- Use `HTTPException` with specific status codes; never return 200 with an error payload.
- Use `ErrCode.XXX.raise_it(...)` for domain errors defined in `app/core/errors.py`.

### Database
- Use `AsyncSession` everywhere. Never use synchronous SQLAlchemy sessions.
- Commit only at the router layer or explicitly at service layer boundary. Don't scatter commits inside helper functions.
- UUID primary keys. Always pass `uuid.UUID(string_id)` when fetching by ID — don't pass raw strings to `db.get()`.

### Redis
- All Redis key names must go through `app/core/redis_keys.py`. No hardcoded key strings.
- Celery (synchronous Redis) tasks use `_get_task_redis()`. Async routes use `await get_redis()`.
- DALL-E / expensive AI calls cache their results in Redis with a TTL to prevent double billing on Celery retries.

### Celery Tasks
- AI tasks that call paid APIs (DALL-E, etc.) must check a Redis idempotency key at task start to avoid duplicate charges on retry.
- Pattern: `cache_key = key_task_dalle_cache(self.request.id)` → check → if hit, skip API call → if miss, call and cache with TTL.

---

## Frontend Code Rules

### React / Next.js
- **No `<img>` tags** for user-uploaded or external images. Use `next/image` `<Image>` or ensure the domain is in `next.config.ts` `remotePatterns`.
- **SSR hydration pattern**: if a value comes from `localStorage`, initialize state as `[]`/`null`/`false` in `useState`, then load in `useEffect`. Add `// eslint-disable-line react-hooks/set-state-in-effect` on the specific `setState(...)` line inside the effect body when needed.
- Never use `(e as Error).message` in catch blocks — use `e instanceof Error ? e.message : "fallback"`.
- All async user actions (delete, cancel, submit) must be wrapped in try/catch with user-facing error feedback.

### State Management
- Optimistic updates must include rollback on error (restore previous state in catch).
- When cancelling a resource, set status to `"cancelled"`, not `"failed"`.

### Icons & UI
- Use `lucide-react` components for all icons. Never use emoji characters (📊, ✅, etc.) as UI elements.
- Design: use Tailwind design system tokens (`bg-surface`, `text-text-primary`, `border-border`, `accent`, etc.). No hardcoded hex colors.

### API Calls
- All API calls go through `apiFetch` from `backendClient.ts`. Never use raw `fetch` with manual auth headers.
- WebSocket URLs never include the token as a query parameter. Send `{"type":"auth","token":"..."}` as the first message after `onopen`.

---

## Probabilistic Data Structures

When filtering at scale (deduplication, rate limiting, unique counts):
- **Bloom filter** for duplicate detection (chunk deduplication in knowledge ingestion).
- **HyperLogLog** for approximate unique counts (DAU tracking).
- **Redis Sorted Set** for sliding-window rate limiting.

These patterns are implemented in `backend/app/core/redis.py`. Extend them rather than reinventing.

---

## What NOT to Flag in Code Review

- Warnings from `@next/next/no-img-element` in `MaskCanvas.tsx` (canvas overlay — intentional `<img>`).
- `eslint-disable-line react-hooks/set-state-in-effect` comments on localStorage hydration patterns — these are correct and intentional.
- `react/display-name` on `forwardRef` components — suppressed project-wide.
