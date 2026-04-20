"""
워크플로우 실행 엔진 — Celery 'ai' 큐 태스크

## 실행 모델

워크플로우 그래프(nodes + edges)를 Kahn's algorithm으로 위상 정렬한 뒤
순서대로 각 노드를 실행한다. 각 노드의 출력은 `context` dict에 저장되어
이후 노드의 템플릿(`{{key}}` 치환)으로 전달된다.

```
WorkflowRun 생성 (status="running")
  │
  ▼
execute_workflow (Celery, ai queue)
  │
  ├─ 위상 정렬 (Kahn's algorithm)
  │
  ├─ 노드 순회
  │   ├─ 이미 완료된 스텝 건너뜀 (resume 재시작 지원)
  │   │
  │   ├─ InputNode  → context['input'] = body.inputs
  │   ├─ LLMNode    → run_agent 동기 호출 → context[node_id] = response
  │   ├─ ToolNode   → web_search / execute_python → context[node_id] = result
  │   ├─ BranchNode → eval(condition) → context[node_id+'_branch'] = 'true'/'false'
  │   ├─ HumanNode  → Redis SUSPEND 저장 → WS 이벤트 → 태스크 중단 ← 사람 승인 대기
  │   └─ OutputNode → WorkflowRun.outputs = context[source_node_id]
  │
  └─ 완료: run.status = "done"
```

## HumanNode 중단-재개 프로토콜

1. **중단**: execute_workflow가 HumanNode에 도달하면:
   - Redis에 `workflow:suspend:{run_id}` 키 저장 (TTL 24h)
     값: `{"node_id": "...", "context": {...}}`
   - WebSocket 채널에 `workflow_suspended` 이벤트 발행
   - Celery 태스크 정상 종료 (run.status = "suspended")

2. **재개**: POST /workflow/runs/{run_id}/resume 호출 시:
   - approved=True → Redis SUSPEND 삭제 + execute_workflow 재큐잉
     (완료된 WorkflowRunStep이 있는 노드는 자동 건너뜀)
   - approved=False → run.status = "failed"

## 조건 평가 보안

BranchNode의 조건식은 Python eval()을 사용하지만 AST 화이트리스트로
허용 노드를 제한한다:
  - 허용: Compare, BoolOp, BinOp, UnaryOp, Constant, Name, Call(len/str/int/float/bool)
  - 차단: Attribute(.__class__ 우회), Import, Subscript, Lambda, Yield 등
  - context 변수는 제한된 locals dict로만 전달 → 전역 스코프 접근 불가

## 멱등성 보장

Celery 태스크가 재시작되더라도 이미 완료된 WorkflowRunStep을 건너뛰므로
중복 실행이 발생하지 않는다. WorkflowRun.context에 중간 상태를 저장해
resume 후에도 이전 노드 출력값을 그대로 활용한다.
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
from app.core.redis_keys import key_workflow_suspend
from app.tasks._utils import UmaiBaseTask, publish_workflow_event, _get_redis
from app.models.workflow import Workflow, WorkflowRun, WorkflowRunStep

logger = get_task_logger(__name__)

_HUMAN_SUSPEND_TTL = 86_400  # 24시간 (사람이 승인 대기 최대)


class _WorkflowSuspended(Exception):
    """HumanNode가 사용자 승인을 기다리며 태스크를 중단할 때 발생."""
    def __init__(self, node_id: str) -> None:
        self.node_id = node_id


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
    """BranchNode 조건식 안전 평가 — AST 화이트리스트 검사 후 제한된 eval.

    eval() 자체를 제거하면 비교/산술 표현식을 지원하기 어렵다. 대신
    AST 노드를 허용 목록으로만 제한하여 샌드박스 탈출을 차단한다:
      - Attribute 접근 차단 → __class__.__mro__ 등 우회 불가
      - Import/Subscript/Lambda/Yield 등 금지
      - Call은 len/str/int/float/bool 만 허용
    """
    import ast as _ast

    _ALLOWED_NODES = (
        _ast.Expression,
        _ast.BoolOp, _ast.And, _ast.Or,
        _ast.UnaryOp, _ast.Not, _ast.UAdd, _ast.USub,
        _ast.Compare,
        _ast.Lt, _ast.LtE, _ast.Gt, _ast.GtE, _ast.Eq, _ast.NotEq,
        _ast.In, _ast.NotIn, _ast.Is, _ast.IsNot,
        _ast.BinOp,
        _ast.Add, _ast.Sub, _ast.Mult, _ast.Div, _ast.Mod, _ast.FloorDiv, _ast.Pow,
        _ast.Constant,
        _ast.Name,
        _ast.Call,
        _ast.List, _ast.Tuple,
    )
    _SAFE_FUNCS: dict = {"len": len, "str": str, "int": int, "float": float, "bool": bool}

    try:
        tree = _ast.parse(expr, mode="eval")
        for node in _ast.walk(tree):
            if not isinstance(node, _ALLOWED_NODES):
                logger.warning("_eval_condition: blocked AST node %s in %r", type(node).__name__, expr)
                return False
            if isinstance(node, _ast.Name) and node.id not in {**context, **_SAFE_FUNCS}:
                return False
            if isinstance(node, _ast.Call):
                if not isinstance(node.func, _ast.Name) or node.func.id not in _SAFE_FUNCS:
                    return False
        safe_env = {**_SAFE_FUNCS, **{k: v for k, v in context.items()}}
        return bool(eval(compile(tree, "<condition>", "eval"), {"__builtins__": {}}, safe_env))
    except (SyntaxError, ValueError, TypeError) as e:
        # 파싱/컴파일 오류 — 잘못된 조건식, 타입 불일치 등
        logger.warning("_eval_condition: expression error in %r: %s", expr, e)
        return False
    except Exception as e:
        # 예상치 못한 오류 — 디버깅을 위해 ERROR 레벨로 기록
        # (MemoryError, RecursionError 등이 여기로 오면 반드시 알아야 함)
        logger.error("_eval_condition: unexpected error in %r: %s", expr, e, exc_info=True)
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


# ── 노드 핸들러 ──────────────────────────────────────────────────────────────
# 각 함수: (node_id, node_data, run, run_id, owner_id, context, branch_targets, step, db) → dict
# HumanNode는 commit/publish 후 _WorkflowSuspended를 raise (early return 신호)

def _exec_input(node_id, node_data, run, run_id, owner_id, context, branch_targets, step, db) -> dict:
    return {"inputs": run.inputs}


def _exec_llm(node_id, node_data, run, run_id, owner_id, context, branch_targets, step, db) -> dict:
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
    return output


def _exec_tool(node_id, node_data, run, run_id, owner_id, context, branch_targets, step, db) -> dict:
    tool_name = node_data.get("tool_name", "web_search")
    raw_args = node_data.get("args", {})
    resolved_args = {
        k: _resolve_template(str(v), context) if isinstance(v, str) else v
        for k, v in raw_args.items()
    }
    tool_result = _run_tool_sync(tool_name, resolved_args)
    context[node_data.get("output_key", f"tool_{node_id}")] = tool_result
    return {"result": tool_result}


def _exec_human(node_id, node_data, run, run_id, owner_id, context, branch_targets, step, db) -> dict:
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
    raise _WorkflowSuspended(node_id)


def _exec_branch(node_id, node_data, run, run_id, owner_id, context, branch_targets, step, db) -> dict:
    condition = node_data.get("condition", "True")
    result_bool = _eval_condition(condition, context)
    context[f"branch_{node_id}"] = result_bool
    bt = branch_targets.get(node_id, {})
    true_targets = set(node_data.get("true_targets") or bt.get("true", []))
    false_targets = set(node_data.get("false_targets") or bt.get("false", []))
    skip = false_targets if result_bool else true_targets
    existing_skip = set(context.get("_branch_skip", []))
    context["_branch_skip"] = list(existing_skip | skip)
    return {"condition": condition, "result": result_bool}


def _exec_output(node_id, node_data, run, run_id, owner_id, context, branch_targets, step, db) -> dict:
    output_key = node_data.get("output_key", "result")
    value = context.get(output_key)
    if value is None:
        logger.warning(
            "OutputNode %s: key '%s' not found in context (keys: %s)",
            node_id, output_key, list(context.keys()),
        )
    output = {output_key: value}
    run.outputs = {**(run.outputs or {}), **output}
    return output


_NODE_HANDLERS: dict[str, Any] = {
    "input":  _exec_input,
    "llm":    _exec_llm,
    "tool":   _exec_tool,
    "human":  _exec_human,
    "branch": _exec_branch,
    "output": _exec_output,
}


# ── 메인 Celery 태스크 ────────────────────────────────────────────────────────

@shared_task(
    bind=True,
    base=UmaiBaseTask,
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

        # BranchNode의 true/false 경로를 엣지 sourceHandle에서 미리 구성
        # 프론트엔드가 true_targets/false_targets를 node_data에 저장하지 않아도 동작
        branch_targets: dict[str, dict[str, list[str]]] = {}
        for e in edges:
            src, tgt = e.get("source"), e.get("target")
            handle = e.get("sourceHandle")
            if src and tgt and handle in ("true", "false"):
                if src not in branch_targets:
                    branch_targets[src] = {"true": [], "false": []}
                branch_targets[src][handle].append(tgt)

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
                handler = _NODE_HANDLERS.get(node_type)
                if handler is None:
                    raise ValueError(f"Unknown node type: {node_type!r}")
                output: dict[str, Any] = handler(
                    node_id, node_data, run, run_id, owner_id, context, branch_targets, step, db
                )

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

            except _WorkflowSuspended as e:
                return {"status": "suspended", "node_id": e.node_id}

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
