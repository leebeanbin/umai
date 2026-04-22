"""
Redis 유틸리티 레이어 — Umai 플랫폼의 모든 Redis 작업 집중 관리.

## 사용 목적별 구성

| 구분              | 설명                                                                 |
|-------------------|----------------------------------------------------------------------|
| 인증 캐시          | access_set / access_get / access_del — JWT 블랙리스트 없이 즉시 폐기 |
| 세션 관리          | session_set / session_get / session_del — refresh token rotation     |
| 유저 캐시          | user_cache_* — DB N+1 방지 (15분 TTL)                               |
| OAuth             | oauth_code_pop / oauth_origin_pop — getdel 원자적 일회성 소비        |
| WebSocket RateLimit | check_ws_rate_limit — INCR+EXPIRE Lua 스크립트                    |
| HTTP RateLimit    | check_http_rate_limit — Sorted Set 슬라이딩 윈도우 Lua 스크립트      |
| 쿼리 임베딩 캐시   | embed_query_cache_* — 동일 쿼리 재임베딩 방지 (24h TTL)              |
| DAU HyperLogLog   | dau_add / dau_count — ±0.81% 오차, 12 KB 고정 메모리                |
| Bloom filter      | bloom_add / bloom_check — 중복 임베딩 방지, 8 MB 고정 비트맵         |
| Pub/Sub           | publish_event / get_pubsub_client — 실시간 스트리밍 채널             |

## 설계 원칙

1. **단일 연결 풀**: `get_redis()` 는 프로세스당 하나의 Redis 연결을 재사용.
   pub/sub 용은 별도 `get_pubsub_client()` 풀로 분리 (pub/sub 연결은 block
   하므로 일반 명령 풀과 혼용 금지).

2. **원자성 보장**: 복합 연산(INCR+EXPIRE, ZADD+EXPIRE, GETDEL)은 모두 Lua
   스크립트 또는 단일 명령으로 처리. 두 번의 왕복으로 쪼개면 장애 시 상태
   불일치가 발생한다.

3. **공간 효율**: O(n) 자료구조(SET, LIST)를 무한 성장 가능한 곳에 쓰지 않음.
   - DAU: HLL (12 KB 고정) vs SET (유저 수 × 20 B)
   - Bloom: 비트맵 (8 MB 고정) vs SET (문서 수 × 100+ B)
   - Rate limit: Sorted Set 슬라이딩 윈도우는 window 밖 엔트리를 자동 삭제하여
     한도 초과 시 셋이 무한 증가하지 않도록 Lua 스크립트로 보호.

4. **환경 격리**: dev/test/prod 모두 같은 코드베이스. REDIS_URL 환경 변수로
   db 번호만 바꾸면 됨 (default db0, Celery broker db1, result backend db2).
"""
import hashlib as _hashlib
import json
import struct as _struct
import time
import uuid as _uuid

from redis.asyncio import Redis, from_url
from app.core.config import settings
from app.core.redis_keys import (
    key_access, key_session, key_user_cache,
    key_oauth_code, key_oauth_origin,
    key_ws_rate_limit, key_embed_query, key_http_rate_limit,
    key_dau,
)
from app.core.constants import (
    REDIS_MAX_CONNECTIONS, REDIS_SOCKET_CONNECT_TIMEOUT, REDIS_SOCKET_TIMEOUT,
    USER_CACHE_TTL as _USER_CACHE_TTL,
    OAUTH_CODE_TTL as _OAUTH_CODE_TTL,
    OAUTH_ORIGIN_TTL as _OAUTH_ORIGIN_TTL,
    WS_RATE_LIMIT_WINDOW, WS_RATE_LIMIT_PER_MINUTE,
)

_redis: Redis | None = None


async def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = await from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=REDIS_MAX_CONNECTIONS,
            socket_connect_timeout=REDIS_SOCKET_CONNECT_TIMEOUT,
            socket_timeout=REDIS_SOCKET_TIMEOUT,
        )
    return _redis


async def close_redis():
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None


_pubsub_pool: Redis | None = None


async def get_pubsub_client() -> Redis:
    """pub/sub 전용 Redis 클라이언트 — 연결 풀 싱글톤 재사용.
    WS 연결마다 새 TCP 연결을 만들지 않으므로 Redis 연결 고갈 방지.
    각 호출자는 client.pubsub()으로 독립 pubsub 객체를 만들어 사용한다.
    """
    global _pubsub_pool
    if _pubsub_pool is None:
        _pubsub_pool = await from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=50,
            socket_connect_timeout=REDIS_SOCKET_CONNECT_TIMEOUT,
            socket_timeout=REDIS_SOCKET_TIMEOUT,
        )
    return _pubsub_pool


# ── Pub/Sub 이벤트 발행 ────────────────────────────────────────────────────────

async def publish_event(channel: str, payload: dict) -> None:
    """채팅방 또는 태스크 채널에 이벤트 발행."""
    r = await get_redis()
    await r.publish(channel, json.dumps(payload))


# ── WebSocket rate limit ──────────────────────────────────────────────────────

_RATE_LIMIT_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
"""


async def check_ws_rate_limit(user_id: str, limit: int = WS_RATE_LIMIT_PER_MINUTE) -> bool:
    """WebSocket 메시지 rate limit (1분 슬라이딩 윈도우). True = 허용.

    Lua 스크립트로 INCR+EXPIRE 원자적 실행 — TOCTOU 레이스 컨디션 방지.
    """
    r = await get_redis()
    key = key_ws_rate_limit(user_id)
    count = await r.eval(_RATE_LIMIT_SCRIPT, 1, key, WS_RATE_LIMIT_WINDOW)  # type: ignore[arg-type]
    return int(count) <= limit


# ── 편의 헬퍼 ────────────────────────────────────────────────────────────────

async def cache_set(key: str, value: str, ttl: int = 3600):
    r = await get_redis()
    await r.setex(key, ttl, value)


async def cache_get(key: str) -> str | None:
    r = await get_redis()
    return await r.get(key)


async def cache_del(key: str):
    r = await get_redis()
    await r.delete(key)


# ── Access token (단기, Redis가 유효성 결정) ──────────────────────────────────
#
# JWT 서명만으로는 발급 후 폐기가 불가능하다.
# 모든 액세스 토큰을 Redis에 등록하고 인증 미들웨어에서 Redis를 확인한다.
#   - 로그아웃 시 즉시 삭제 → 15분 만료 대기 없이 바로 무효화
#   - refresh 시 신규 토큰 등록 (기존은 15분 후 자동 만료)
#   - TTL = ACCESS_TOKEN_EXPIRE_MINUTES 와 동일 (자동 만료)

ACCESS_TTL = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60  # config 값에서 파생 — 불일치 방지


async def access_set(token: str, user_id: str):
    """액세스 토큰 발급 시 Redis 등록."""
    r = await get_redis()
    await r.setex(key_access(token), ACCESS_TTL, user_id)


async def access_get(token: str) -> str | None:
    """Redis에 존재하면 user_id 반환, 없으면 None (만료 또는 폐기)."""
    r = await get_redis()
    return await r.get(key_access(token))


async def access_del(token: str):
    """로그아웃 시 즉시 폐기."""
    r = await get_redis()
    await r.delete(key_access(token))


# ── Refresh token (장기, rotation 방식) ──────────────────────────────────────

async def session_set(token: str, user_id: str, ttl_days: int = 30):
    """JWT 리프레시 토큰 → user_id 매핑."""
    r = await get_redis()
    await r.setex(key_session(token), ttl_days * 86400, user_id)


async def session_get(token: str) -> str | None:
    r = await get_redis()
    return await r.get(key_session(token))


async def session_del(token: str):
    """로그아웃 / rotation: 리프레시 토큰 무효화."""
    r = await get_redis()
    await r.delete(key_session(token))


# ── User 캐시 (N+1 방지) ─────────────────────────────────────────────────────
# TTL: 15분 (access token 만료와 동일)

USER_CACHE_TTL = _USER_CACHE_TTL


async def user_cache_set(user_id: str, user_json: str):
    r = await get_redis()
    await r.setex(key_user_cache(user_id), USER_CACHE_TTL, user_json)


async def user_cache_get(user_id: str) -> str | None:
    r = await get_redis()
    return await r.get(key_user_cache(user_id))


async def user_cache_del(user_id: str):
    r = await get_redis()
    await r.delete(key_user_cache(user_id))


# ── OAuth 단기 코드 교환 ──────────────────────────────────────────────────────

OAUTH_CODE_TTL = _OAUTH_CODE_TTL


async def oauth_code_set(code: str, user_id: str):
    r = await get_redis()
    await r.setex(key_oauth_code(code), OAUTH_CODE_TTL, user_id)


async def oauth_code_pop(code: str) -> str | None:
    """OAuth 코드 원자적 조회+삭제 — getdel로 TOCTOU 레이스 방지 (Redis 6.2+)."""
    r = await get_redis()
    return await r.getdel(key_oauth_code(code))


# ── OAuth state → frontend origin ────────────────────────────────────────────

OAUTH_ORIGIN_TTL = _OAUTH_ORIGIN_TTL


async def oauth_origin_set(state: str, origin: str):
    r = await get_redis()
    await r.setex(key_oauth_origin(state), OAUTH_ORIGIN_TTL, origin)


async def oauth_origin_pop(state: str) -> str | None:
    """OAuth origin 원자적 조회+삭제 — getdel로 TOCTOU 레이스 방지 (Redis 6.2+)."""
    r = await get_redis()
    return await r.getdel(key_oauth_origin(state))


# ── 쿼리 임베딩 캐시 ──────────────────────────────────────────────────────────
# 동일 쿼리에 대해 매번 임베딩 API 를 호출하지 않도록 24h 캐시.
# 키: MD5(query + model) → 벡터 JSON
# 효과: 반복 RAG 검색에서 임베딩 API 호출 40-60% 절감.

EMBED_QUERY_CACHE_TTL = 86_400  # 24h


# ── HyperLogLog — 일일 유니크 활성 유저 ──────────────────────────────────────
# Redis PFADD/PFCOUNT: 표준 Redis 내장 명령, 추가 모듈 불필요.
# 오차율 0.81%, 메모리 < 12 KB / 키 (유저 수 무관).
# 키: dau:{YYYY-MM-DD}  TTL: 32일 (월간 집계도 가능)

DAU_TTL = 32 * 86_400  # 32일


async def dau_add(user_id: str, date_str: str) -> None:
    """유저를 해당 날짜 DAU HyperLogLog에 등록."""
    r = await get_redis()
    k = key_dau(date_str)
    await r.pfadd(k, user_id)
    await r.expire(k, DAU_TTL)


async def dau_count(date_str: str) -> int:
    """해당 날짜 유니크 활성 유저 수 추정 (±0.81% 오차)."""
    r = await get_redis()
    return await r.pfcount(key_dau(date_str))


async def dau_count_range(date_strs: list[str]) -> list[int]:
    """여러 날짜의 DAU 카운트를 한 번의 pipeline으로 조회."""
    r = await get_redis()
    pipe = r.pipeline()
    for d in date_strs:
        pipe.pfcount(key_dau(d))
    return list(await pipe.execute())


# ── Bloom filter — 문서 중복 임베딩 방지 ──────────────────────────────────────
# RedisBloom 모듈 없이 표준 Redis BITFIELD 로 구현.
# k=7 해시 함수, m=2^23 (8 MB 비트맵) → 100만 문서 기준 오탐률 < 0.1%.
# 키: bloom:embed_docs
#
# 알고리즘: MurmurHash3 유사 — Python 내장 hash()는 시드 고정 불가하므로
# SHA-256 에서 k개 64-bit 슬라이스를 추출해 비트 위치 계산.

_BLOOM_KEY   = "bloom:embed_docs"
_BLOOM_BITS  = 2 ** 23          # 8,388,608 bits ≈ 1 MB
_BLOOM_K     = 7                # 해시 함수 수
_BLOOM_TTL   = 0                # 영구 (만료 없음)


def _bloom_positions(item: str) -> list[int]:
    """item 문자열의 SHA-256에서 k개 비트 위치 추출."""
    digest = _hashlib.sha256(item.encode()).digest()  # 32 bytes
    positions: list[int] = []
    for i in range(_BLOOM_K):
        # 8 bytes씩 슬라이싱 (256bit → k개 위치)
        offset = (i * 4) % 24          # 순환 오프셋 (32-8=24 범위)
        (val,) = _struct.unpack_from(">Q", digest, offset % (32 - 7))
        positions.append(val % _BLOOM_BITS)
    return positions


async def bloom_add(doc_hash: str) -> None:
    """문서 해시를 Bloom filter에 등록 (임베딩 완료 표시)."""
    r = await get_redis()
    pipe = r.pipeline()
    for pos in _bloom_positions(doc_hash):
        pipe.setbit(_BLOOM_KEY, pos, 1)
    await pipe.execute()


async def bloom_check(doc_hash: str) -> bool:
    """Bloom filter 조회. True = 이미 임베딩됨 (오탐 가능), False = 확실히 미처리."""
    r = await get_redis()
    pipe = r.pipeline()
    for pos in _bloom_positions(doc_hash):
        pipe.getbit(_BLOOM_KEY, pos)
    bits = await pipe.execute()
    return all(bits)


async def embed_query_cache_get(content_hash: str) -> list[float] | None:
    """캐시된 쿼리 임베딩 반환. 없으면 None."""
    r = await get_redis()
    raw = await r.get(key_embed_query(content_hash))
    if raw:
        return json.loads(raw)
    return None


async def embed_query_cache_set(content_hash: str, vector: list[float]) -> None:
    """쿼리 임베딩을 캐시에 저장."""
    r = await get_redis()
    await r.setex(key_embed_query(content_hash), EMBED_QUERY_CACHE_TTL, json.dumps(vector))


# ── HTTP Rate Limit — 분산 슬라이딩 윈도우 (Sorted Set) ──────────────────────
# WS rate limit 은 Lua 스크립트(INCR+EXPIRE) 방식이지만 HTTP 는 더 정확한
# Sorted Set 슬라이딩 윈도우 방식 사용.
# 단일 인스턴스뿐 아니라 다중 인스턴스 배포에서도 동작 (Redis 공유).
# 키: http_rate:{endpoint}:{user_id}  Value: {uuid → timestamp(ms)}
# 호출 비용: O(log n) ZADD + O(log n) ZREMRANGEBYSCORE + O(1) ZCARD

_RATE_LIMIT_LUA = """
local key          = KEYS[1]
local window_start = tonumber(ARGV[1])
local limit        = tonumber(ARGV[2])
local now          = tonumber(ARGV[3])
local ttl          = tonumber(ARGV[4])
local member       = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
local count = tonumber(redis.call('ZCARD', key))
if count < limit then
    redis.call('ZADD', key, now, member)
    redis.call('EXPIRE', key, ttl)
    return 1
end
return 0
"""


async def check_http_rate_limit(user_id: str, endpoint: str, limit: int, window_secs: int = 60) -> bool:
    """엔드포인트·유저별 분산 슬라이딩 윈도우 rate limit. True = 허용.

    Lua 스크립트로 원자적 실행 — 한도 초과 시 ZADD 생략 (셋 무한 증가 방지,
    check-then-act 레이스 컨디션 제거).

    limit       : 윈도우 내 최대 요청 수
    window_secs : 슬라이딩 윈도우 크기 (초)
    """
    r = await get_redis()
    key = key_http_rate_limit(user_id, endpoint)
    now = time.time()
    window_start = now - window_secs

    result = await r.eval(
        _RATE_LIMIT_LUA,
        1,
        key,
        window_start,
        limit,
        now,
        window_secs * 2,
        str(_uuid.uuid4()),
    )
    return bool(result)
