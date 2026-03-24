"""
Celery 애플리케이션 설정

큐 구조:
  image     — 이미지 처리 (resize, OCR, generate)       CPU/GPU 집약
  ai        — AI 에이전트, tool-use, 코드 실행          I/O 집약
  knowledge — 문서 파싱, 청킹, 임베딩                   CPU + I/O
  default   — 기타 경량 작업

Worker 실행 예:
  # 모든 큐 처리 (개발/단일 서버)
  celery -A app.core.celery_app worker -Q image,ai,knowledge,default -c 4

  # 큐별 분리 (멀티 서버)
  celery -A app.core.celery_app worker -Q image -c 2 --hostname image@%%h
  celery -A app.core.celery_app worker -Q ai    -c 8 --hostname ai@%%h
"""
from celery import Celery
from kombu import Exchange, Queue

from app.core.config import settings

celery_app = Celery(
    "umai",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.tasks.image",
        "app.tasks.ai",
        "app.tasks.knowledge",
    ],
)

# ── 큐 정의 ───────────────────────────────────────────────────────────────────

default_exchange = Exchange("default", type="direct")
image_exchange   = Exchange("image",   type="direct")
ai_exchange      = Exchange("ai",      type="direct")
know_exchange    = Exchange("knowledge", type="direct")

celery_app.conf.task_queues = (
    Queue("default",   default_exchange, routing_key="default"),
    Queue("image",     image_exchange,   routing_key="image"),
    Queue("ai",        ai_exchange,      routing_key="ai"),
    Queue("knowledge", know_exchange,    routing_key="knowledge"),
)
celery_app.conf.task_default_queue    = "default"
celery_app.conf.task_default_exchange = "default"
celery_app.conf.task_default_routing_key = "default"

# ── 태스크 라우팅 ─────────────────────────────────────────────────────────────

celery_app.conf.task_routes = {
    "app.tasks.image.*":     {"queue": "image"},
    "app.tasks.ai.*":        {"queue": "ai"},
    "app.tasks.knowledge.*": {"queue": "knowledge"},
}

# ── 직렬화 / 안정성 설정 ──────────────────────────────────────────────────────

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,

    # 작업 완료 후 ack → 워커 비정상 종료 시 자동 재큐
    task_acks_late=True,
    task_reject_on_worker_lost=True,

    # 저사양 서버: 한번에 하나씩 가져와 메모리 절약
    worker_prefetch_multiplier=1,

    # 결과 보관 시간
    result_expires=settings.CELERY_TASK_RESULT_EXPIRES,

    # 진행 상태 추적 활성화 (STARTED 상태 기록)
    task_track_started=True,

    # 재시도 정책 기본값
    # run_agent: max_steps=10 × 120s = 1200s 가능 → 넉넉하게 설정
    task_soft_time_limit=1500,  # 25분 soft limit (graceful shutdown signal)
    task_time_limit=1800,       # 30분 hard kill
)
