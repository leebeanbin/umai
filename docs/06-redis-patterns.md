# Redis 아키텍처 & 패턴

## 개요

Umai에서 Redis는 단순 캐시를 넘어 6가지 역할을 수행합니다:

```
Redis 사용 목적 맵
──────────────────
1. 인증 토큰 저장소   access:{token} → user_id
2. 세션 관리         session:{token} → user_id
3. OAuth 임시 코드   oauth:code:{code} → user_id
4. 유저 캐시        user:{id} → JSON  (DB N+1 방지)
5. Rate Limiting    ws_rate:{user} / http_rate:{endpoint}:{user}
6. Pub/Sub          chat:{id} / task:{user_id}
7. DAU 집계         dau:{date} (HyperLogLog)
8. Bloom Filter     bloom:embed_docs (중복 임베딩 방지)
9. 쿼리 임베딩 캐시  embed_query:{hash}
10. Celery 브로커    (db=1), result backend (db=2)
```

---

## 연결 풀 아키텍처

```python
# backend/app/core/redis.py

# 일반 명령용 풀 (싱글톤)
_redis: Redis | None = None
async def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = await from_url(settings.REDIS_URL, max_connections=20)
    return _redis

# Pub/Sub 전용 풀 (싱글톤)
_pubsub_pool: Redis | None = None
async def get_pubsub_client() -> Redis:
    global _pubsub_pool
    if _pubsub_pool is None:
        _pubsub_pool = await from_url(settings.REDIS_URL, max_connections=50)
    return _pubsub_pool
```

**왜 두 개의 풀?**

Redis pub/sub 상태에 진입한 연결은 `SUBSCRIBE`, `UNSUBSCRIBE`, `PING`만 허용됩니다.
`GET`, `SET` 같은 일반 명령을 섞으면 에러가 발생합니다.
두 풀을 분리해 상태 혼용 문제를 방지합니다.

**Celery는 별도 동기 클라이언트:**

```python
# backend/app/tasks/image.py
import redis as _sync_redis

def _get_task_redis() -> _sync_redis.Redis:
    """Celery 태스크(동기)용 — asyncio 사용 불가."""
    return _sync_redis.from_url(settings.REDIS_URL)
```

Celery 워커는 동기 컨텍스트입니다. `asyncio`를 사용하는 `get_redis()`를
Celery 태스크에서 호출하면 이벤트 루프 에러가 발생합니다.

---

## Lua 스크립트 원자성

Redis는 단일 스레드이므로 Lua 스크립트는 원자적으로 실행됩니다.
중간에 다른 클라이언트가 끼어들 수 없습니다.

### WebSocket Rate Limit (INCR + EXPIRE)

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

**문제:** INCR 후 EXPIRE를 두 번의 명령으로 나누면:
1. 프로세스 A: INCR → count=1
2. 프로세스가 죽음
3. EXPIRE 미실행 → 키가 영구히 남아 해당 유저는 영구 차단

**해결:** Lua 스크립트로 두 명령을 원자적으로 묶습니다.

### HTTP Rate Limit (Sorted Set 슬라이딩 윈도우)

```python
# backend/app/core/redis.py:357
_RATE_LIMIT_LUA = """
local key          = KEYS[1]
local window_start = tonumber(ARGV[1])   -- 현재시각 - 윈도우 크기
local limit        = tonumber(ARGV[2])
local now          = tonumber(ARGV[3])
local ttl          = tonumber(ARGV[4])
local member       = ARGV[5]             -- UUID (중복 방지)

redis.call('ZREMRANGEBYSCORE', key, 0, window_start)  -- 윈도우 밖 항목 제거
local count = tonumber(redis.call('ZCARD', key))       -- 현재 윈도우 내 요청 수

if count < limit then
    redis.call('ZADD', key, now, member)    -- 새 요청 추가
    redis.call('EXPIRE', key, ttl)
    return 1   -- 허용
end
return 0       -- 거부
```

**Sorted Set vs INCR+EXPIRE 비교:**

| 방식 | 정확도 | 메모리 | 사용처 |
|---|---|---|---|
| INCR+EXPIRE | 고정 윈도우 (경계에서 2배 허용 가능) | O(1) | WS (빠른 단순 체크) |
| Sorted Set | 슬라이딩 윈도우 (정확) | O(요청 수) | HTTP (더 엄격한 제한) |

INCR+EXPIRE는 고정 윈도우 방식이므로, 1분 한도=60이라면 59초에 60번 + 61초에 60번
= 2초 안에 120번 요청이 허용될 수 있습니다.

Sorted Set은 "지금 이 순간으로부터 과거 1분" 기준이므로 항상 정확합니다.

`ZADD key score member`에서 score는 timestamp(ms), member는 UUID입니다.
같은 timestamp에 여러 요청이 오면 member(UUID)로 구분합니다.

---

## HyperLogLog — DAU 집계

```python
# backend/app/core/redis.py

async def dau_add(user_id: str, date_str: str) -> None:
    r = await get_redis()
    k = key_dau(date_str)          # "dau:{date_str}" — redis_keys.py에서 관리
    await r.pfadd(k, user_id)      # PFADD
    await r.expire(k, 32 * 86400)

async def dau_count(date_str: str) -> int:
    r = await get_redis()
    return await r.pfcount(key_dau(date_str))   # PFCOUNT
```

**HyperLogLog를 사용하는 이유:**

DAU를 정확하게 세려면 "오늘 방문한 유저 ID 전체"를 저장해야 합니다.
유저 100만 명 × UUID 16바이트 = 16 MB/day

HyperLogLog는 확률적 자료구조입니다:
- 메모리: 12 KB 고정 (유저 수에 무관)
- 오차율: ±0.81%
- 명령: O(1) 삽입, O(1) 조회

100만 DAU에서 ±8,100명의 오차는 대시보드용으로 충분히 정확합니다.

```python
# 여러 날짜의 DAU를 파이프라인으로 한 번에 조회
async def dau_count_range(date_strs: list[str]) -> list[int]:
    r = await get_redis()
    pipe = r.pipeline()
    for d in date_strs:
        pipe.pfcount(key_dau(d))
    return list(await pipe.execute())
```

파이프라인으로 N번의 왕복 대신 1번의 왕복으로 N개 결과를 조회합니다.

---

## Bloom Filter — 중복 임베딩 방지

```python
# backend/app/core/redis.py:298

_BLOOM_KEY  = "bloom:embed_docs"
_BLOOM_BITS = 2 ** 23   # 8,388,608 bits ≈ 1 MB
_BLOOM_K    = 7         # 해시 함수 수

def _bloom_positions(item: str) -> list[int]:
    """SHA-256에서 k개 비트 위치 추출."""
    digest = hashlib.sha256(item.encode()).digest()  # 32 bytes
    positions = []
    for i in range(_BLOOM_K):
        offset = (i * 4) % 24
        (val,) = struct.unpack_from(">Q", digest, offset % (32 - 7))
        positions.append(val % _BLOOM_BITS)
    return positions

async def bloom_add(doc_hash: str) -> None:
    pipe = r.pipeline()
    for pos in _bloom_positions(doc_hash):
        pipe.setbit(_BLOOM_KEY, pos, 1)    # SETBIT
    await pipe.execute()

async def bloom_check(doc_hash: str) -> bool:
    pipe = r.pipeline()
    for pos in _bloom_positions(doc_hash):
        pipe.getbit(_BLOOM_KEY, pos)       # GETBIT
    bits = await pipe.execute()
    return all(bits)   # 모든 비트가 1이면 "이미 처리됨"
```

**동작 원리:**
- 삽입: 7개 해시값으로 7개 비트 위치를 계산해 1로 설정
- 조회: 7개 위치의 비트가 모두 1이면 "이미 삽입된 것으로 추정"
- 오탐(False Positive): 다른 아이템이 우연히 같은 비트 조합을 가질 수 있음 (0.1%)
- 미탐(False Negative): 없음. "없다"고 말하면 확실히 없음

**100만 문서 기준 수학:**
- m=8,388,608 bits, k=7, n=1,000,000
- 예상 오탐률 = (1 - e^(-kn/m))^k ≈ 0.008% (0.1% 미만)

RedisBloom 모듈 없이 표준 `BITFIELD`/`SETBIT`/`GETBIT` 명령으로 구현합니다.

---

## OAuth GETDEL 패턴

```python
# backend/app/core/redis.py:227
async def oauth_code_pop(code: str) -> str | None:
    """원자적 조회+삭제 (Redis 6.2+)"""
    return await r.getdel(key_oauth_code(code))
```

`GET` + `DEL` 두 명령으로 나누면:
```
클라이언트 A: GET code → "user123"
클라이언트 B: GET code → "user123"  ← 같은 코드로 두 번 로그인 가능!
클라이언트 A: DEL code
클라이언트 B: DEL code
```

`GETDEL`은 Redis 6.2에서 추가된 원자적 GET+DELETE 명령입니다.
코드를 한 번만 소비할 수 있게 보장합니다.

---

## Redis 키 네임스페이스

```python
# backend/app/core/redis_keys.py

def key_access(token: str) -> str:
    return f"access:{token}"

def key_session(token: str) -> str:
    return f"session:{token}"

def key_user_cache(user_id: str) -> str:
    return f"user:{user_id}"

def key_chat_channel(chat_id: str) -> str:
    return f"chat:{chat_id}"

def key_workflow_suspend(run_id: str) -> str:
    return f"workflow:suspend:{run_id}"

def key_task_dalle_cache(task_id: str) -> str:
    return f"dalle_cache:{task_id}"
```

모든 키를 `redis_keys.py`에 집중 관리합니다.
하드코딩된 문자열이 코드 전체에 흩어지면 오타나 충돌을 찾기 어렵습니다.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `backend/app/core/redis.py` | 모든 Redis 연산 구현 |
| `backend/app/core/redis_keys.py` | 키 네임스페이스 정의 |
| `backend/app/core/constants.py` | TTL, 한도 상수 |
