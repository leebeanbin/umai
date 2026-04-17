# WebSocket 실시간 통신

## 개요

Umai는 두 종류의 WebSocket 채널을 운영합니다:

| 채널 | 엔드포인트 | 용도 |
|---|---|---|
| 채팅방 이벤트 | `WS /ws/chat/{chat_id}` | 메시지 저장 완료 알림, 멤버 이벤트 |
| 태스크 알림 | `WS /ws/tasks` | AI/이미지 태스크 완료 알림 |

---

## 인증 아키텍처: First-Message Auth

WebSocket URL에 토큰을 쿼리 파라미터로 넣지 않습니다.

**왜?** URL은 서버 로그, nginx 액세스 로그, 브라우저 히스토리에 평문으로 기록됩니다.
`wss://api.umai.ai/ws/chat/123?token=eyJhb...` 형태는 토큰이 로그에 남습니다.

대신 연결 수락 후 첫 메시지로 인증합니다:

```
클라이언트                           서버
    │                                 │
    │──WebSocket UPGRADE──────────────▶│ accept()
    │                                 │
    │──{"type":"auth","token":"..."}──▶│ wait_for(5s)
    │                                 │ access_get(token) → user_id
    │                                 │ check_membership(chat_id, user_id)
    │                                 │
    │◀────── 연결 유지 ────────────────┤
    │                                 │
    │◀────── 실시간 이벤트 ────────────┤ Redis pub/sub 구독
```

```python
# backend/app/routers/ws.py:127
await websocket.accept()
try:
    raw_auth = await asyncio.wait_for(
        websocket.receive_text(), timeout=5.0   # 5초 타임아웃
    )
    auth_msg = json.loads(raw_auth)
    if auth_msg.get("type") != "auth":
        await websocket.close(code=4001)
        return
    token = auth_msg.get("token", "")
except (asyncio.TimeoutError, json.JSONDecodeError):
    await websocket.close(code=4001)
    return
```

---

## Redis Pub/Sub 아키텍처

```
FastAPI 라우터                Redis               WebSocket 클라이언트
    │                           │                         │
    │ POST /chats/{id}/messages │                         │
    │ 저장 완료 후:              │                         │
    │──publish(chat:{id}, ──────▶│                         │
    │   {type:"messages_saved"}) │                         │
    │                           │──▶ 구독자에게 전달 ───────▶│
    │                           │   (모든 WS 연결에 브로드캐스트)
```

**단일 Redis 연결 풀 사용 이유:**

```python
# backend/app/core/redis.py:83
async def get_pubsub_client() -> Redis:
    """pub/sub 전용 Redis 클라이언트 — 연결 풀 싱글톤 재사용.
    WS 연결마다 새 TCP 연결을 만들지 않으므로 Redis 연결 고갈 방지.
    """
    global _pubsub_pool
    if _pubsub_pool is None:
        _pubsub_pool = await from_url(...)
    return _pubsub_pool
```

WebSocket 연결마다 새 Redis 연결을 생성하면, 1000명이 동시 접속 시
Redis 연결도 1000개가 됩니다. 싱글톤 풀을 재사용하면 연결 수를 50개로 제한합니다.

단, pub/sub 연결과 일반 명령 연결은 분리해야 합니다.
pub/sub 상태의 연결은 subscribe/unsubscribe/psubscribe 명령만 허용되므로
일반 SET/GET 명령을 섞으면 에러가 발생합니다.

---

## 주기적 토큰 재검증

```python
# backend/app/routers/ws.py:95
async def _periodic_token_revalidate(websocket, token, interval_s=60):
    """60초마다 토큰 재검증 — 로그아웃/만료 후 stale 연결 종료."""
    while True:
        await asyncio.sleep(60)
        uid = await access_get(token)
        if not uid:
            await websocket.close(code=4001)
            return
```

문제: WebSocket은 연결을 맺으면 토큰 만료 후에도 계속 살아있을 수 있습니다.
해결: 60초마다 Redis에서 토큰 유효성을 확인합니다. 로그아웃 시 `access_del(token)`으로
Redis에서 즉시 제거되므로, 다음 검증 주기(최대 60초)에 연결이 끊깁니다.

---

## Rate Limiting

```python
# backend/app/core/redis.py:110
_RATE_LIMIT_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
"""
```

WS rate limit는 Lua 스크립트로 INCR + EXPIRE를 원자적으로 처리합니다.

**왜 Lua 스크립트?**
1. INCR (카운트 증가)
2. 만약 count == 1이면 EXPIRE (TTL 설정)

이 두 연산 사이에 프로세스가 죽으면 TTL이 설정되지 않아 카운터가 영구히 남습니다.
Lua 스크립트는 Redis 내에서 원자적으로 실행되어 이 문제를 방지합니다.

rate limit 초과 시 에러 메시지를 보내는 대신 연결을 종료합니다:

```python
# backend/app/routers/ws.py:173
if not await check_ws_rate_limit(user_id):
    await websocket.close(code=4029)   # 429 Too Many Requests
    break
```

연결을 열어둔 채 에러만 보내면 클라이언트가 계속 메시지를 보낼 수 있습니다.
close(4029)로 연결을 끊으면 클라이언트가 명확히 인지하고 재연결 대기를 구현할 수 있습니다.

---

## 연결 수 제한

```python
# backend/app/routers/ws.py:153
if manager.user_count(chat_id, user_id) >= MAX_CONNECTIONS_PER_USER_PER_ROOM:
    await websocket.close(code=4029)
    return
```

같은 유저가 같은 채팅방에 탭을 5개 이상 열면 거부합니다.
이유: pub/sub은 채팅방 채널 구독자 전체에게 브로드캐스트하므로,
한 유저가 탭 100개를 열면 메시지마다 100번의 WS 전송이 발생합니다.

---

## 프론트엔드 연결 패턴

```typescript
// frontend/src/lib/hooks/useWebSocket.ts
const ws = new WebSocket(`wss://api.umai.ai/ws/chat/${chatId}`);

ws.onopen = () => {
    // 연결 직후 첫 메시지로 인증
    ws.send(JSON.stringify({
        type: "auth",
        token: getStoredToken()
    }));
};

ws.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === "messages_saved") {
        // 저장 완료 → UI 업데이트
    }
};
```

---

## 종료 코드 의미

| 코드 | 의미 |
|---|---|
| 4001 | 인증 실패 (토큰 없음/만료/5초 타임아웃) |
| 4003 | 권한 없음 (채팅 멤버 아님, UUID 형식 오류) |
| 4008 | 메시지 크기 초과 (10 KB) |
| 4029 | Rate limit / 연결 수 초과 |

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `backend/app/routers/ws.py` | WS 엔드포인트, 인증, rate limit |
| `backend/app/core/redis.py` | `check_ws_rate_limit`, `publish_event`, `get_pubsub_client` |
| `frontend/src/lib/hooks/useWebSocket.ts` | `useChatSocket`, `useTaskSocket` 훅 |
