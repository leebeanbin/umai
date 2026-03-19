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


async def session_set(token: str, user_id: str, ttl_days: int = 30):
    """JWT 리프레시 토큰 → user_id 매핑 (블랙리스트/검증용)"""
    r = await get_redis()
    await r.setex(f"session:{token}", ttl_days * 86400, user_id)


async def session_get(token: str) -> str | None:
    r = await get_redis()
    return await r.get(f"session:{token}")


async def session_del(token: str):
    """로그아웃: 토큰 무효화"""
    r = await get_redis()
    await r.delete(f"session:{token}")


# ── User 캐시 (N+1 방지) ─────────────────────────────────────────────────────
# 인증 의존성에서 매 요청마다 DB hit 하는 것을 방지
# TTL: 15분 (access token 만료와 동일하게 맞춤)

USER_CACHE_TTL = 60 * 15  # 15분


async def user_cache_set(user_id: str, user_json: str):
    r = await get_redis()
    await r.setex(f"user:{user_id}", USER_CACHE_TTL, user_json)


async def user_cache_get(user_id: str) -> str | None:
    r = await get_redis()
    return await r.get(f"user:{user_id}")


async def user_cache_del(user_id: str):
    """프로필 변경/정지 시 캐시 즉시 무효화"""
    r = await get_redis()
    await r.delete(f"user:{user_id}")


# ── OAuth 단기 코드 교환 (토큰 URL 노출 방지) ─────────────────────────────────
# OAuth 콜백에서 토큰을 URL에 넣지 않고, 5분짜리 코드로 교환

OAUTH_CODE_TTL = 60 * 5  # 5분


async def oauth_code_set(code: str, payload_json: str):
    """one-time code → {access_token, refresh_token} JSON 저장"""
    r = await get_redis()
    await r.setex(f"oauth_code:{code}", OAUTH_CODE_TTL, payload_json)


async def oauth_code_pop(code: str) -> str | None:
    """코드를 읽고 즉시 삭제 (one-time use)"""
    r = await get_redis()
    key = f"oauth_code:{code}"
    payload = await r.get(key)
    if payload:
        await r.delete(key)
    return payload
