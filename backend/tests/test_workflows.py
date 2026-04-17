"""
워크플로우 API 테스트.

TDD 커버 항목:
- POST   /workflow/             : 생성 201
- GET    /workflow/{id}         : 비소유자 403
- POST   /workflow/{id}/run     : 실행 시작 202
- GET    /workflow/runs/{rid}   : 비소유자 403
- GET    /workflow/{id}/runs    : 페이지네이션
- POST   /workflow/runs/{rid}/resume : suspended 아닌 상태 → 400
"""
import uuid
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

import pytest
from app.models.workflow import Workflow, WorkflowRun


# ── 헬퍼 픽스처 ──────────────────────────────────────────────────────────────

@pytest.fixture
async def workflow(client, admin_headers):
    """admin_user 소유의 워크플로우 하나 생성."""
    res = await client.post(
        "/api/v1/workflow",
        headers=admin_headers,
        json={"name": "Test Workflow", "description": ""},
    )
    assert res.status_code == 201
    return res.json()


@pytest.fixture
async def run_record(db, admin_user, workflow):
    """DB에 직접 WorkflowRun 생성 (Celery 없이)."""
    wf_id = uuid.UUID(workflow["id"])
    run = WorkflowRun(
        workflow_id=wf_id,
        owner_id=admin_user.id,
        status="running",
        inputs={},
        outputs={},
        context={},
    )
    db.add(run)
    await db.flush()
    return run


# ── POST /workflow/ ───────────────────────────────────────────────────────────

async def test_create_workflow_returns_201(client, admin_headers):
    res = await client.post(
        "/api/v1/workflow",
        headers=admin_headers,
        json={"name": "My Workflow"},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "My Workflow"
    assert "id" in data


async def test_create_workflow_requires_auth(client):
    res = await client.post("/api/v1/workflow", json={"name": "x"})
    assert res.status_code == 401


# ── GET /workflow/{id} ────────────────────────────────────────────────────────

async def test_get_workflow_owner_returns_200(client, admin_headers, workflow):
    res = await client.get(f"/api/v1/workflow/{workflow['id']}", headers=admin_headers)
    assert res.status_code == 200
    assert res.json()["id"] == workflow["id"]


async def test_get_workflow_other_user_returns_403(client, user_headers, workflow):
    """non-owner는 타인의 워크플로우에 접근할 수 없다."""
    res = await client.get(f"/api/v1/workflow/{workflow['id']}", headers=user_headers)
    assert res.status_code == 403


# ── POST /workflow/{id}/run ───────────────────────────────────────────────────

async def test_run_workflow_returns_202(client, admin_headers, workflow):
    """Celery apply_async를 모킹하고 실행 시작 202 확인."""
    mock_result = MagicMock()
    with patch("app.routers.workflows.execute_workflow") as mock_task:
        mock_task.apply_async.return_value = mock_result
        res = await client.post(
            f"/api/v1/workflow/{workflow['id']}/run",
            headers=admin_headers,
            json={"inputs": {}},
        )
    assert res.status_code == 202
    data = res.json()
    assert data["workflow_id"] == workflow["id"]
    assert data["status"] == "running"


# ── GET /workflow/runs/{run_id} ───────────────────────────────────────────────

async def test_get_run_owner_returns_200(client, admin_headers, run_record):
    res = await client.get(
        f"/api/v1/workflow/runs/{run_record.id}",
        headers=admin_headers,
    )
    assert res.status_code == 200
    assert res.json()["run_id"] == str(run_record.id)


async def test_get_run_other_user_returns_403(client, user_headers, run_record):
    """non-owner는 타인의 실행 기록을 조회할 수 없다."""
    res = await client.get(
        f"/api/v1/workflow/runs/{run_record.id}",
        headers=user_headers,
    )
    assert res.status_code == 403


# ── GET /workflow/{id}/runs ───────────────────────────────────────────────────

async def test_list_runs_empty(client, admin_headers, workflow):
    res = await client.get(
        f"/api/v1/workflow/{workflow['id']}/runs",
        headers=admin_headers,
        params={"page": 1, "limit": 5},
    )
    assert res.status_code == 200
    assert res.json() == []


async def test_list_runs_returns_created_run(client, admin_headers, workflow, run_record):
    res = await client.get(
        f"/api/v1/workflow/{workflow['id']}/runs",
        headers=admin_headers,
        params={"page": 1, "limit": 5},
    )
    assert res.status_code == 200
    run_ids = [r["run_id"] for r in res.json()]
    assert str(run_record.id) in run_ids


# ── POST /workflow/runs/{run_id}/resume ───────────────────────────────────────

async def test_resume_non_suspended_run_returns_400(client, admin_headers, run_record):
    """status != 'suspended' 인 run을 resume하면 400."""
    assert run_record.status == "running"
    res = await client.post(
        f"/api/v1/workflow/runs/{run_record.id}/resume",
        headers=admin_headers,
        json={"approved": True},
    )
    assert res.status_code == 400
