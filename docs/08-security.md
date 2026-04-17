# 보안 아키텍처

## 계층별 보안 모델

```
클라이언트
    │
    ├── HTTPS (TLS) — nginx에서 종료
    │
    ▼
nginx
    ├── Rate Limit (IP 기반 기본 방어)
    ├── CORS headers
    └── 내부 네트워크만 FastAPI에 접근
    │
    ▼
FastAPI
    ├── Layer 1: CORS (허용 오리진 제한)
    ├── Layer 2: Rate Limit (slowapi, Redis Sorted Set)
    ├── Layer 3: 인증 (Redis access token 검증)
    ├── Layer 4: 인가 (소유권 검증 _assert_owner)
    └── Layer 5: 입력 검증 (Pydantic, magic byte)
    │
    ▼
PostgreSQL / Redis
    └── 내부 네트워크만 접근 (포트 미노출)
```

---

## Rate Limiting

### 상수 중앙 관리

```python
# backend/app/core/constants.py

RATE_AUTH_REFRESH      = "30/minute"
RATE_CHAT_CREATE       = "60/minute"
RATE_CHAT_MESSAGE      = "120/minute"
RATE_WORKFLOW_RUN      = "10/minute"   # AI 비용 높음
RATE_TASK_IMAGE_GEN    = "5/minute"    # DALL-E — 비용 가장 높음
RATE_TASK_AI_AGENT     = "10/minute"
RATE_FOLDER_WRITE      = "30/minute"
```

비용에 따라 한도를 달리 설정합니다. DALL-E는 이미지당 과금이므로 5회/분으로 제한합니다.

### 적용 패턴

모든 POST/PATCH/DELETE 엔드포인트에 `@limiter.limit()` 데코레이터가 필요합니다:

```python
@router.post("/image/generate")
@limiter.limit(RATE_TASK_IMAGE_GEN)
async def enqueue_generate(request: Request, body: ImageGenerateRequest, ...):
    ...
```

`request: Request` 파라미터가 반드시 있어야 slowapi가 IP를 추출할 수 있습니다.

---

## 인가: 소유권 검증

```python
# backend/app/routers/deps.py (또는 각 라우터)

def _assert_owner(resource, user_id: uuid.UUID) -> None:
    """리소스 소유자가 현재 유저인지 확인. 아니면 404 반환."""
    if resource.owner_id != user_id:
        # 403 대신 404를 반환: 존재 자체를 숨김
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
```

**왜 403(Forbidden) 대신 404(Not Found)?**

403은 "리소스가 존재하지만 접근 권한이 없음"을 의미합니다.
이는 공격자에게 "이 ID의 리소스가 존재한다"는 정보를 줍니다.
404를 반환하면 리소스의 존재 여부 자체를 숨깁니다(enumeration 방지).

---

## 파일 업로드 보안

### Magic Byte 검증

```python
# backend/app/services/workspace_service.py

MAGIC_BYTES = {
    "application/pdf": b"%PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": b"PK\x03\x04",
}

def _validate_magic_bytes(raw: bytes, content_type: str) -> None:
    expected = MAGIC_BYTES.get(content_type)
    if expected and not raw[:len(expected)].startswith(expected):
        raise HTTPException(400, "File content does not match declared content type")
```

클라이언트가 보내는 `Content-Type` 헤더는 조작 가능합니다.
실제 파일 내용의 첫 바이트(magic bytes)로 파일 타입을 검증합니다.
예: `.exe` 파일을 `.pdf`로 위장해 업로드하는 공격 방어.

### 파일명 Sanitization

```python
# backend/app/services/workspace_service.py

def _safe_filename(filename: str) -> str:
    """경로 탐색 공격 방어."""
    # '../../../etc/passwd' 같은 경로 제거
    name = os.path.basename(filename)
    # 특수문자 제거 (영숫자, 하이픈, 언더스코어, 점만 허용)
    name = re.sub(r"[^\w\-.]", "_", name)
    return name[:255]  # 파일명 길이 제한
```

`../../../etc/passwd` 같은 경로 탐색 공격을 방어합니다.

---

## CORS 설정

```python
# backend/main.py

ALLOWED_ORIGINS = [settings.FRONTEND_URL]
if settings.DEBUG:
    ALLOWED_ORIGINS.append("http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,  # HttpOnly 쿠키 전송을 위해 필요
    allow_methods=["*"],
    allow_headers=["*"],
)
```

`localhost:3000`은 DEBUG=True일 때만 허용합니다.
프로덕션에서는 `FRONTEND_URL` 도메인만 허용합니다.

`allow_credentials=True`가 필요한 이유: refresh token을 HttpOnly 쿠키로 전송하려면
브라우저가 `credentials: "include"`로 요청해야 하고, 서버도 이를 허용해야 합니다.

---

## OAuth CSRF 방어

```python
# backend/app/routers/auth.py

@router.get("/oauth/google")
async def google_login(request: Request):
    state = secrets.token_urlsafe(OAUTH_STATE_BYTES)  # 랜덤 state 생성
    await oauth_origin_set(state, request.headers.get("origin", ""))  # Redis 저장
    return await oauth.google.authorize_redirect(request, callback_url, state=state)

@router.get("/oauth/google/callback")
async def google_callback(request: Request):
    token, state = await _authorize_oauth(oauth.google, request)
    origin = await oauth_origin_pop(state)  # state 검증 + 삭제
    if not origin:
        raise HTTPException(400, "Invalid state")
```

CSRF 공격자는 피해자를 `google_callback?code=...&state=X`로 유도할 수 있지만,
공격자가 만든 state X는 Redis에 없으므로 `oauth_origin_pop(X)`가 None을 반환합니다.

---

## 입력 검증: `extra="forbid"`

```python
# 관리자 설정 엔드포인트의 Pydantic 모델

class AdminSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")  # 알 수 없는 필드 거부

    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
```

`extra="forbid"`가 없으면 `{"openai_api_key": "key", "admin_override": true}` 같은
예상치 못한 필드가 무시됩니다. 명시적으로 거부해 예상치 못한 동작을 방지합니다.

---

## 페이지네이션 상한선

```python
# backend/app/routers/chats.py

page:  int = Query(1,  ge=1, le=1000)
limit: int = Query(20, ge=1, le=100)
```

상한선이 없으면 `?limit=999999`로 전체 데이터를 한 번에 요청할 수 있습니다.
OFFSET-based pagination에서 `OFFSET 999000 LIMIT 1000`은 PostgreSQL에게
999,001개 행을 스캔하게 합니다 (DoS 가능).

---

## WebSocket 보안 레이어

```
1. UUID 형식 검증      — chat_id가 UUID가 아니면 즉시 거부 (path traversal 방어)
2. First-message 인증  — 5초 타임아웃, 토큰 URL 미노출
3. Redis token 검증   — access:{token} 존재 확인
4. DB 멤버십 확인     — ChatMember 테이블에서 소속 확인
5. 연결 수 제한       — 사용자당 방당 최대 5개
6. 메시지 크기 제한   — 10 KB
7. Rate limit         — 60 msg/min (Lua INCR+EXPIRE)
8. 주기적 재검증      — 60초마다 Redis token 재확인
```

---

## Celery 태스크 소유권

```python
# 태스크 상태 조회 시 소유권 확인
async def get_task(task_id: str, current_user = Depends(get_current_user)):
    redis = await get_redis()
    owner = await redis.get(f"task_owner:{task_id}")
    if owner is None or owner != str(current_user.id):
        raise HTTPException(403, "Task not found or access denied")
```

Celery task_id는 UUID이므로 추측하기 어렵지만, 다른 사용자의 태스크를
조회할 수 없도록 Redis에 소유권을 저장합니다.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `backend/app/routers/deps.py` | `get_current_user`, `get_current_admin`, `_assert_owner` |
| `backend/app/core/redis.py` | Rate limit, token 저장/검증 |
| `backend/app/core/constants.py` | Rate limit 상수 |
| `backend/app/services/workspace_service.py` | Magic byte, filename sanitize |
| `backend/main.py` | CORS, middleware 설정 |
| `nginx/nginx.conf` | TLS, nginx-level rate limit |
