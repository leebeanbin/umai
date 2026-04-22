"""
오픈 모델 파인튜닝 API

## 개요

Together AI API를 통해 오픈 LLM을 파인튜닝하는 REST API.
TOGETHER_API_KEY가 설정되지 않으면 시뮬레이션 모드로 동작.

## 지원 데이터 형식

| 형식        | 설명                                                      |
|-------------|----------------------------------------------------------|
| chat        | OpenAI ChatCompletion 형식 (messages 배열)               |
| instruction | Alpaca 형식 (instruction + output)                       |
| completion  | 단순 텍스트 완성 (prompt + completion)                    |

## 엔드포인트

  POST   /fine-tune/datasets          — 데이터셋 생성
  GET    /fine-tune/datasets          — 데이터셋 목록
  DELETE /fine-tune/datasets/{id}     — 데이터셋 삭제

  GET    /fine-tune/models            — 지원 모델 목록

  POST   /fine-tune/jobs              — 파인튜닝 작업 생성 + 시작
  GET    /fine-tune/jobs              — 작업 목록
  GET    /fine-tune/jobs/{id}         — 작업 상세
  POST   /fine-tune/jobs/{id}/cancel  — 작업 취소
"""

import asyncio
import contextlib
import io
import json
import logging as _ft_logger
import math
import random
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import RATE_FINE_TUNE_DATASET, RATE_FINE_TUNE_JOB
from app.core.database import get_db
from app.models.fine_tune import FineTuneJob, TrainingDataset
from app.models.user import User
from app.routers.deps import get_current_user

from app.core.limiter import limiter

router = APIRouter(prefix="/fine-tune", tags=["fine-tune"], redirect_slashes=False)
_logger = _ft_logger.getLogger(__name__)

_TOGETHER_BASE = "https://api.together.xyz/v1"

# ── 지원 오픈 모델 목록 (최신 2025-2026) ─────────────────────────────────────

SUPPORTED_MODELS = [
    # ── LLaMA 4 (Meta, 2025) ──────────────────────────────────────────────────
    {"id": "meta-llama/Llama-4-Scout-17B-16E-Instruct", "name": "LLaMA 4 Scout 17B",     "family": "LLaMA",   "size": "17B",  "vram": "40GB",  "year": 2025},
    {"id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", "name": "LLaMA 4 Maverick 17B", "family": "LLaMA", "size": "17B", "vram": "40GB", "year": 2025},
    # ── LLaMA 3.x (Meta) ──────────────────────────────────────────────────────
    {"id": "meta-llama/Llama-3.3-70B-Instruct",        "name": "LLaMA 3.3 70B Instruct", "family": "LLaMA",   "size": "70B",  "vram": "80GB",  "year": 2024},
    {"id": "meta-llama/Llama-3.1-8B-Instruct",         "name": "LLaMA 3.1 8B Instruct",  "family": "LLaMA",   "size": "8B",   "vram": "16GB",  "year": 2024},
    {"id": "meta-llama/Llama-3.2-3B-Instruct",         "name": "LLaMA 3.2 3B Instruct",  "family": "LLaMA",   "size": "3B",   "vram": "8GB",   "year": 2024},
    {"id": "meta-llama/Llama-3.2-1B-Instruct",         "name": "LLaMA 3.2 1B Instruct",  "family": "LLaMA",   "size": "1B",   "vram": "4GB",   "year": 2024},
    # ── Gemma 4 (Google, 2025) ────────────────────────────────────────────────
    {"id": "google/gemma-4-27b-it",                    "name": "Gemma 4 27B IT",          "family": "Gemma",   "size": "27B",  "vram": "54GB",  "year": 2025},
    {"id": "google/gemma-4-12b-it",                    "name": "Gemma 4 12B IT",          "family": "Gemma",   "size": "12B",  "vram": "24GB",  "year": 2025},
    {"id": "google/gemma-4-4b-it",                     "name": "Gemma 4 4B IT",           "family": "Gemma",   "size": "4B",   "vram": "10GB",  "year": 2025},
    {"id": "google/gemma-4-1b-it",                     "name": "Gemma 4 1B IT",           "family": "Gemma",   "size": "1B",   "vram": "4GB",   "year": 2025},
    # ── Gemma 3 (Google, 2025) ────────────────────────────────────────────────
    {"id": "google/gemma-3-27b-it",                    "name": "Gemma 3 27B IT",          "family": "Gemma",   "size": "27B",  "vram": "54GB",  "year": 2025},
    {"id": "google/gemma-3-12b-it",                    "name": "Gemma 3 12B IT",          "family": "Gemma",   "size": "12B",  "vram": "24GB",  "year": 2025},
    {"id": "google/gemma-3-4b-it",                     "name": "Gemma 3 4B IT",           "family": "Gemma",   "size": "4B",   "vram": "10GB",  "year": 2025},
    # ── Gemma 2 (Google) ──────────────────────────────────────────────────────
    {"id": "google/gemma-2-9b-it",                     "name": "Gemma 2 9B IT",           "family": "Gemma",   "size": "9B",   "vram": "18GB",  "year": 2024},
    {"id": "google/gemma-2-2b-it",                     "name": "Gemma 2 2B IT",           "family": "Gemma",   "size": "2B",   "vram": "8GB",   "year": 2024},
    # ── Qwen3 (Alibaba, 2025) ─────────────────────────────────────────────────
    {"id": "Qwen/Qwen3-72B",                           "name": "Qwen3 72B",               "family": "Qwen",    "size": "72B",  "vram": "80GB",  "year": 2025},
    {"id": "Qwen/Qwen3-30B-A3B",                       "name": "Qwen3 30B MoE",           "family": "Qwen",    "size": "30B",  "vram": "40GB",  "year": 2025},
    {"id": "Qwen/Qwen3-14B",                           "name": "Qwen3 14B",               "family": "Qwen",    "size": "14B",  "vram": "28GB",  "year": 2025},
    {"id": "Qwen/Qwen3-8B",                            "name": "Qwen3 8B",                "family": "Qwen",    "size": "8B",   "vram": "16GB",  "year": 2025},
    {"id": "Qwen/Qwen3-4B",                            "name": "Qwen3 4B",                "family": "Qwen",    "size": "4B",   "vram": "10GB",  "year": 2025},
    # ── Qwen 2.5 (Alibaba) ────────────────────────────────────────────────────
    {"id": "Qwen/Qwen2.5-72B-Instruct",                "name": "Qwen 2.5 72B Instruct",   "family": "Qwen",    "size": "72B",  "vram": "80GB",  "year": 2024},
    {"id": "Qwen/Qwen2.5-14B-Instruct",                "name": "Qwen 2.5 14B Instruct",   "family": "Qwen",    "size": "14B",  "vram": "28GB",  "year": 2024},
    {"id": "Qwen/Qwen2.5-7B-Instruct",                 "name": "Qwen 2.5 7B Instruct",    "family": "Qwen",    "size": "7B",   "vram": "14GB",  "year": 2024},
    # ── DeepSeek (2025) ───────────────────────────────────────────────────────
    {"id": "deepseek-ai/DeepSeek-R2-0528",             "name": "DeepSeek R2",             "family": "DeepSeek","size": "671B", "vram": "multi", "year": 2025},
    {"id": "deepseek-ai/DeepSeek-V3",                  "name": "DeepSeek V3",             "family": "DeepSeek","size": "671B", "vram": "multi", "year": 2024},
    {"id": "deepseek-ai/DeepSeek-R1",                  "name": "DeepSeek R1",             "family": "DeepSeek","size": "671B", "vram": "multi", "year": 2025},
    # ── Mistral (2025) ────────────────────────────────────────────────────────
    {"id": "mistralai/Mistral-Small-3.1-24B-Instruct", "name": "Mistral Small 3.1 24B",   "family": "Mistral", "size": "24B",  "vram": "48GB",  "year": 2025},
    {"id": "mistralai/Mistral-7B-Instruct-v0.3",       "name": "Mistral 7B Instruct",     "family": "Mistral", "size": "7B",   "vram": "14GB",  "year": 2024},
    # ── Phi (Microsoft, 2025) ─────────────────────────────────────────────────
    {"id": "microsoft/Phi-4",                          "name": "Phi-4 14B",               "family": "Phi",     "size": "14B",  "vram": "28GB",  "year": 2025},
    {"id": "microsoft/phi-4-mini-instruct",            "name": "Phi-4 Mini 3.8B",         "family": "Phi",     "size": "3.8B", "vram": "8GB",   "year": 2025},
    {"id": "microsoft/Phi-3.5-mini-instruct",          "name": "Phi 3.5 Mini",            "family": "Phi",     "size": "3.8B", "vram": "8GB",   "year": 2024},
    # ── SmolLM (Hugging Face, 2025) ───────────────────────────────────────────
    {"id": "HuggingFaceTB/SmolLM2-1.7B-Instruct",     "name": "SmolLM2 1.7B",            "family": "SmolLM",  "size": "1.7B", "vram": "4GB",   "year": 2024},
    # ── Command R (Cohere, 2025) ──────────────────────────────────────────────
    {"id": "CohereForAI/c4ai-command-r-plus-08-2024",  "name": "Command R+ 104B",         "family": "Command", "size": "104B", "vram": "multi", "year": 2024},
]

_SUPPORTED_MODEL_IDS = {m["id"] for m in SUPPORTED_MODELS}

# ── Pydantic 스키마 ───────────────────────────────────────────────────────────

_MAX_DATASET_EXAMPLES = 100_000
_MAX_CONCURRENT_JOBS  = 3


class DatasetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., max_length=255)
    description: str = ""
    format: str = Field("chat", pattern="^(chat|instruction|completion)$")
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


class JobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., max_length=255)
    dataset_id: str
    base_model: str
    method: str = Field("lora", pattern="^(lora|qlora|full)$")
    lora_rank: int = Field(16, ge=4, le=256)
    lora_alpha: int = Field(32, ge=4, le=512)
    epochs: int = Field(3, ge=1, le=20)
    learning_rate: float = Field(2e-4, gt=0, le=0.01)
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
@limiter.limit(RATE_FINE_TUNE_DATASET)
async def create_dataset(
    request: Request,
    body: DatasetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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
        .limit(200)
    )
    return [DatasetOut.from_orm(d) for d in result.scalars().all()]


@router.delete("/datasets/{dataset_id}", status_code=204)
@limiter.limit(RATE_FINE_TUNE_DATASET)
async def delete_dataset(
    request: Request,
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


# ── 학습 작업 ─────────────────────────────────────────────────────────────────

def _calc_total_steps(example_count: int, epochs: int, batch_size: int) -> int:
    return max(1, example_count // batch_size) * epochs


def _examples_to_jsonl(examples: list[dict], fmt: str) -> bytes:
    """Together AI / OpenAI fine-tuning 형식으로 JSONL 변환."""
    lines: list[str] = []
    for ex in examples:
        if fmt == "chat":
            # OpenAI ChatCompletion 형식 그대로 사용
            lines.append(json.dumps(ex, ensure_ascii=False))
        elif fmt == "instruction":
            # Alpaca → chat 형식 변환
            msgs = [
                {"role": "user",      "content": ex.get("instruction", "")},
                {"role": "assistant", "content": ex.get("output", "")},
            ]
            if ex.get("input"):
                msgs[0]["content"] += f"\n\n{ex['input']}"
            lines.append(json.dumps({"messages": msgs}, ensure_ascii=False))
        else:  # completion
            msgs = [
                {"role": "user",      "content": ex.get("prompt", "")},
                {"role": "assistant", "content": ex.get("completion", "")},
            ]
            lines.append(json.dumps({"messages": msgs}, ensure_ascii=False))
    return "\n".join(lines).encode("utf-8")


@contextlib.asynccontextmanager
async def _job_lifecycle(job_id: uuid.UUID):
    """예외 발생 시 job을 failed로 마킹."""
    from app.core.database import AsyncSessionLocal
    try:
        yield
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _logger.error("fine_tune job %s failed: %s", job_id, exc, exc_info=True)
        async with AsyncSessionLocal() as err_db:
            r = await err_db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
            job = r.scalar_one_or_none()
            if job and job.status == "running":
                job.status = "failed"
                job.error_message = str(exc)
                job.finished_at = datetime.now(timezone.utc)
                await err_db.commit()


async def _append_log(job_id: uuid.UUID, msg: str) -> None:
    from app.core.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        r = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
        job = r.scalar_one_or_none()
        if job:
            ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
            job.logs = list(job.logs or []) + [f"[{ts}] {msg}"]
            await db.commit()


# ── Together AI 실제 학습 ──────────────────────────────────────────────────────

async def _run_together_fine_tune(job_id: uuid.UUID, examples: list[dict], fmt: str) -> None:
    """Together AI API를 통한 실제 파인튜닝.

    1. JSONL 파일 업로드 (Files API)
    2. fine-tuning job 생성
    3. 30초 간격으로 상태 폴링 → DB 업데이트
    """
    from app.core.database import AsyncSessionLocal

    headers = {
        "Authorization": f"Bearer {settings.TOGETHER_API_KEY}",
        "Content-Type": "application/json",
    }

    async with _job_lifecycle(job_id):
        # ── 학습 데이터 로드 ─────────────────────────────────────────────────
        async with AsyncSessionLocal() as db:
            r = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
            job = r.scalar_one_or_none()
            if not job:
                return
            base_model = job.base_model
            config = job.config

        await _append_log(job_id, f"Together AI 학습 시작: {base_model}")

        jsonl_bytes = _examples_to_jsonl(examples, fmt)
        together_file_id: str | None = None

        # ── 1. 파일 업로드 ────────────────────────────────────────────────────
        async with httpx.AsyncClient(timeout=120) as client:
            upload_resp = await client.post(
                f"{_TOGETHER_BASE}/files",
                headers={"Authorization": f"Bearer {settings.TOGETHER_API_KEY}"},
                files={"file": ("train.jsonl", io.BytesIO(jsonl_bytes), "application/json")},
                data={"purpose": "fine-tune"},
            )
            if upload_resp.status_code not in (200, 201):
                raise RuntimeError(f"파일 업로드 실패: {upload_resp.text}")
            together_file_id = upload_resp.json()["id"]

        await _append_log(job_id, f"학습 데이터 업로드 완료: {together_file_id}")

        # ── 2. fine-tuning job 생성 ───────────────────────────────────────────
        ft_payload: dict[str, Any] = {
            "training_file": together_file_id,
            "model": base_model,
            "n_epochs": config.get("epochs", 3),
            "batch_size": config.get("batch_size", 4),
            "learning_rate": config.get("learning_rate", 2e-4),
            "lora": config.get("method", "lora") in ("lora", "qlora"),
            "lora_r": config.get("lora_rank", 16),
            "lora_alpha": config.get("lora_alpha", 32),
            "max_length": config.get("max_seq_length", 2048),
            "warmup_ratio": config.get("warmup_ratio", 0.1),
        }

        async with AsyncSessionLocal() as db:
            r = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
            job = r.scalar_one_or_none()
            if job and job.output_model_name:
                ft_payload["suffix"] = job.output_model_name[:18]

        async with httpx.AsyncClient(timeout=30) as client:
            create_resp = await client.post(
                f"{_TOGETHER_BASE}/fine_tuning/jobs",
                headers=headers,
                json=ft_payload,
            )
            if create_resp.status_code not in (200, 201):
                raise RuntimeError(f"학습 job 생성 실패: {create_resp.text}")
            ft_job = create_resp.json()
            together_job_id: str = ft_job["id"]

        await _append_log(job_id, f"Together AI job 생성: {together_job_id}")

        # together_job_id를 config에 저장
        async with AsyncSessionLocal() as db:
            r = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
            job = r.scalar_one_or_none()
            if job:
                job.config = {**job.config, "together_job_id": together_job_id, "together_file_id": together_file_id}
                await db.commit()

        # ── 3. 상태 폴링 ─────────────────────────────────────────────────────
        _STATUS_MAP = {
            "queued": "running", "pending": "running", "running": "running",
            "completed": "done", "failed": "failed", "cancelled": "cancelled",
            "error": "failed",
        }

        while True:
            await asyncio.sleep(30)

            async with httpx.AsyncClient(timeout=30) as client:
                poll_resp = await client.get(
                    f"{_TOGETHER_BASE}/fine_tuning/jobs/{together_job_id}",
                    headers=headers,
                )
            if poll_resp.status_code != 200:
                _logger.warning("Together AI 폴링 실패: %s", poll_resp.text)
                continue

            data = poll_resp.json()
            api_status: str = data.get("status", "running")
            local_status = _STATUS_MAP.get(api_status, "running")

            # 이벤트 수집 (훈련 metrics)
            async with httpx.AsyncClient(timeout=30) as client:
                events_resp = await client.get(
                    f"{_TOGETHER_BASE}/fine_tuning/jobs/{together_job_id}/events",
                    headers=headers,
                )
            events = events_resp.json().get("data", []) if events_resp.status_code == 200 else []

            train_losses = [e["loss"] for e in events if e.get("type") == "STEP_COMPLETE" and "loss" in e]
            steps_done = len(train_losses)

            async with AsyncSessionLocal() as db:
                r = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
                job = r.scalar_one_or_none()
                if not job or job.status in ("cancelled", "failed"):
                    # 취소 요청 시 Together AI job도 취소
                    if job and job.status == "cancelled":
                        async with httpx.AsyncClient(timeout=10) as client:
                            await client.post(
                                f"{_TOGETHER_BASE}/fine_tuning/jobs/{together_job_id}/cancel",
                                headers=headers,
                            )
                    return

                if steps_done > 0:
                    job.current_step = steps_done
                    job.progress = min(0.99, steps_done / max(1, job.total_steps))
                    job.metrics = {
                        "train_loss": train_losses,
                        "steps": list(range(1, steps_done + 1)),
                    }

                if local_status in ("done", "failed", "cancelled"):
                    job.status = local_status
                    job.progress = 1.0 if local_status == "done" else job.progress
                    job.finished_at = datetime.now(timezone.utc)
                    if local_status == "done" and data.get("output_name"):
                        job.output_model_name = data["output_name"]
                    if local_status == "failed":
                        job.error_message = data.get("message", "Together AI 학습 실패")

                await db.commit()

            await _append_log(job_id, f"상태: {api_status}, steps: {steps_done}, loss: {train_losses[-1]:.4f if train_losses else '—'}")

            if local_status in ("done", "failed", "cancelled"):
                break


# ── 시뮬레이션 폴백 (TOGETHER_API_KEY 미설정 시) ─────────────────────────────

async def _simulate_training(job_id: uuid.UUID) -> None:
    """TOGETHER_API_KEY 미설정 시 사용하는 시뮬레이션 폴백."""
    from app.core.database import AsyncSessionLocal

    async with _job_lifecycle(job_id):
        await asyncio.sleep(2)

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
            f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] [시뮬레이션] TOGETHER_API_KEY 미설정 — 모의 학습",
            f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] 방법: {job.method.upper()}, Epochs: {epochs}, Steps: {total_steps}",
        ]
        initial_loss = 2.4 + random.uniform(-0.2, 0.2)
        step_delay = max(0.3, min(2.0, 60.0 / total_steps))

        for step in range(1, total_steps + 1):
            async with AsyncSessionLocal() as check_db:
                r2 = await check_db.execute(select(FineTuneJob.status).where(FineTuneJob.id == job_id))
                if r2.scalar_one_or_none() != "running":
                    return

            if step <= warmup_steps:
                current_lr = lr * (step / max(1, warmup_steps))
            else:
                progress = (step - warmup_steps) / (total_steps - warmup_steps)
                current_lr = lr * 0.5 * (1 + math.cos(math.pi * progress))

            decay = math.exp(-3.5 * (step / total_steps))
            train_loss = initial_loss * (0.15 + 0.85 * decay) + random.gauss(0, 0.06)
            val_loss = train_loss + random.uniform(0.02, 0.12)
            metrics["steps"].append(step)
            metrics["train_loss"].append(round(max(0.05, train_loss), 4))
            metrics["val_loss"].append(round(max(0.07, val_loss), 4))
            metrics["learning_rate"].append(round(current_lr, 8))

            steps_per_epoch = total_steps // epochs
            if step % steps_per_epoch == 0:
                epoch_num = step // steps_per_epoch
                logs.append(
                    f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] "
                    f"Epoch {epoch_num}/{epochs} — loss: {train_loss:.4f}"
                )

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

        async with AsyncSessionLocal() as fin_db:
            r4 = await fin_db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
            fin_job = r4.scalar_one_or_none()
            if fin_job and fin_job.status == "running":
                fin_job.status = "done"
                fin_job.progress = 1.0
                fin_job.current_step = total_steps
                fin_job.finished_at = datetime.now(timezone.utc)
                logs.append(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] 시뮬레이션 완료")
                fin_job.logs = list(logs)
                await fin_db.commit()


async def _dispatch_fine_tune(job_id: uuid.UUID, examples: list[dict], fmt: str) -> None:
    """TOGETHER_API_KEY 유무에 따라 실제 학습 or 시뮬레이션 분기."""
    if settings.TOGETHER_API_KEY:
        await _run_together_fine_tune(job_id, examples, fmt)
    else:
        await _simulate_training(job_id)


# ── 학습 작업 엔드포인트 ──────────────────────────────────────────────────────

@router.post("/jobs", response_model=JobOut, status_code=201)
@limiter.limit(RATE_FINE_TUNE_JOB)
async def create_job(
    request: Request,
    body: JobCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.base_model not in _SUPPORTED_MODEL_IDS:
        raise HTTPException(status_code=422, detail=f"지원하지 않는 모델입니다: {body.base_model}")

    active_cnt = await db.scalar(
        select(func.count(FineTuneJob.id)).where(
            FineTuneJob.owner_id == current_user.id,
            FineTuneJob.status.in_(["running", "pending"]),
        )
    )
    if (active_cnt or 0) >= _MAX_CONCURRENT_JOBS:
        raise HTTPException(
            status_code=429,
            detail=f"동시 실행 제한: 최대 {_MAX_CONCURRENT_JOBS}개",
        )

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
        "method": body.method,
        "lora_rank": body.lora_rank,
        "lora_alpha": body.lora_alpha,
        "epochs": body.epochs,
        "learning_rate": body.learning_rate,
        "batch_size": body.batch_size,
        "max_seq_length": body.max_seq_length,
        "warmup_ratio": body.warmup_ratio,
        "using_api": bool(settings.TOGETHER_API_KEY),
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

    examples = list(dataset.examples)
    fmt = dataset.format
    background_tasks.add_task(_dispatch_fine_tune, job.id, examples, fmt)

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
        .limit(200)
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
@limiter.limit(RATE_FINE_TUNE_JOB)
async def cancel_job(
    request: Request,
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
