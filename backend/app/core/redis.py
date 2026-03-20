from redis.asyncio import Redis, from_url
from app.core.config import settings

_redis: Redis | None = None


async def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = await from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def close_redis():
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None


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

ACCESS_TTL = 60 * 15  # 15분 — config.ACCESS_TOKEN_EXPIRE_MINUTES 와 동기화


async def access_set(token: str, user_id: str):
    """액세스 토큰 발급 시 Redis 등록."""
    r = await get_redis()
    await r.setex(f"access:{token}", ACCESS_TTL, user_id)


async def access_get(token: str) -> str | None:
    """Redis에 존재하면 user_id 반환, 없으면 None (만료 또는 폐기)."""
    r = await get_redis()
    return await r.get(f"access:{token}")


async def access_del(token: str):
    """로그아웃 시 즉시 폐기."""
    r = await get_redis()
    await r.delete(f"access:{token}")


# ── Refresh token (장기, rotation 방식) ──────────────────────────────────────

async def session_set(token: str, user_id: str, ttl_days: int = 30):
    """JWT 리프레시 토큰 → user_id 매핑."""
    r = await get_redis()
    await r.setex(f"session:{token}", ttl_days * 86400, user_id)


async def session_get(token: str) -> str | None:
    r = await get_redis()
    return await r.get(f"session:{token}")


async def session_del(token: str):
    """로그아웃 / rotation: 리프레시 토큰 무효화."""
    r = await get_redis()
    await r.delete(f"session:{token}")


# ── User 캐시 (N+1 방지) ─────────────────────────────────────────────────────
# TTL: 15분 (access token 만료와 동일)

USER_CACHE_TTL = 60 * 15


async def user_cache_set(user_id: str, user_json: str):
    r = await get_redis()
    await r.setex(f"user:{user_id}", USER_CACHE_TTL, user_json)


async def user_cache_get(user_id: str) -> str | None:
    r = await get_redis()
    return await r.get(f"user:{user_id}")


async def user_cache_del(user_id: str):
    r = await get_redis()
    await r.delete(f"user:{user_id}")


# ── OAuth 단기 코드 교환 ──────────────────────────────────────────────────────

OAUTH_CODE_TTL = 60 * 5


async def oauth_code_set(code: str, payload_json: str):
    r = await get_redis()
    await r.setex(f"oauth_code:{code}", OAUTH_CODE_TTL, payload_json)


async def oauth_code_pop(code: str) -> str | None:
    r = await get_redis()
    key = f"oauth_code:{code}"
    payload = await r.get(key)
    if payload:
        await r.delete(key)
    return payload


# ── OAuth state → frontend origin ────────────────────────────────────────────

OAUTH_ORIGIN_TTL = 60 * 10


async def oauth_origin_set(state: str, origin: str):
    r = await get_redis()
    await r.setex(f"oauth_origin:{state}", OAUTH_ORIGIN_TTL, origin)


async def oauth_origin_pop(state: str) -> str | None:
    r = await get_redis()
    key = f"oauth_origin:{state}"
    origin = await r.get(key)
    if origin:
        await r.delete(key)
    return origin
