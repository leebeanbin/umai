import json

from redis.asyncio import Redis, from_url
from app.core.config import settings
from app.core.redis_keys import (
    key_access, key_session, key_user_cache,
    key_oauth_code, key_oauth_origin,
    key_ws_rate_limit,
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


async def get_pubsub_client() -> Redis:
    """pub/sub 전용 독립 Redis 클라이언트 생성. 사용 후 .aclose() 호출 필요."""
    return await from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=REDIS_SOCKET_CONNECT_TIMEOUT,
        socket_timeout=REDIS_SOCKET_TIMEOUT,
    )


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


async def oauth_code_set(code: str, payload_json: str):
    r = await get_redis()
    await r.setex(key_oauth_code(code), OAUTH_CODE_TTL, payload_json)


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
