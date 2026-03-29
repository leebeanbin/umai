"""
워크플로우 실행 엔진 (ai queue)

execute_workflow:
  - DAG 위상 정렬 → 노드별 순차 실행
  - LLMNode   → run_agent 서브태스크 동기 호출
  - ToolNode  → 직접 도구 실행 (web_search / execute_python)
  - HumanNode → Redis SUSPEND 저장 + WS 이벤트 발행 → 태스크 종료
  - BranchNode → 조건 평가 → context에 분기 경로 기록
  - OutputNode → WorkflowRun.outputs 저장

resume:
  - Redis SUSPEND 삭제 + context에 human 결과 기록
  - execute_workflow 재큐잉 → 완료된 스텝 건너뜀
"""
import json
import logging
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any

from celery import shared_task
from celery.utils.log import get_task_logger

from app.core.database import sync_session
from app.core.redis_keys import key_workflow_suspend, key_task_notification
from app.tasks._utils import publish_workflow_event, _get_redis
from app.models.workflow import Workflow, WorkflowRun, WorkflowRunStep

logger = get_task_logger(__name__)

_HUMAN_SUSPEND_TTL = 86_400  # 24시간 (사람이 승인 대기 최대)


# ── DAG 유틸 ──────────────────────────────────────────────────────────────────

def _topological_sort(nodes: list[dict], edges: list[dict]) -> list[dict]:
    """Kahn's algorithm — 실행 순서 위상 정렬."""
    node_map = {n["id"]: n for n in nodes}
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}
    children: dict[str, list[str]] = {n["id"]: [] for n in nodes}

    for e in edges:
        src, tgt = e.get("source"), e.get("target")
        if src and tgt and src in in_degree and tgt in in_degree:
            in_degree[tgt] += 1
            children[src].append(tgt)

    queue = deque(nid for nid, deg in in_degree.items() if deg == 0)
    order: list[dict] = []
    while queue:
        nid = queue.popleft()
        order.append(node_map[nid])
        for child in children[nid]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    return order


def _resolve_template(text: str, context: dict) -> str:
    """{{key}} 형식의 템플릿을 context 값으로 치환."""
    for k, v in context.items():
        text = text.replace(f"{{{{{k}}}}}", str(v) if not isinstance(v, str) else v)
    return text


def _eval_condition(expr: str, context: dict) -> bool:
    """BranchNode 조건식 안전 평가 (제한된 내장 함수만 허용)."""
    try:
        safe_globals = {"__builtins__": {}, "len": len, "str": str, "int": int, "float": float}
        return bool(eval(expr, safe_globals, dict(context)))  # noqa: S307
    except Exception:
        return False


# ── 도구 실행 ─────────────────────────────────────────────────────────────────

def _run_tool_sync(tool_name: str, tool_args: dict) -> str:
    """동기 컨텍스트에서 도구 직접 실행 (ToolNode용)."""
    if tool_name == "web_search":
        from app.tasks.ai import _web_search  # lazy import (순환 방지)
        query = tool_args.get("query", "")
        max_results = int(tool_args.get("max_results", 5))
        return _web_search(query, max_results)

    if tool_name == "execute_python":
        from app.tasks.ai import _execute_python  # lazy import
        code = tool_args.get("code", "")
        return _execute_python(code)

    return json.dumps({"error": f"Unknown tool: {tool_name}"})


# ── 메인 Celery 태스크 ────────────────────────────────────────────────────────

@shared_task(
    bind=True,
    name="app.tasks.workflow.execute_workflow",
    queue="ai",
    max_retries=0,
    soft_time_limit=1500,
    time_limit=1800,
)
def execute_workflow(self, run_id: str) -> dict:
    """워크플로우 실행 — DAG 순서대로 노드 처리."""
    with sync_session() as db:
        run: WorkflowRun | None = db.get(WorkflowRun, uuid.UUID(run_id))
        if not run:
            logger.error("WorkflowRun %s not found", run_id)
            return {"status": "failed", "error": "run not found"}

        workflow: Workflow | None = db.get(Workflow, run.workflow_id)
        if not workflow:
            run.status = "failed"
            run.finished_at = datetime.now(timezone.utc)
            db.commit()
            return {"status": "failed", "error": "workflow not found"}

        graph = workflow.graph or {}
        nodes: list[dict] = graph.get("nodes", [])
        edges: list[dict] = graph.get("edges", [])
        owner_id = str(run.owner_id)

        # 기존 스텝 한 번에 로딩 — N+1 쿼리 방지 (루프당 SELECT 제거)
        existing_steps_list = (
            db.query(WorkflowRunStep)
            .filter(WorkflowRunStep.run_id == run.id)
            .all()
        )
        existing_steps: dict[str, WorkflowRunStep] = {s.node_id: s for s in existing_steps_list}
        done_steps: set[str] = {s.node_id for s in existing_steps_list if s.status == "done"}

        ordered_nodes = _topological_sort(nodes, edges)
        context: dict = dict(run.context or {})
        context.update(run.inputs or {})

        for node in ordered_nodes:
            node_id: str = node["id"]
            node_type: str = node.get("type", "")
            node_data: dict = node.get("data", {})

            # ── BranchNode 분기 필터링 ──
            # 이전 BranchNode가 next_path를 설정했다면, 다른 경로의 노드 건너뜀
            skip_branch = set(context.get("_branch_skip", []))
            if node_id in skip_branch:
                continue

            if node_id in done_steps:
                continue  # resume 시 이미 완료된 스텝 건너뜀

            # 스텝 레코드 upsert (캐시된 dict 사용 — DB 추가 조회 없음)
            step = existing_steps.get(node_id)
            if not step:
                step = WorkflowRunStep(
                    run_id=run.id,
                    node_id=node_id,
                    node_type=node_type,
                )
                db.add(step)
                existing_steps[node_id] = step

            step.status = "running"
            step.started_at = datetime.now(timezone.utc)
            step.input_data = {}  # context는 run.context에 중앙 저장 — 중복 스냅샷 제거
            db.commit()

            try:
                output: dict[str, Any] = {}

                # ── InputNode ── (데이터 패스스루, context 이미 초기화됨)
                if node_type == "input":
                    output = {"inputs": run.inputs}

                # ── LLMNode ── run_agent 인-프로세스 동기 실행
                # apply() 는 Celery 큐를 거치지 않고 현재 프로세스에서 직접 실행하므로
                # 동일 큐에서 대기하다 발생하는 데드락 위험이 없음
                elif node_type == "llm":
                    from app.tasks.ai import run_agent  # lazy import (순환 방지)
                    system_prompt = _resolve_template(
                        node_data.get("system_prompt", "You are a helpful assistant."), context
                    )
                    user_message = _resolve_template(
                        node_data.get("user_message", "{{user_input}}"), context
                    )
                    messages = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message},
                    ]
                    result = run_agent.apply(kwargs={
                        "messages": messages,
                        "model": node_data.get("model", "gpt-4o"),
                        "provider": node_data.get("provider", "openai"),
                        "enabled_tools": node_data.get("tools") or None,
                        "max_steps": node_data.get("max_steps", 10),
                        "temperature": node_data.get("temperature", 0.7),
                    }).result
                    output = {"response": result.get("content", ""), "steps": result.get("steps", 0)}
                    context[node_data.get("output_key", f"llm_{node_id}")] = output["response"]

                # ── ToolNode ── 직접 도구 실행
                elif node_type == "tool":
                    tool_name = node_data.get("tool_name", "web_search")
                    raw_args = node_data.get("args", {})
                    resolved_args = {
                        k: _resolve_template(str(v), context) if isinstance(v, str) else v
                        for k, v in raw_args.items()
                    }
                    tool_result = _run_tool_sync(tool_name, resolved_args)
                    output = {"result": tool_result}
                    context[node_data.get("output_key", f"tool_{node_id}")] = tool_result

                # ── HumanNode ── Redis SUSPEND + WS 이벤트 → 태스크 종료
                elif node_type == "human":
                    question = _resolve_template(
                        node_data.get("question", "계속 진행하시겠습니까?"), context
                    )
                    r = _get_redis()
                    r.setex(
                        key_workflow_suspend(run_id),
                        _HUMAN_SUSPEND_TTL,
                        json.dumps({"node_id": node_id, "question": question}),
                    )
                    step.status = "suspended"
                    step.finished_at = datetime.now(timezone.utc)
                    run.status = "suspended"
                    run.context = context
                    db.commit()
                    publish_workflow_event(owner_id, "workflow_suspended", {
                        "run_id": run_id,
                        "node_id": node_id,
                        "question": question,
                    })
                    return {"status": "suspended", "node_id": node_id}

                # ── BranchNode ── 조건 평가 → 분기 스킵 목록 설정
                elif node_type == "branch":
                    condition = node_data.get("condition", "True")
                    result_bool = _eval_condition(condition, context)
                    output = {"condition": condition, "result": result_bool}
                    context[f"branch_{node_id}"] = result_bool
                    # true_target / false_target 에 해당하지 않는 쪽 노드를 스킵
                    true_targets = set(node_data.get("true_targets", []))
                    false_targets = set(node_data.get("false_targets", []))
                    skip = false_targets if result_bool else true_targets
                    existing_skip = set(context.get("_branch_skip", []))
                    context["_branch_skip"] = list(existing_skip | skip)

                # ── OutputNode ── 최종 결과 저장
                elif node_type == "output":
                    output_key = node_data.get("output_key", "result")
                    value = context.get(output_key, context)
                    output = {output_key: value}
                    run.outputs = {**(run.outputs or {}), **output}

                step.status = "done"
                step.output_data = output
                step.finished_at = datetime.now(timezone.utc)
                run.context = context
                db.commit()

                publish_workflow_event(owner_id, "workflow_step_done", {
                    "run_id": run_id,
                    "node_id": node_id,
                    "node_type": node_type,
                    "status": "done",
                })

            except Exception as exc:
                logger.error("execute_workflow node %s failed: %s", node_id, exc)
                step.status = "failed"
                step.output_data = {"error": str(exc)}
                step.finished_at = datetime.now(timezone.utc)
                run.status = "failed"
                run.finished_at = datetime.now(timezone.utc)
                run.context = context
                db.commit()
                publish_workflow_event(owner_id, "workflow_failed", {
                    "run_id": run_id,
                    "node_id": node_id,
                    "error": str(exc),
                })
                return {"status": "failed", "error": str(exc)}

        run.status = "done"
        run.finished_at = datetime.now(timezone.utc)
        db.commit()

    publish_workflow_event(owner_id, "workflow_done", {
        "run_id": run_id,
        "outputs": run.outputs,
    })
    return {"status": "done", "outputs": run.outputs}
