from app.core.redis_keys import key_task_notification
"""
Celery 태스크 공통 유틸리티

publish_task_done: 태스크 완료를 소유자 전용 Redis 채널에 발행.
  - ai.py / knowledge.py / image.py 3곳에 있던 동일 코드를 통합.
  - 동기 컨텍스트(Celery worker)에서만 사용.
"""
import json
import logging

import redis as _sync_redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# 모듈 수준 커넥션 풀 — 태스크마다 새 연결 생성 방지 (연결 고갈 방어)
_pool: _sync_redis.ConnectionPool | None = None


def _get_redis() -> _sync_redis.Redis:
    global _pool
    if _pool is None:
        _pool = _sync_redis.ConnectionPool.from_url(
            settings.REDIS_URL, decode_responses=True, max_connections=10
        )
    return _sync_redis.Redis(connection_pool=_pool)


def publish_task_done(task_id: str, task: str) -> None:
    """태스크 완료 이벤트를 소유자 전용 Redis 채널에 발행. non-fatal."""
    try:
        r = _get_redis()
        owner = r.get(f"task_owner:{task_id}")
        if owner:
            r.publish(key_task_notification(owner), json.dumps({
                "type": "task_done",
                "task_id": task_id,
                "task": task,
            }))
    except Exception as exc:
        logger.warning("publish_task_done failed: %s", exc)
