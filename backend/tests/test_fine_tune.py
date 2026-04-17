"""
파인튜닝 API 테스트.

TDD 커버 항목:
- POST   /fine-tune/datasets          : 생성 201 (JSONL 파싱)
- DELETE /fine-tune/datasets/{id}     : 비소유자 → 404
- POST   /fine-tune/jobs              : 지원하지 않는 base_model → 422
- POST   /fine-tune/jobs/{id}/cancel  : 이미 완료된 job → 400
"""
import json
import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from app.models.fine_tune import FineTuneJob, TrainingDataset

# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

_VALID_JSONL = "\n".join([
    json.dumps({"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]})
    for _ in range(5)
])

_VALID_MODEL = "meta-llama/Llama-3.2-3B-Instruct"


@pytest.fixture
async def dataset(client, admin_headers):
    """admin_user 소유의 데이터셋 하나 생성."""
    res = await client.post(
        "/api/v1/fine-tune/datasets",
        headers=admin_headers,
        json={"name": "Test Dataset", "format": "chat", "raw_data": _VALID_JSONL},
    )
    assert res.status_code == 201
    return res.json()


@pytest.fixture
async def done_job(db, admin_user, dataset):
    """DB에 직접 완료된 FineTuneJob 생성."""
    ds_id = uuid.UUID(dataset["id"])
    job = FineTuneJob(
        owner_id=admin_user.id,
        name="Completed Job",
        dataset_id=ds_id,
        base_model=_VALID_MODEL,
        method="lora",
        config={},
        status="done",
        total_steps=10,
        finished_at=datetime.now(timezone.utc),
    )
    db.add(job)
    await db.flush()
    return job


# ── POST /fine-tune/datasets ─────────────────────────────────────────────────

async def test_create_dataset_returns_201(client, admin_headers):
    res = await client.post(
        "/api/v1/fine-tune/datasets",
        headers=admin_headers,
        json={"name": "My Dataset", "format": "chat", "raw_data": _VALID_JSONL},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "My Dataset"
    assert data["example_count"] == 5
    assert data["format"] == "chat"


async def test_create_dataset_requires_auth(client):
    res = await client.post(
        "/api/v1/fine-tune/datasets",
        json={"name": "x", "format": "chat", "raw_data": "{}"},
    )
    assert res.status_code == 401


async def test_create_dataset_invalid_jsonl_returns_422(client, admin_headers):
    res = await client.post(
        "/api/v1/fine-tune/datasets",
        headers=admin_headers,
        json={"name": "Bad", "format": "chat", "raw_data": "not valid json{{{"},
    )
    assert res.status_code == 422


# ── DELETE /fine-tune/datasets/{id} ──────────────────────────────────────────

async def test_delete_dataset_owner_returns_204(client, admin_headers, dataset):
    res = await client.delete(
        f"/api/v1/fine-tune/datasets/{dataset['id']}",
        headers=admin_headers,
    )
    assert res.status_code == 204


async def test_delete_dataset_other_user_returns_404(client, user_headers, dataset):
    """비소유자는 타인의 데이터셋을 삭제할 수 없다 (→ 404 not 403 to avoid enumeration)."""
    res = await client.delete(
        f"/api/v1/fine-tune/datasets/{dataset['id']}",
        headers=user_headers,
    )
    assert res.status_code == 404


# ── POST /fine-tune/jobs ──────────────────────────────────────────────────────

async def test_create_job_unsupported_model_returns_422(client, admin_headers, dataset):
    res = await client.post(
        "/api/v1/fine-tune/jobs",
        headers=admin_headers,
        json={
            "name": "Bad Job",
            "dataset_id": dataset["id"],
            "base_model": "openai/gpt-4o",  # not in SUPPORTED_MODELS
        },
    )
    assert res.status_code == 422


async def test_create_job_valid_model_returns_201(client, admin_headers, dataset):
    with patch("app.routers.fine_tune._simulate_training"):
        res = await client.post(
            "/api/v1/fine-tune/jobs",
            headers=admin_headers,
            json={
                "name": "Valid Job",
                "dataset_id": dataset["id"],
                "base_model": _VALID_MODEL,
            },
        )
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "running"
    assert data["base_model"] == _VALID_MODEL


# ── POST /fine-tune/jobs/{id}/cancel ─────────────────────────────────────────

async def test_cancel_completed_job_returns_400(client, admin_headers, done_job):
    """이미 완료된(done) job은 취소할 수 없다."""
    res = await client.post(
        f"/api/v1/fine-tune/jobs/{done_job.id}/cancel",
        headers=admin_headers,
    )
    assert res.status_code == 400


async def test_cancel_running_job_returns_200(client, admin_headers, dataset):
    """running 상태의 job은 취소 가능."""
    with patch("app.routers.fine_tune._simulate_training"):
        create_res = await client.post(
            "/api/v1/fine-tune/jobs",
            headers=admin_headers,
            json={
                "name": "Running Job",
                "dataset_id": dataset["id"],
                "base_model": _VALID_MODEL,
            },
        )
    assert create_res.status_code == 201
    job_id = create_res.json()["id"]

    cancel_res = await client.post(
        f"/api/v1/fine-tune/jobs/{job_id}/cancel",
        headers=admin_headers,
    )
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "cancelled"
