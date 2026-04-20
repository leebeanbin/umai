# 파인튜닝 시스템 (Fine-Tuning)

## 개요

오픈소스 LLM을 커스텀 데이터로 파인튜닝하는 기능입니다.
LoRA/QLoRA 방식으로 전체 모델 가중치를 변경하지 않고 작은 어댑터 레이어만 학습합니다.

```
학습 데이터 업로드 (JSONL)
    │
    ▼
TrainingDataset 생성 (파싱+검증)
    │
    ▼
FineTuneJob 생성 (베이스 모델, 하이퍼파라미터)
    │
    ▼
Celery 태스크 → Together AI API 호출
    │
    ├── JSONL → Together AI Files API 업로드
    ├── Fine-tuning job 생성 (LoRA/QLoRA 설정 포함)
    ├── 30초 간격 폴링 → DB/Redis 진행률 업데이트
    └── 완료 → 모델 ID DB 저장 (together_job_id, output_model)

백엔드: TOGETHER_API_KEY 미설정 시 시뮬레이션 모드로 fallback
```

---

## 데이터 포맷

세 가지 표준 형식을 지원합니다:

### 1. Chat 형식 (OpenAI 호환)

```json
{"messages": [
    {"role": "system", "content": "당신은 요리 전문가입니다."},
    {"role": "user", "content": "김치찌개 레시피 알려줘"},
    {"role": "assistant", "content": "재료: 김치, 돼지고기..."}
]}
```

### 2. Instruction 형식 (Alpaca)

```json
{"instruction": "다음을 한국어로 번역하세요",
 "input": "Hello, world",
 "output": "안녕, 세상"}
```

### 3. Completion 형식

```json
{"prompt": "파이썬으로 피보나치 수열을 구현하면",
 "completion": " 다음과 같습니다:\ndef fib(n):\n    ..."}
```

---

## 데이터셋 업로드 처리

```python
# backend/app/routers/fine_tune.py

@router.post("/datasets")
async def create_dataset(body: CreateDatasetRequest, ...):
    # JSONL 파싱
    examples = []
    for line in body.raw_data.strip().split("\n"):
        if line.strip():
            try:
                examples.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise HTTPException(422, f"Invalid JSONL at line {i}: {e}")

    dataset = TrainingDataset(
        owner_id=current_user.id,
        name=body.name,
        format=body.format,         # "chat" | "instruction" | "completion"
        examples=examples,
        example_count=len(examples),
    )
    db.add(dataset)
    await db.commit()
```

JSONL(JSON Lines) 형식: 줄마다 하나의 JSON 객체. 대용량 데이터를 스트리밍으로 처리 가능.

---

## 지원 모델군 (Together AI 기준, 2025)

```python
# backend/app/routers/fine_tune.py

SUPPORTED_MODELS = [
    # LLaMA 4 (최신)
    "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct",
    # LLaMA 3.x
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "meta-llama/Llama-3.1-8B-Instruct-Turbo",
    # Gemma 4 (최신)
    "google/gemma-4-1b-it", "google/gemma-4-4b-it",
    "google/gemma-4-12b-it", "google/gemma-4-27b-it",
    # Qwen3
    "Qwen/Qwen3-4B", "Qwen/Qwen3-8B",
    "Qwen/Qwen3-14B", "Qwen/Qwen3-30B-A3B",
    "Qwen/Qwen3-72B",
    # DeepSeek
    "deepseek-ai/DeepSeek-R2", "deepseek-ai/DeepSeek-V3",
    # Phi-4
    "microsoft/phi-4", "microsoft/phi-4-mini",
    # ...외 총 32개
]
```

모두 Together AI 플랫폼에서 파인튜닝 가능한 오픈소스 모델입니다.

---

## LoRA vs QLoRA

| 방식 | 메모리 사용 | 속도 | 품질 |
|---|---|---|---|
| Full Fine-tuning | 매우 높음 (모델 전체) | 빠름 | 최고 |
| **LoRA** | 낮음 (~10% 추가) | 빠름 | 좋음 |
| **QLoRA** | 매우 낮음 (4-bit 양자화) | 느림 | 좋음 |

**LoRA (Low-Rank Adaptation):**

```
기존 가중치 W (고정, 수십억 파라미터)
새 어댑터 = W + A × B  (A, B는 학습 가능한 작은 행렬)
```

예: 7B 모델(7,000,000,000 파라미터) vs LoRA 어댑터(수백만 파라미터)
전체를 학습하는 대신 작은 어댑터만 학습합니다.

**QLoRA:** 기본 모델을 4-bit 양자화해 메모리를 더 절감합니다.
24GB GPU에서 70B 모델을 파인튜닝할 수 있습니다.

---

## 학습 설정 (하이퍼파라미터)

```python
# backend/app/routers/fine_tune.py — FineTuneJobCreate 스키마

class FineTuneConfig(BaseModel):
    learning_rate: float = 2e-4       # LoRA 기본값
    num_epochs: int = 3
    batch_size: int = 4
    lora_r: int = 16                  # LoRA 랭크 (낮을수록 경량, 높을수록 표현력)
    lora_alpha: int = 32              # LoRA 스케일링 (alpha/r 비율 유지 권장)
    lora_dropout: float = 0.1
    max_seq_length: int = 2048
    gradient_accumulation_steps: int = 4
```

**주요 파라미터 설명:**

- `lora_r`: LoRA 어댑터의 랭크. r=8은 빠르고 가볍지만 복잡한 태스크엔 r=64도 사용
- `lora_alpha`: 보통 r의 2배로 설정 (alpha/r = 2). 학습률 스케일링에 영향
- `gradient_accumulation_steps=4`: GPU 메모리 부족 시 4 mini-batch를 쌓아 1 full batch처럼 처리

---

## 태스크 생명주기 관리 (`_job_lifecycle`)

```python
# backend/app/routers/fine_tune.py

@asynccontextmanager
async def _job_lifecycle(job_id: uuid.UUID):
    """파인튜닝 작업 시작/완료/실패를 DB에 기록하는 컨텍스트 매니저."""
    async with AsyncSessionLocal() as db:
        job = await db.get(FineTuneJob, job_id)
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        await db.commit()
    try:
        yield
        async with AsyncSessionLocal() as db:
            job = await db.get(FineTuneJob, job_id)
            job.status = "done"
            job.finished_at = datetime.now(timezone.utc)
            await db.commit()
    except Exception as exc:
        async with AsyncSessionLocal() as db:
            job = await db.get(FineTuneJob, job_id)
            job.status = "failed"
            job.error_message = str(exc)
            await db.commit()
        raise
```

`try/except`를 분산시키지 않고 컨텍스트 매니저로 한 곳에서 관리합니다.

```python
# Together AI 실제 API 호출 (TOGETHER_API_KEY 설정 시)
async def _run_together_fine_tune(job_id, dataset_id, base_model, config):
    async with _job_lifecycle(job_id):
        # 1. JSONL 파일 업로드
        file_id = await _upload_jsonl_to_together(examples)

        # 2. Fine-tuning job 생성
        together_job = await _create_together_job(file_id, base_model, config)

        # 3. 30초 간격 폴링
        while together_job["status"] not in ("completed", "failed", "cancelled"):
            await asyncio.sleep(30)
            together_job = await _poll_together_job(together_job["id"])
            await _update_job_progress(job_id, together_job)
```

---

## 진행률 실시간 업데이트

```python
# 학습 중 진행률을 DB와 Redis pub/sub으로 발행
async def update_progress(job_id, step, total_steps, metrics):
    progress = step / total_steps
    async with AsyncSessionLocal() as db:
        job = await db.get(FineTuneJob, job_id)
        job.progress = progress
        job.current_step = step
        job.metrics["train_loss"].append(metrics["loss"])
        await db.commit()

    # WebSocket으로 실시간 전송
    await publish_task_done(str(job_id), "fine_tune_progress")
```

학습이 진행되면서 `loss`, `learning_rate` 지표가 실시간으로 차트에 표시됩니다.

---

## 취소 로직

```python
# backend/app/routers/fine_tune.py

@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, ...):
    job = await db.get(FineTuneJob, uuid.UUID(job_id))
    _assert_owner(job, current_user.id)

    if job.status not in ("pending", "running"):
        raise HTTPException(400, f"Cannot cancel job in status: {job.status}")

    job.status = "cancelled"  # "failed"가 아닌 "cancelled"
    job.finished_at = datetime.now(timezone.utc)
    await db.commit()
```

`"failed"`가 아닌 `"cancelled"`를 사용하는 이유:
- `failed`: 에러로 인한 실패 → 재시도 필요할 수 있음
- `cancelled`: 사용자가 의도적으로 중단 → 재시도 불필요

UI에서 이 두 상태를 다르게 표시할 수 있습니다.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `backend/app/routers/fine_tune.py` | CRUD, 취소, 생명주기 |
| `backend/app/models/fine_tune.py` | `TrainingDataset`, `FineTuneJob` |
| `frontend/src/app/workspace/fine-tune/` | 데이터셋 업로드, 학습 모니터링 UI |
