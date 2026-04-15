"""
오픈 모델 파인튜닝 API

엔드포인트:
  POST   /fine-tune/datasets          — 데이터셋 생성 (JSONL 파싱)
  GET    /fine-tune/datasets          — 데이터셋 목록
  DELETE /fine-tune/datasets/{id}     — 데이터셋 삭제

  POST   /fine-tune/jobs              — 파인튜닝 작업 생성 + 즉시 시작
  GET    /fine-tune/jobs              — 작업 목록
  GET    /fine-tune/jobs/{id}         — 작업 상세 + 실시간 지표
  POST   /fine-tune/jobs/{id}/cancel  — 작업 취소
"""

import asyncio
import json
import math
import random
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.fine_tune import FineTuneJob, TrainingDataset
from app.models.user import User
from app.routers.deps import get_current_user

router = APIRouter(prefix="/fine-tune", tags=["fine-tune"], redirect_slashes=False)

# ── 지원 오픈 모델 목록 ────────────────────────────────────────────────────────

SUPPORTED_MODELS = [
    # LLaMA 3.x
    {"id": "meta-llama/Llama-3.1-8B-Instruct",   "name": "LLaMA 3.1 8B Instruct",  "family": "LLaMA",   "size": "8B",  "vram": "16GB"},
    {"id": "meta-llama/Llama-3.1-70B-Instruct",  "name": "LLaMA 3.1 70B Instruct", "family": "LLaMA",   "size": "70B", "vram": "80GB"},
    {"id": "meta-llama/Llama-3.2-3B-Instruct",   "name": "LLaMA 3.2 3B Instruct",  "family": "LLaMA",   "size": "3B",  "vram": "8GB"},
    # Mistral
    {"id": "mistralai/Mistral-7B-Instruct-v0.3",  "name": "Mistral 7B Instruct",     "family": "Mistral", "size": "7B",  "vram": "14GB"},
    {"id": "mistralai/Mistral-Nemo-Instruct-2407","name": "Mistral Nemo 12B",        "family": "Mistral", "size": "12B", "vram": "24GB"},
    # Gemma 2
    {"id": "google/gemma-2-2b-it",               "name": "Gemma 2 2B IT",           "family": "Gemma",   "size": "2B",  "vram": "8GB"},
    {"id": "google/gemma-2-9b-it",               "name": "Gemma 2 9B IT",           "family": "Gemma",   "size": "9B",  "vram": "18GB"},
    {"id": "google/gemma-2-27b-it",              "name": "Gemma 2 27B IT",          "family": "Gemma",   "size": "27B", "vram": "54GB"},
    # Qwen 2.5
    {"id": "Qwen/Qwen2.5-7B-Instruct",           "name": "Qwen 2.5 7B Instruct",    "family": "Qwen",    "size": "7B",  "vram": "14GB"},
    {"id": "Qwen/Qwen2.5-14B-Instruct",          "name": "Qwen 2.5 14B Instruct",   "family": "Qwen",    "size": "14B", "vram": "28GB"},
    {"id": "Qwen/Qwen2.5-72B-Instruct",          "name": "Qwen 2.5 72B Instruct",   "family": "Qwen",    "size": "72B", "vram": "80GB"},
    # Phi
    {"id": "microsoft/Phi-3.5-mini-instruct",    "name": "Phi 3.5 Mini Instruct",   "family": "Phi",     "size": "3.8B","vram": "8GB"},
    {"id": "microsoft/Phi-3-medium-128k-instruct","name": "Phi 3 Medium 14B",       "family": "Phi",     "size": "14B", "vram": "28GB"},
]


# ── Pydantic 스키마 ───────────────────────────────────────────────────────────

_MAX_DATASET_EXAMPLES = 100_000
_MAX_CONCURRENT_JOBS  = 3

class DatasetCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str = ""
    format: str = Field("chat", pattern="^(chat|instruction|completion)$")
    # JSONL 텍스트 or JSON 배열 문자열 (10MB 제한)
    raw_data: str = Field(..., max_length=10_000_000, description="JSONL 또는 JSON 배열 형식")


class DatasetOut(BaseModel):
    id: str
    name: str
    description: str
    format: str
    example_count: int
    created_at: str

    @classmethod
    def from_orm(cls, d: TrainingDataset) -> "DatasetOut":
        return cls(
            id=str(d.id),
            name=d.name,
            description=d.description,
            format=d.format,
            example_count=d.example_count,
            created_at=d.created_at.isoformat(),
        )


_SUPPORTED_MODEL_IDS = {m["id"] for m in SUPPORTED_MODELS}

class JobCreate(BaseModel):
    name: str = Field(..., max_length=255)
    dataset_id: str
    base_model: str
    method: str = Field("lora", pattern="^(lora|qlora|full)$")
    # 학습 설정
    lora_rank: int = Field(16, ge=4, le=256)
    lora_alpha: int = Field(32, ge=4, le=512)
    epochs: int = Field(3, ge=1, le=20)
    learning_rate: float = Field(2e-4, gt=0, le=0.01)   # 0.01 초과는 학습 불안정
    batch_size: int = Field(4, ge=1, le=32)
    max_seq_length: int = Field(2048, ge=128, le=8192)
    warmup_ratio: float = Field(0.1, ge=0, le=0.5)
    output_model_name: str = ""


class JobOut(BaseModel):
    id: str
    name: str
    dataset_id: str | None
    base_model: str
    method: str
    config: dict
    status: str
    progress: float
    current_step: int
    total_steps: int
    metrics: dict
    output_model_name: str | None
    error_message: str | None
    logs: list
    started_at: str | None
    finished_at: str | None
    created_at: str

    @classmethod
    def from_orm(cls, j: FineTuneJob) -> "JobOut":
        return cls(
            id=str(j.id),
            name=j.name,
            dataset_id=str(j.dataset_id) if j.dataset_id else None,
            base_model=j.base_model,
            method=j.method,
            config=j.config,
            status=j.status,
            progress=j.progress,
            current_step=j.current_step,
            total_steps=j.total_steps,
            metrics=j.metrics,
            output_model_name=j.output_model_name,
            error_message=j.error_message,
            logs=j.logs or [],
            started_at=j.started_at.isoformat() if j.started_at else None,
            finished_at=j.finished_at.isoformat() if j.finished_at else None,
            created_at=j.created_at.isoformat(),
        )


# ── 데이터셋 엔드포인트 ───────────────────────────────────────────────────────

@router.post("/datasets", response_model=DatasetOut, status_code=201)
async def create_dataset(
    body: DatasetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # JSONL 또는 JSON 배열 파싱
    examples: list[dict] = []
    raw = body.raw_data.strip()
    try:
        if raw.startswith("["):
            examples = json.loads(raw)
        else:
            for line in raw.splitlines():
                line = line.strip()
                if line:
                    examples.append(json.loads(line))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"JSON 파싱 오류: {e}")

    if not examples:
        raise HTTPException(status_code=422, detail="데이터셋에 예제가 없습니다.")

    dataset = TrainingDataset(
        owner_id=current_user.id,
        name=body.name,
        description=body.description,
        format=body.format,
        examples=examples,
        example_count=len(examples),
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)
    return DatasetOut.from_orm(dataset)


@router.get("/datasets", response_model=list[DatasetOut])
async def list_datasets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TrainingDataset)
        .where(TrainingDataset.owner_id == current_user.id)
        .order_by(TrainingDataset.created_at.desc())
    )
    return [DatasetOut.from_orm(d) for d in result.scalars().all()]


@router.delete("/datasets/{dataset_id}", status_code=204)
async def delete_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TrainingDataset).where(
            TrainingDataset.id == uuid.UUID(dataset_id),
            TrainingDataset.owner_id == current_user.id,
        )
    )
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="데이터셋을 찾을 수 없습니다.")
    await db.delete(dataset)
    await db.commit()


@router.get("/models")
async def list_supported_models(current_user: User = Depends(get_current_user)):
    return SUPPORTED_MODELS


# ── 학습 작업 엔드포인트 ──────────────────────────────────────────────────────

def _calc_total_steps(example_count: int, epochs: int, batch_size: int) -> int:
    steps_per_epoch = max(1, example_count // batch_size)
    return steps_per_epoch * epochs


async def _simulate_training(job_id: uuid.UUID) -> None:
    """
    실제 Unsloth / HuggingFace Trainer 연동 대신
    지수 감소 손실 곡선을 시뮬레이션합니다.

    프로덕션에서는 이 함수를 Celery 태스크로 교체:
      from app.tasks.fine_tune import run_fine_tune_task
      run_fine_tune_task.delay(str(job_id))
    """
    from app.core.database import AsyncSessionLocal  # 지연 임포트 (순환 방지)

    await asyncio.sleep(2)  # 초기 준비 딜레이

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
        job = result.scalar_one_or_none()
        if not job or job.status != "running":
            return

        total_steps = job.total_steps
        cfg = job.config
        epochs = cfg.get("epochs", 3)
        lr = cfg.get("learning_rate", 2e-4)
        warmup_steps = int(total_steps * cfg.get("warmup_ratio", 0.1))

        metrics: dict[str, list] = {"steps": [], "train_loss": [], "val_loss": [], "learning_rate": []}
        logs: list[str] = [
            f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] 학습 시작: {job.base_model}",
            f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] 방법: {job.method.upper()}, Epochs: {epochs}, Total steps: {total_steps}",
        ]

        initial_loss = 2.4 + random.uniform(-0.2, 0.2)
        noise_scale = 0.06

        step_delay = max(0.3, min(2.0, 60.0 / total_steps))  # 전체 ~60초 이내

        for step in range(1, total_steps + 1):
            # 취소 체크
            async with AsyncSessionLocal() as check_db:
                r2 = await check_db.execute(select(FineTuneJob.status).where(FineTuneJob.id == job_id))
                current_status = r2.scalar_one_or_none()
            if current_status != "running":
                return

            # 학습률 스케줄 (warmup + cosine decay)
            if step <= warmup_steps:
                current_lr = lr * (step / max(1, warmup_steps))
            else:
                progress = (step - warmup_steps) / (total_steps - warmup_steps)
                current_lr = lr * 0.5 * (1 + math.cos(math.pi * progress))

            # 지수 감소 + 노이즈로 손실 시뮬레이션
            decay = math.exp(-3.5 * (step / total_steps))
            base_loss = initial_loss * (0.15 + 0.85 * decay)
            train_loss = base_loss + random.gauss(0, noise_scale)
            val_loss = train_loss + random.uniform(0.02, 0.12)

            metrics["steps"].append(step)
            metrics["train_loss"].append(round(max(0.05, train_loss), 4))
            metrics["val_loss"].append(round(max(0.07, val_loss), 4))
            metrics["learning_rate"].append(round(current_lr, 8))

            # 에포크 경계 로그
            steps_per_epoch = total_steps // epochs
            if step % steps_per_epoch == 0:
                epoch_num = step // steps_per_epoch
                logs.append(
                    f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] "
                    f"Epoch {epoch_num}/{epochs} 완료 — "
                    f"loss: {train_loss:.4f}, val_loss: {val_loss:.4f}"
                )

            # DB 업데이트 (10스텝 단위 또는 완료 직전)
            if step % max(1, total_steps // 20) == 0 or step == total_steps:
                async with AsyncSessionLocal() as upd_db:
                    r3 = await upd_db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
                    upd_job = r3.scalar_one_or_none()
                    if upd_job and upd_job.status == "running":
                        upd_job.current_step = step
                        upd_job.progress = round(step / total_steps, 4)
                        upd_job.metrics = {k: list(v) for k, v in metrics.items()}
                        upd_job.logs = list(logs)
                        await upd_db.commit()

            await asyncio.sleep(step_delay)

        # 완료 처리
        async with AsyncSessionLocal() as fin_db:
            r4 = await fin_db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
            fin_job = r4.scalar_one_or_none()
            if fin_job and fin_job.status == "running":
                fin_job.status = "done"
                fin_job.progress = 1.0
                fin_job.current_step = total_steps
                fin_job.finished_at = datetime.now(timezone.utc)
                logs.append(
                    f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] "
                    f"✓ 학습 완료! 최종 loss: {metrics['train_loss'][-1]:.4f}"
                )
                fin_job.logs = list(logs)
                await fin_db.commit()


@router.post("/jobs", response_model=JobOut, status_code=201)
async def create_job(
    body: JobCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # base_model 화이트리스트 검증
    if body.base_model not in _SUPPORTED_MODEL_IDS:
        raise HTTPException(status_code=422, detail=f"지원하지 않는 모델입니다: {body.base_model}")

    # 동시 실행 제한
    active_cnt = await db.scalar(
        select(func.count(FineTuneJob.id)).where(
            FineTuneJob.owner_id == current_user.id,
            FineTuneJob.status.in_(["running", "pending"]),
        )
    )
    if (active_cnt or 0) >= _MAX_CONCURRENT_JOBS:
        raise HTTPException(
            status_code=429,
            detail=f"동시 실행 제한: 최대 {_MAX_CONCURRENT_JOBS}개까지만 가능합니다.",
        )

    # 데이터셋 확인
    ds_result = await db.execute(
        select(TrainingDataset).where(
            TrainingDataset.id == uuid.UUID(body.dataset_id),
            TrainingDataset.owner_id == current_user.id,
        )
    )
    dataset = ds_result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="데이터셋을 찾을 수 없습니다.")

    total_steps = _calc_total_steps(dataset.example_count, body.epochs, body.batch_size)

    config = {
        "lora_rank": body.lora_rank,
        "lora_alpha": body.lora_alpha,
        "epochs": body.epochs,
        "learning_rate": body.learning_rate,
        "batch_size": body.batch_size,
        "max_seq_length": body.max_seq_length,
        "warmup_ratio": body.warmup_ratio,
    }

    job = FineTuneJob(
        owner_id=current_user.id,
        name=body.name,
        dataset_id=uuid.UUID(body.dataset_id),
        base_model=body.base_model,
        method=body.method,
        config=config,
        status="running",
        total_steps=total_steps,
        output_model_name=body.output_model_name or None,
        started_at=datetime.now(timezone.utc),
        logs=[f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] 작업 생성됨"],
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # 백그라운드 학습 시뮬레이션 시작
    background_tasks.add_task(_simulate_training, job.id)

    return JobOut.from_orm(job)


@router.get("/jobs", response_model=list[JobOut])
async def list_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(FineTuneJob)
        .where(FineTuneJob.owner_id == current_user.id)
        .order_by(FineTuneJob.created_at.desc())
    )
    return [JobOut.from_orm(j) for j in result.scalars().all()]


@router.get("/jobs/{job_id}", response_model=JobOut)
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(FineTuneJob).where(
            FineTuneJob.id == uuid.UUID(job_id),
            FineTuneJob.owner_id == current_user.id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    return JobOut.from_orm(job)


@router.post("/jobs/{job_id}/cancel", response_model=JobOut)
async def cancel_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(FineTuneJob).where(
            FineTuneJob.id == uuid.UUID(job_id),
            FineTuneJob.owner_id == current_user.id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    if job.status not in ("pending", "running"):
        raise HTTPException(status_code=400, detail="취소할 수 없는 상태입니다.")
    job.status = "cancelled"
    job.finished_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)
    return JobOut.from_orm(job)
