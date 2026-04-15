"""
워크플로우 CRUD + 실행 API

엔드포인트:
  POST   /workflow/                      — 워크플로우 생성
  GET    /workflow/                      — 목록 (owner 기준)
  GET    /workflow/{id}                  — 단건 조회
  PUT    /workflow/{id}                  — 그래프 저장 (nodes + edges)
  DELETE /workflow/{id}                  — 삭제
  POST   /workflow/{id}/run              — 실행 시작
  GET    /workflow/runs/{run_id}         — 실행 상태 + 스텝별 결과
  POST   /workflow/runs/{run_id}/resume  — HumanNode 승인/거부
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel, Field
from sqlalchemy import func, select, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import RATE_WORKFLOW_RESUME
from app.core.database import get_db
from app.core.redis import get_redis
from app.core.redis_keys import key_workflow_suspend
from app.models.workflow import Workflow, WorkflowRun, WorkflowRunStep
from app.routers.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/workflow", tags=["workflow"], redirect_slashes=False)
limiter = Limiter(key_func=get_remote_address)


# ── Pydantic 스키마 ───────────────────────────────────────────────────────────

class WorkflowCreate(BaseModel):
    name: str = Field(..., max_length=200)
    description: str = ""
    graph: dict = Field(default_factory=lambda: {"nodes": [], "edges": []})


class WorkflowUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    description: str | None = None
    graph: dict | None = None


class WorkflowOut(BaseModel):
    id: str
    name: str
    description: str
    graph: dict
    created_at: str
    updated_at: str

    @classmethod
    def from_orm(cls, w: Workflow) -> "WorkflowOut":
        return cls(
            id=str(w.id),
            name=w.name,
            description=w.description or "",
            graph=w.graph or {},
            created_at=w.created_at.isoformat(),
            updated_at=w.updated_at.isoformat() if w.updated_at else w.created_at.isoformat(),
        )


class RunRequest(BaseModel):
    inputs: dict = Field(default_factory=dict)


class RunStepOut(BaseModel):
    node_id: str
    node_type: str
    status: str
    input_data: dict
    output_data: dict
    started_at: str | None
    finished_at: str | None


class RunOut(BaseModel):
    run_id: str
    workflow_id: str
    status: str
    inputs: dict
    outputs: dict
    context: dict
    started_at: str
    finished_at: str | None
    steps: list[RunStepOut]


class ResumeRequest(BaseModel):
    approved: bool
    note: str = ""


class RunListItem(BaseModel):
    run_id: str
    status: str
    started_at: str
    finished_at: str | None
    duration_s: float | None
    step_count: int


class WorkflowStats(BaseModel):
    total_runs: int
    done: int
    failed: int
    suspended: int
    running: int
    avg_duration_s: float | None


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _run_out(run: WorkflowRun, steps: list[WorkflowRunStep]) -> RunOut:
    return RunOut(
        run_id=str(run.id),
        workflow_id=str(run.workflow_id),
        status=run.status,
        inputs=run.inputs or {},
        outputs=run.outputs or {},
        context=run.context or {},
        started_at=run.started_at.isoformat(),
        finished_at=run.finished_at.isoformat() if run.finished_at else None,
        steps=[
            RunStepOut(
                node_id=s.node_id,
                node_type=s.node_type,
                status=s.status,
                input_data=s.input_data or {},
                output_data=s.output_data or {},
                started_at=s.started_at.isoformat() if s.started_at else None,
                finished_at=s.finished_at.isoformat() if s.finished_at else None,
            )
            for s in steps
        ],
    )


def _assert_owner(resource_owner_id: uuid.UUID, user: User, resource: str = "resource") -> None:
    if resource_owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"{resource} not found or access denied")


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.post("", response_model=WorkflowOut, status_code=201)
async def create_workflow(
    body: WorkflowCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkflowOut:
    wf = Workflow(
        owner_id=current_user.id,
        name=body.name,
        description=body.description,
        graph=body.graph,
    )
    db.add(wf)
    await db.commit()
    await db.refresh(wf)
    return WorkflowOut.from_orm(wf)


@router.get("", response_model=list[WorkflowOut])
async def list_workflows(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WorkflowOut]:
    result = await db.execute(
        select(Workflow)
        .where(Workflow.owner_id == current_user.id)
        .order_by(Workflow.updated_at.desc())
    )
    return [WorkflowOut.from_orm(w) for w in result.scalars().all()]


@router.get("/runs/{run_id}", response_model=RunOut)
async def get_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RunOut:
    run = await db.get(WorkflowRun, uuid.UUID(run_id))
    if not run:
        raise HTTPException(404, "Run not found")
    _assert_owner(run.owner_id, current_user, "Run")
    steps_result = await db.execute(
        select(WorkflowRunStep)
        .where(WorkflowRunStep.run_id == run.id)
        .order_by(WorkflowRunStep.started_at.asc())
    )
    steps = list(steps_result.scalars().all())
    return _run_out(run, steps)


@router.get("/{workflow_id}", response_model=WorkflowOut)
async def get_workflow(
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkflowOut:
    wf = await db.get(Workflow, uuid.UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    _assert_owner(wf.owner_id, current_user, "Workflow")
    return WorkflowOut.from_orm(wf)


@router.patch("/{workflow_id}", response_model=WorkflowOut)
async def update_workflow(
    workflow_id: str,
    body: WorkflowUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkflowOut:
    wf = await db.get(Workflow, uuid.UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    _assert_owner(wf.owner_id, current_user, "Workflow")
    if body.name is not None:
        wf.name = body.name
    if body.description is not None:
        wf.description = body.description
    if body.graph is not None:
        wf.graph = body.graph
    wf.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(wf)
    return WorkflowOut.from_orm(wf)


@router.delete("/{workflow_id}", status_code=204)
async def delete_workflow(
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    wf = await db.get(Workflow, uuid.UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    _assert_owner(wf.owner_id, current_user, "Workflow")
    await db.delete(wf)
    await db.commit()


# ── 실행 ──────────────────────────────────────────────────────────────────────

@router.post("/{workflow_id}/run", response_model=RunOut, status_code=202)
async def run_workflow(
    workflow_id: str,
    body: RunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RunOut:
    wf = await db.get(Workflow, uuid.UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    _assert_owner(wf.owner_id, current_user, "Workflow")

    run = WorkflowRun(
        workflow_id=wf.id,
        owner_id=current_user.id,
        status="running",
        inputs=body.inputs,
        outputs={},
        context={},
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    # Celery 비동기 실행 — task_id=run_id 로 설정해 취소 시 별도 컬럼 없이 revoke 가능
    from app.tasks.workflow import execute_workflow  # lazy import
    execute_workflow.apply_async(args=[str(run.id)], queue="ai", task_id=str(run.id))

    return _run_out(run, [])


@router.post("/runs/{run_id}/resume", response_model=RunOut)
@limiter.limit(RATE_WORKFLOW_RESUME)
async def resume_run(
    request: Request,
    run_id: str,
    body: ResumeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RunOut:
    run = await db.get(WorkflowRun, uuid.UUID(run_id))
    if not run:
        raise HTTPException(404, "Run not found")
    _assert_owner(run.owner_id, current_user, "Run")

    if run.status != "suspended":
        raise HTTPException(400, f"Run is not suspended (status: {run.status})")

    redis = await get_redis()
    suspend_raw = await redis.get(key_workflow_suspend(run_id))
    if not suspend_raw:
        raise HTTPException(400, "Suspend state expired or not found")

    suspend_data = json.loads(suspend_raw)
    node_id = suspend_data["node_id"]

    # HumanNode 결과를 context에 저장
    context = dict(run.context or {})
    context[f"human_{node_id}"] = {"approved": body.approved, "note": body.note}

    if not body.approved:
        # 거부 → 워크플로우 실패 처리
        await redis.delete(key_workflow_suspend(run_id))
        run.status = "failed"
        run.context = context
        run.finished_at = datetime.now(timezone.utc)
        await db.commit()
        from app.tasks._utils import publish_workflow_event
        publish_workflow_event(str(run.owner_id), "workflow_failed", {
            "run_id": run_id,
            "error": f"Human node '{node_id}' rejected: {body.note}",
        })
    else:
        # 승인 → HumanNode 스텝을 done으로 마킹 + Celery 재큐잉
        await redis.delete(key_workflow_suspend(run_id))
        step_result = await db.execute(
            select(WorkflowRunStep).where(
                WorkflowRunStep.run_id == run.id,
                WorkflowRunStep.node_id == node_id,
            )
        )
        step = step_result.scalar_one_or_none()
        if step:
            step.status = "done"
            step.output_data = {"approved": True, "note": body.note}
            step.finished_at = datetime.now(timezone.utc)

        run.status = "running"
        run.context = context
        await db.commit()

        from app.tasks.workflow import execute_workflow  # lazy import
        try:
            execute_workflow.apply_async(args=[run_id], queue="ai")
        except Exception as exc:
            # Celery 브로커 장애 시 DB를 롤백하고 클라이언트에 알림
            run.status = "suspended"
            await db.commit()
            raise HTTPException(503, f"Failed to re-queue workflow: {exc}") from exc

    await db.refresh(run)
    steps_result = await db.execute(
        select(WorkflowRunStep)
        .where(WorkflowRunStep.run_id == run.id)
        .order_by(WorkflowRunStep.started_at.asc())
    )
    steps = list(steps_result.scalars().all())
    return _run_out(run, steps)


# ── 실행 히스토리 ──────────────────────────────────────────────────────────────

@router.get("/{workflow_id}/runs", response_model=list[RunListItem])
async def list_runs(
    workflow_id: str,
    page: int = Query(1, ge=1, le=1000),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[RunListItem]:
    wf = await db.get(Workflow, uuid.UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    _assert_owner(wf.owner_id, current_user, "Workflow")

    runs_result = await db.execute(
        select(WorkflowRun)
        .where(WorkflowRun.workflow_id == wf.id)
        .order_by(WorkflowRun.started_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    runs = list(runs_result.scalars().all())

    # 스텝 수 한번에 집계
    if runs:
        run_ids = [r.id for r in runs]
        counts_result = await db.execute(
            select(WorkflowRunStep.run_id, func.count().label("cnt"))
            .where(WorkflowRunStep.run_id.in_(run_ids))
            .group_by(WorkflowRunStep.run_id)
        )
        step_counts: dict[uuid.UUID, int] = {row.run_id: row.cnt for row in counts_result}
    else:
        step_counts = {}

    items: list[RunListItem] = []
    for r in runs:
        duration = None
        if r.finished_at and r.started_at:
            duration = (r.finished_at - r.started_at).total_seconds()
        items.append(RunListItem(
            run_id=str(r.id),
            status=r.status,
            started_at=r.started_at.isoformat(),
            finished_at=r.finished_at.isoformat() if r.finished_at else None,
            duration_s=duration,
            step_count=step_counts.get(r.id, 0),
        ))
    return items


# ── 실행 취소 ─────────────────────────────────────────────────────────────────

async def _do_cancel_run(run_id: str, db: AsyncSession, current_user: User) -> None:
    """공통 취소 로직 — POST /cancel 과 DELETE 양쪽에서 재사용."""
    run = await db.get(WorkflowRun, uuid.UUID(run_id))
    if not run:
        raise HTTPException(404, "Run not found")
    _assert_owner(run.owner_id, current_user, "Run")

    if run.status not in ("running", "suspended"):
        raise HTTPException(400, f"Cannot cancel run with status '{run.status}'")

    # Celery task revoke — task_id == run_id 패턴
    from app.core.celery_app import celery_app
    celery_app.control.revoke(run_id, terminate=True, signal="SIGTERM")

    run.status = "failed"
    run.finished_at = datetime.now(timezone.utc)
    await db.commit()

    from app.tasks._utils import publish_workflow_event
    publish_workflow_event(str(run.owner_id), "workflow_failed", {
        "run_id": run_id,
        "error": "Cancelled by user",
    })


@router.post("/runs/{run_id}/cancel", status_code=204)
async def cancel_run_post(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """워크플로우 실행 취소 (권장 방식: POST /runs/{run_id}/cancel)."""
    await _do_cancel_run(run_id, db, current_user)


@router.delete("/runs/{run_id}", status_code=204)
async def cancel_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """워크플로우 실행 취소 (하위 호환 유지 — POST /runs/{run_id}/cancel 사용 권장)."""
    await _do_cancel_run(run_id, db, current_user)


# ── 워크플로우 통계 ────────────────────────────────────────────────────────────

@router.get("/{workflow_id}/stats", response_model=WorkflowStats)
async def get_workflow_stats(
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkflowStats:
    wf = await db.get(Workflow, uuid.UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    _assert_owner(wf.owner_id, current_user, "Workflow")

    # status별 카운트 — DB GROUP BY로 처리 (전체 rows 메모리 로딩 제거)
    counts_result = await db.execute(
        select(WorkflowRun.status, func.count().label("cnt"))
        .where(WorkflowRun.workflow_id == wf.id)
        .group_by(WorkflowRun.status)
    )
    counts: dict[str, int] = {row.status: row.cnt for row in counts_result}

    # done 실행의 평균 소요 시간 — DB에서 직접 집계
    avg_result = await db.execute(
        select(
            func.avg(
                func.extract("epoch", WorkflowRun.finished_at)
                - func.extract("epoch", WorkflowRun.started_at)
            )
        )
        .where(
            WorkflowRun.workflow_id == wf.id,
            WorkflowRun.status == "done",
            WorkflowRun.finished_at.isnot(None),
            WorkflowRun.started_at.isnot(None),
        )
    )
    avg_duration = avg_result.scalar()

    total = sum(counts.values())
    return WorkflowStats(
        total_runs=total,
        done=counts.get("done", 0),
        failed=counts.get("failed", 0),
        suspended=counts.get("suspended", 0),
        running=counts.get("running", 0),
        avg_duration_s=float(avg_duration) if avg_duration is not None else None,
    )
