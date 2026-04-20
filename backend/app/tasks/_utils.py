"""
Celery 태스크 공통 유틸리티

publish_task_done: 태스크 완료를 소유자 전용 Redis 채널에 발행.
  - ai.py / knowledge.py / image.py 3곳에 있던 동일 코드를 통합.
  - 동기 컨텍스트(Celery worker)에서만 사용.

ai_api_retry: tenacity 지수 백오프 데코레이터 (일시적 네트워크 오류 대상).
move_to_dlq: 최대 재시도 초과 태스크를 Redis DLQ 리스트에 보존.
UmaiBaseTask: 영구 실패 시 자동으로 DLQ에 보존하는 Celery 베이스 태스크.
"""
import json
import logging
from datetime import datetime, timezone

import redis as _sync_redis
from celery import Task

from app.core.config import settings
from app.core.redis_keys import key_task_notification, key_dlq

try:
    import httpx as _httpx
    from tenacity import (
        retry,
        retry_if_exception_type,
        stop_after_attempt,
        wait_exponential_jitter,
        before_sleep_log,
    )

    _TRANSIENT_ERRORS = (
        ConnectionError,
        TimeoutError,
        _httpx.ConnectError,
        _httpx.ReadTimeout,
        _httpx.ConnectTimeout,
    )

    ai_api_retry = retry(
        retry=retry_if_exception_type(_TRANSIENT_ERRORS),
        stop=stop_after_attempt(4),
        wait=wait_exponential_jitter(initial=2, max=60),
        before_sleep=before_sleep_log(logging.getLogger(__name__), logging.WARNING),
        reraise=True,
    )
except ImportError:
    # tenacity 미설치 시 no-op 데코레이터
    def ai_api_retry(fn):  # type: ignore[misc]
        return fn

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


def move_to_dlq(task_name: str, kwargs: dict, error: str) -> None:
    """영구 실패 태스크를 Redis DLQ 리스트에 보존 (최대 1000건)."""
    try:
        r = _get_redis()
        r.lpush(key_dlq(), json.dumps({
            "task": task_name,
            "kwargs": kwargs,
            "error": error,
            "failed_at": datetime.now(timezone.utc).isoformat(),
        }))
        r.ltrim(key_dlq(), 0, 999)
    except Exception as exc:
        logger.warning("move_to_dlq failed: %s", exc)


class UmaiBaseTask(Task):
    """영구 실패(max_retries 초과) 태스크를 자동으로 DLQ에 보존하는 베이스 클래스.

    모든 @shared_task에 base=UmaiBaseTask를 지정하면 on_failure가 자동 호출된다.
    """

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        move_to_dlq(self.name, kwargs, str(exc))
        super().on_failure(exc, task_id, args, kwargs, einfo)


def publish_workflow_event(owner_id: str, event_type: str, payload: dict) -> None:
    """워크플로우 실행 이벤트를 소유자 전용 Redis 채널에 발행.

    기존 task:{owner_id} 채널을 재사용하므로 WS 엔드포인트 변경 불필요.
    이벤트 타입:
      workflow_step_done  — 개별 노드 완료
      workflow_suspended  — HumanNode 승인 대기
      workflow_done       — 전체 완료
      workflow_failed     — 실패
    """
    try:
        r = _get_redis()
        r.publish(key_task_notification(owner_id), json.dumps({"type": event_type, **payload}))
    except Exception as exc:
        logger.warning("publish_workflow_event failed: %s", exc)
