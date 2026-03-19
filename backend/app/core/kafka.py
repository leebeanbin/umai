"""
Kafka producer/consumer (Upstash Kafka 또는 로컬 Kafka 모두 지원)

로컬 개발: KAFKA_USE_SASL=false, KAFKA_BOOTSTRAP_SERVERS=localhost:9092
Upstash:   KAFKA_USE_SASL=true,  KAFKA_BOOTSTRAP_SERVERS=<upstash-endpoint>
"""
import json
import asyncio
from typing import Callable, Awaitable
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer
from aiokafka.helpers import create_ssl_context

from app.core.config import settings

_producer: AIOKafkaProducer | None = None


def _kafka_kwargs() -> dict:
    kwargs: dict = {"bootstrap_servers": settings.KAFKA_BOOTSTRAP_SERVERS}
    if settings.KAFKA_USE_SASL:
        kwargs.update(
            security_protocol="SASL_SSL",
            sasl_mechanism="SCRAM-SHA-256",
            sasl_plain_username=settings.KAFKA_SASL_USERNAME,
            sasl_plain_password=settings.KAFKA_SASL_PASSWORD,
            ssl_context=create_ssl_context(),
        )
    return kwargs


async def get_producer() -> AIOKafkaProducer:
    global _producer
    if _producer is None:
        _producer = AIOKafkaProducer(
            **_kafka_kwargs(),
            value_serializer=lambda v: json.dumps(v).encode(),
        )
        await _producer.start()
    return _producer


async def close_producer():
    global _producer
    if _producer:
        await _producer.stop()
        _producer = None


async def publish(topic: str, event: dict, key: str | None = None) -> bool:
    """
    이벤트를 Kafka 토픽에 발행.
    Kafka가 다운되어도 API 요청은 실패하지 않음 (fire-and-forget with logging).
    반환값: True=성공, False=실패(Kafka 다운 등)
    """
    try:
        producer = await get_producer()
        key_bytes = key.encode() if key else None
        await asyncio.wait_for(
            producer.send_and_wait(topic, value=event, key=key_bytes),
            timeout=3.0,  # 3초 타임아웃
        )
        return True
    except asyncio.TimeoutError:
        print(f"[Kafka] publish timeout on topic={topic}")
        return False
    except Exception as e:
        print(f"[Kafka] publish failed on topic={topic}: {e}")
        # 프로듀서 재초기화 (다음 요청에서 재연결)
        global _producer
        _producer = None
        return False


# ── 편의 래퍼 ────────────────────────────────────────────────────────────────

async def publish_image_task(session_id: str, task_id: str, payload: dict):
    await publish(
        settings.KAFKA_TOPIC_IMAGE_TASKS,
        {"session_id": session_id, "task_id": task_id, **payload},
        key=task_id,
    )


async def publish_chat_event(chat_id: str, event_type: str, data: dict):
    await publish(
        settings.KAFKA_TOPIC_CHAT_EVENTS,
        {"chat_id": chat_id, "event": event_type, "data": data},
        key=chat_id,
    )


# ── Consumer (백그라운드 워커) ────────────────────────────────────────────────

async def consume_forever(
    topic: str,
    group_id: str,
    handler: Callable[[dict], Awaitable[None]],
):
    """토픽을 지속적으로 소비하는 백그라운드 태스크"""
    consumer = AIOKafkaConsumer(
        topic,
        **_kafka_kwargs(),
        group_id=group_id,
        value_deserializer=lambda v: json.loads(v.decode()),
        auto_offset_reset="earliest",
    )
    await consumer.start()
    try:
        async for msg in consumer:
            try:
                await handler(msg.value)
            except Exception as e:
                print(f"[Kafka] handler error on {topic}: {e}")
    finally:
        await consumer.stop()
