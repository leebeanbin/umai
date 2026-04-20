# Celery 비동기 태스크 시스템

## 개요

AI 추론, 이미지 처리, 문서 임베딩은 HTTP 요청-응답 사이클에서 처리하기엔 너무 오래 걸립니다.
Celery를 사용해 비동기 태스크로 분리하고, 완료 시 WebSocket으로 알립니다.

```
브라우저               FastAPI               Redis (Broker)        Celery Worker
   │                     │                        │                     │
   │──POST /tasks/ai/────▶│                        │                     │
   │  agent               │──apply_async()─────────▶│                     │
   │                      │  task_id 반환           │──태스크 전달─────────▶│
   │◀──{task_id: "abc"}───┤                        │                     │  (처리 중...)
   │                      │                        │                     │
   │──WS /ws/tasks────────▶│                        │                     │
   │  (구독 대기)           │                        │                     │
   │                      │                        │◀────── 완료 이벤트──┤
   │◀──{type:"task_done"}─┤◀──────────────────────┤    publish(task:uid)│
```

---

## 큐 분리

```python
# backend/app/core/celery_app.py

celery_app.conf.task_routes = {
    "app.tasks.ai.*":        {"queue": "ai"},       # GPU/LLM 워커
    "app.tasks.image.*":     {"queue": "image"},    # GPU/이미지 워커
    "app.tasks.knowledge.*": {"queue": "knowledge"},# CPU/임베딩 워커
    "app.tasks.workflow.*":  {"queue": "ai"},       # 워크플로우 → AI 큐
}
```

큐를 분리하는 이유:
- AI 태스크는 GPU를 사용하므로 GPU 서버에서만 처리
- 이미지 처리는 다른 메모리/CPU 프로파일을 가짐
- 지식 임베딩은 오래 걸려도 실시간성이 필요 없음
- 큐별로 워커 수와 리소스를 독립적으로 조정 가능

---

## 태스크 등록 패턴 (`_enqueue_task`)

```python
# backend/app/routers/tasks.py:57

async def _enqueue_task(celery_task: Any, kwargs: dict, user_id: str) -> TaskResponse:
    try:
        task = celery_task.apply_async(kwargs=kwargs)
    except Exception as exc:
        raise HTTPException(503, f"Task queue unavailable: {exc}")

    # task_id → user_id 매핑 저장 (소유권 확인용)
    redis = await get_redis()
    await redis.setex(key_task_owner(str(task.id)), TASK_OWNER_TTL, user_id)

    return TaskResponse(task_id=task.id, status="queued")
```

모든 태스크 엔드포인트가 이 헬퍼를 사용합니다:

```python
@router.post("/image/resize")
async def enqueue_resize(request, body, current_user=Depends(get_current_user)):
    return await _enqueue_task(resize_image, body.model_dump(), str(current_user.id))
```

`task_id → user_id` 매핑을 Redis에 저장하는 이유:
태스크 상태를 조회하는 `GET /tasks/{task_id}` 엔드포인트에서 소유권을 확인합니다.
다른 사용자가 task_id를 알아도 조회할 수 없습니다.

---

## DALL-E 이중 과금 방지

```python
# backend/app/tasks/image.py — _gen_openai()

def _gen_openai(*, task_id, prompt, model, size, quality, **_):
    _r = _get_task_redis()
    _cache_key = key_task_dalle_cache(task_id)

    # 캐시 체크 — Celery retry 시 재사용
    b64 = _r.get(_cache_key)
    if b64 is None:
        # 실제 DALL-E 호출 (유료)
        resp = _openai_post(client, "https://api.openai.com/v1/images/generations", ...)
        b64 = resp.json()["data"][0]["b64_json"]
        # 결과 2시간 캐시
        _r.setex(_cache_key, 7200, b64)

    return {"b64": b64, "url": None, "provider": "openai"}
```

**문제:** Celery 태스크는 네트워크 오류 등으로 재시도될 수 있습니다.
DALL-E는 호출당 과금됩니다. 재시도마다 새 이미지가 생성되면 비용이 2배, 3배가 됩니다.

**해결:** task_id를 캐시 키로 사용합니다. 같은 task_id로 재시도가 오면
Redis에서 이전 결과를 반환하고 DALL-E를 호출하지 않습니다.

TTL 2시간: task가 2시간 안에 완료되지 않으면 어차피 폐기됩니다.

---

## 태스크 완료 알림 패턴

```python
# backend/app/tasks/_utils.py

def publish_task_done(task_id: str, task_type: str) -> None:
    """Celery 태스크 완료 → 소유자 WS 채널에 발행."""
    r = _get_redis()
    owner_id = r.get(key_task_owner(task_id))
    if owner_id:
        r.publish(
            f"task:{owner_id}",
            json.dumps({"type": "task_done", "task_id": task_id, "task_type": task_type})
        )
```

완료 시 `task:{user_id}` 채널에 발행합니다.
`WS /ws/tasks`에 연결한 클라이언트는 이 채널을 구독하고 있으므로 즉시 알림을 받습니다.

---

## 태스크 상태 조회

```python
# backend/app/routers/tasks.py

_CELERY_STATE_MAP: dict[str, str] = {
    "PENDING": "pending",
    "STARTED": "running",
}

def _task_status(task_id: str) -> TaskResponse:
    try:
        result = AsyncResult(task_id, app=celery_app)
        if result.state == "SUCCESS":
            return TaskResponse(task_id=task_id, status="success", result=result.result)
        if result.state == "FAILURE":
            return TaskResponse(task_id=task_id, status="failed", error=str(result.result))
        # PENDING, STARTED 등 → 딕셔너리 매핑
        return TaskResponse(
            task_id=task_id,
            status=_CELERY_STATE_MAP.get(result.state, result.state.lower())
        )
    except Exception:
        return TaskResponse(task_id=task_id, status="unknown")
```

Celery 상태 문자열(대문자)을 내부 API 상태(소문자)로 변환합니다.
Redis/Celery 백엔드 장애 시 500 에러 대신 "unknown" 상태를 반환합니다.

---

## Dead Letter Queue (DLQ) 패턴

```python
# backend/app/tasks/_utils.py

class UmaiBaseTask(Task):
    """모든 Celery 태스크의 베이스 클래스.
    영구 실패(max_retries 초과) 시 DLQ Redis Sorted Set에 자동 기록."""

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        move_to_dlq(self.name, kwargs, str(exc))
        super().on_failure(exc, task_id, args, kwargs, einfo)

# 모든 태스크에 적용
@shared_task(bind=True, base=UmaiBaseTask, name="app.tasks.ai.run_agent")
def run_agent(self, ...): ...

@shared_task(bind=True, base=UmaiBaseTask, name="app.tasks.image.generate_image")
def generate_image(self, ...): ...
```

DLQ 저장 키: `dlq:{task_name}` (Redis Sorted Set, score=timestamp)

**왜 DLQ?**
- 재시도 소진 후 에러가 조용히 사라지면 운영자가 모를 수 있음
- DLQ에 쌓인 태스크를 모니터링·재처리 가능
- `base=UmaiBaseTask`로 태스크마다 중복 try/except 제거

## 재시도 전략

```python
@shared_task(bind=True, base=UmaiBaseTask, max_retries=1)
def generate_image(self, ...):
    try:
        return handler(...)
    except _RateLimitError as rate_err:
        raise self.retry(exc=rate_err, countdown=rate_err.retry_after)
    except Exception as exc:
        raise self.retry(exc=exc, countdown=15)
    # on_failure → UmaiBaseTask.on_failure → DLQ 자동 기록
```

`max_retries=1` — 총 2번 실행. 재시도 초과 시 `UmaiBaseTask.on_failure`가 DLQ에 기록합니다.

---

## 이미지 처리 Dispatch 구조

```
generate_image
    │
    ├── provider="openai"    → _gen_openai()      DALL-E 3
    ├── provider="comfyui"   → _gen_comfyui()     SD/SDXL (ComfyUI)
    └── provider="automatic1111" → _gen_automatic1111()  SD (A1111)

edit_image (인페인팅)
    │
    ├── provider="gpt-image-1" → _edit_gpt_image_1()
    └── provider="comfyui"     → _edit_comfyui()

compose_studio (누끼+배경 합성)
    │
    ├── bg_type="solid"    → _bg_solid()      PIL 단색
    ├── bg_type="gradient" → _bg_gradient()   PIL 그라디언트
    └── bg_type="ai"       → _bg_ai()         DALL-E 배경 생성
```

각 핸들러는 `**kwargs` 패턴으로 자신에게 필요한 파라미터만 사용합니다:

```python
def _gen_openai(*, task_id, prompt, model, size, quality, **_: Any) -> dict:
    # comfyui_url, a1111_url 등 불필요한 파라미터는 **_로 무시
    ...
```

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `backend/app/tasks/ai.py` | run_agent, web_search, execute_python |
| `backend/app/tasks/image.py` | 이미지 생성/편집/합성 |
| `backend/app/tasks/knowledge.py` | 문서 청킹+임베딩 |
| `backend/app/tasks/workflow.py` | 워크플로우 실행 |
| `backend/app/tasks/_utils.py` | `publish_task_done`, `_get_redis` |
| `backend/app/routers/tasks.py` | 태스크 REST API |
| `backend/app/core/celery_app.py` | Celery 설정, 큐 라우팅 |
