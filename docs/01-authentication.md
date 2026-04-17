# 인증 시스템 (Authentication)

## 개요

Umai는 소셜 로그인(OAuth 2.0)만 지원합니다. 이메일/패스워드 방식을 제거한 이유는 세 가지입니다:
1. 비밀번호 해싱·저장·분실 처리 로직이 없어도 됨
2. OAuth provider가 MFA와 계정 보안을 위임 처리
3. 포트폴리오 프로젝트에서 실제 서비스처럼 동작하는 SSO 흐름 시연 가능

---

## 전체 흐름

```
브라우저                 Next.js              FastAPI              Redis / DB
   │                       │                     │                     │
   │──GET /auth/oauth/─────▶│                     │                     │
   │  google               │──GET /api/v1/auth/──▶│                     │
   │                       │  oauth/google        │─ oauth_origin_set──▶│ (state→origin, 5min TTL)
   │◀──302 Google Auth URL─┤◀────────────────────┤                     │
   │                       │                     │                     │
   │──[Google 로그인]──────▶│(Google 처리)         │                     │
   │                       │                     │                     │
   │──GET /auth/oauth/─────▶│                     │                     │
   │  google/callback       │──GET /api/v1/auth/──▶│                     │
   │  ?code=...&state=...   │  oauth/google/cb    │─ oauth_origin_pop──▶│ (state 검증 + 삭제)
   │                       │                     │─── DB upsert user ──▶│
   │                       │                     │─── oauth_code_set ──▶│ (code→user_id, 5min)
   │◀──302 /auth/callback───┤◀──302 redirect──────┤                     │
   │   ?code=ONE_TIME_CODE  │                     │                     │
   │                       │                     │                     │
   │──POST /api/v1/auth/────▶│                     │                     │
   │  token/exchange        │──POST /api/v1/auth/─▶│                     │
   │  body: {code}          │  token/exchange     │─ oauth_code_pop ───▶│ (code 소비 + 삭제)
   │                       │                     │─ access_set ────────▶│ (token→user_id)
   │                       │                     │─ session_set ───────▶│ (refresh→user_id)
   │◀──{access_token}───────┤◀──{access_token}─────┤                     │
   │   Set-Cookie: refresh  │                     │                     │
```

---

## 토큰 이중 구조

### Access Token (단기, 15분)

```python
# backend/app/core/redis.py:158
async def access_set(token: str, user_id: str):
    r = await get_redis()
    await r.setex(key_access(token), ACCESS_TTL, user_id)
```

**왜 Redis에 저장하나?**

JWT는 서명 검증만으로 유효성을 판단하므로, 발급 후 폐기가 불가능합니다.
로그아웃해도 15분 동안 해당 토큰으로 API 호출이 가능해집니다.

해결책: 모든 액세스 토큰을 Redis에 등록하고, 인증 미들웨어에서 Redis를 확인합니다.
- 로그아웃 → `access_del(token)` → 즉시 무효화
- 15분 후 자동 만료 (Redis TTL)

```python
# backend/app/routers/deps.py — 모든 인증 요청의 검증 경로
async def get_current_user(credentials, db):
    user_id = await access_get(token)   # Redis 조회
    if not user_id:
        raise HTTPException(401)        # 만료 또는 폐기된 토큰
```

### Refresh Token (장기, 30일, HttpOnly Cookie)

```python
# backend/app/routers/auth.py:57
def _set_refresh_cookie(response, token):
    response.set_cookie(
        key="umai_refresh",
        httponly=True,          # JS에서 접근 불가 (XSS 방어)
        secure=not settings.DEBUG,  # 프로덕션: HTTPS 전용
        samesite="strict",      # CSRF 방어
        max_age=REFRESH_COOKIE_MAX_AGE,
    )
```

**토큰 저장 위치 선택 이유:**
- Access token: `localStorage` (JS에서 Authorization 헤더에 직접 삽입)
- Refresh token: HttpOnly Cookie (JS 접근 불가 → XSS로 탈취 불가)

이중 구조를 쓰는 이유: Access token이 XSS로 탈취되더라도 15분 후 만료됩니다.
Refresh token은 쿠키에만 있고 JS 코드는 접근할 수 없으므로 장기 세션은 안전합니다.

### Token Rotation

```
클라이언트                                    서버
    │                                          │
    │──POST /auth/refresh (Cookie: refresh)───▶│
    │                                          │ session_get(old_refresh) → user_id
    │                                          │ session_del(old_refresh)  ← 기존 무효화
    │                                          │ make_tokens(user_id) → new_access, new_refresh
    │                                          │ access_set(new_access, user_id)
    │                                          │ session_set(new_refresh, user_id)
    │◀──{access_token: new} Set-Cookie: new────┤
```

Refresh token을 재사용 불가능하게 만드는 이유: refresh token이 탈취되더라도
다음 rotation 시 기존 토큰이 무효화되므로 공격자의 세션이 끊깁니다.

---

## OAuth 코드 교환 패턴

```python
# backend/app/core/redis.py:227
async def oauth_code_pop(code: str) -> str | None:
    """OAuth 코드 원자적 조회+삭제 — getdel로 TOCTOU 레이스 방지."""
    r = await get_redis()
    return await r.getdel(key_oauth_code(code))
```

`getdel` 명령 하나로 조회+삭제를 원자적으로 처리합니다.
`GET` 후 `DEL` 두 번으로 나누면, 두 요청이 동시에 같은 코드를 사용하는 경우
(race condition) 둘 다 성공할 수 있습니다.

**OAuth state 파라미터 검증:**

```python
# backend/app/routers/auth.py
async def _authorize_oauth(oauth_client, request):
    token = await oauth_client.authorize_access_token(request)
    state = request.query_params.get("state")
    if not state:
        raise HTTPException(400, "Missing OAuth state")
    return token, state
```

state는 CSRF 공격 방어에 사용됩니다. Google 로그인 시작 전에 서버가 랜덤 state를 생성해
Redis에 저장하고, callback에서 검증합니다. 공격자가 피해자를 자신의 OAuth callback URL로
유도하더라도 state가 일치하지 않아 거부됩니다.

---

## 유저 캐시 (N+1 방지)

```
요청마다 DB 조회:  GET /api → DB SELECT user WHERE id = ?   (매 요청 ~2-5ms)
캐시 적용:         GET /api → Redis GET user_cache:{id}      (캐시 히트 ~0.1ms)
                              → 미스 시 DB 조회 + 캐시 저장 (TTL 15min)
```

```python
# backend/app/routers/deps.py
async def get_current_user(credentials, db):
    cached = await user_cache_get(user_id)
    if cached:
        return UserOut.model_validate_json(cached)   # DB 우회
    user = await db.get(User, uuid.UUID(user_id))
    await user_cache_set(user_id, user.model_dump_json())
    return user
```

TTL을 15분으로 설정한 이유: access token 만료 시간과 동일하므로, 토큰이 만료되면
캐시도 자동으로 만료됩니다. 프로필 업데이트 시 `user_cache_del(user_id)` 호출로 즉시 무효화.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `backend/app/routers/auth.py` | OAuth 엔드포인트, refresh, logout |
| `backend/app/routers/deps.py` | `get_current_user`, `get_current_admin` DI |
| `backend/app/services/auth_service.py` | `get_or_create_oauth_user`, `make_tokens` |
| `backend/app/core/redis.py` | `access_*`, `session_*`, `oauth_code_*` |
| `backend/app/core/security.py` | JWT encode/decode |
| `frontend/src/lib/api/backendClient.ts` | 자동 토큰 갱신, 401 interceptor |
