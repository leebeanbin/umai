"""
채팅 메시지 Write-Back 태스크 (default queue)

스트리밍 완료 후 user+assistant 쌍을 DB에 idempotent하게 저장하고,
Redis pub/sub으로 저장 완료 이벤트를 발행한다.

  save_messages(chat_id, messages)
    → PostgreSQL INSERT ... ON CONFLICT DO NOTHING
    → Redis PUBLISH chat:{chat_id} {"type":"messages_saved","ids":[...]}
"""
import json
import uuid as _uuid

import redis as sync_redis
from celery import shared_task
from celery.utils.log import get_task_logger
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.core.database import sync_session
from app.models.chat import Message
from app.schemas.chat import MessageCreate

logger = get_task_logger(__name__)


def _publish_sync(channel: str, payload: dict) -> None:
    """동기 Redis pub/sub 발행 (Celery 워커 내부에서 사용)."""
    try:
        r = sync_redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
        r.publish(channel, json.dumps(payload))
        r.close()
    except Exception as exc:
        logger.warning("pub/sub publish failed: %s", exc)


@shared_task(
    bind=True,
    name="app.tasks.chat.save_messages",
    queue="default",
    acks_late=True,
    max_retries=3,
    default_retry_delay=2,
)
def save_messages(self, chat_id: str, messages: list[dict]) -> dict:
    """
    채팅 메시지 배치를 DB에 저장.

    - 2차 Pydantic 검증으로 큐 데이터 오염 방어
    - ON CONFLICT DO NOTHING으로 재시도 시 중복 저장 방지
    - 완료 시 chat:{chat_id} 채널에 messages_saved 이벤트 발행
    """
    try:
        validated = [MessageCreate.model_validate(m) for m in messages]
    except Exception as exc:
        logger.error("save_messages: invalid payload — %s", exc)
        raise  # 재시도 불필요, 데이터 문제

    try:
        rows = []
        for m in validated:
            msg_id = _uuid.UUID(m.id) if m.id else _uuid.uuid4()
            rows.append({
                "id": msg_id,
                "chat_id": _uuid.UUID(chat_id),
                "role": m.role,
                "content": m.content,
                "images": m.images,
            })

        with sync_session() as db:
            stmt = (
                pg_insert(Message)
                .values(rows)
                .on_conflict_do_nothing(index_elements=["id"])
            )
            db.execute(stmt)
            db.commit()

        saved_ids = [str(r["id"]) for r in rows]
        _publish_sync(f"chat:{chat_id}", {
            "type": "messages_saved",
            "ids": saved_ids,
        })
        return {"saved": len(saved_ids)}

    except Exception as exc:
        logger.error("save_messages failed: %s", exc)
        raise self.retry(exc=exc)
