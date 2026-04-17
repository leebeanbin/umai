# 워크플로우 엔진 (Workflow Engine)

## 개요

사용자가 노드를 연결해 만든 DAG(Directed Acyclic Graph)를 실행하는 시각적 파이프라인 엔진입니다.
LLM 호출, 조건 분기, 도구 실행, 인간 승인 대기를 노드로 구성합니다.

---

## 노드 타입

| 노드 | 역할 |
|---|---|
| `InputNode` | 워크플로우 진입점, 사용자 입력을 context에 주입 |
| `LLMNode` | LLM 호출, 이전 노드 출력을 프롬프트에 `{{변수}}` 치환 |
| `ToolNode` | web_search / execute_python 도구 실행 |
| `BranchNode` | 조건식 평가 → true/false 분기 |
| `HumanNode` | 실행 중단 → 사람 승인 대기 → 재개 |
| `OutputNode` | 최종 결과를 `WorkflowRun.outputs`에 저장 |

---

## 실행 흐름

```
POST /workflow/{id}/run
    │
    ▼
WorkflowRun 생성 (status="running")
    │
    ▼
execute_workflow.apply_async()   ← Celery ai 큐
    │
    ▼
위상 정렬 (Kahn's algorithm)
    │
    ▼
노드 순회:
    for node in sorted_nodes:
        ├─ 이미 완료된 스텝? → 건너뜀 (idempotency)
        ├─ BranchNode가 건너뛰라 했나? → 건너뜀
        ├─ handler = _NODE_HANDLERS[node_type]
        ├─ output = handler(...)
        ├─ context[node_id] = output
        └─ WorkflowRunStep 기록
    │
    ▼
WorkflowRun.status = "done"
    │
    ▼
WebSocket 이벤트 발행 → 프론트엔드 업데이트
```

---

## Kahn's Algorithm (위상 정렬)

```python
# backend/app/tasks/workflow.py:86
def _topological_sort(nodes, edges):
    in_degree = {n["id"]: 0 for n in nodes}
    children  = {n["id"]: [] for n in nodes}

    for e in edges:
        in_degree[e["target"]] += 1
        children[e["source"]].append(e["target"])

    # in_degree == 0인 노드부터 큐에 넣음
    queue = deque(nid for nid, deg in in_degree.items() if deg == 0)
    order = []
    while queue:
        nid = queue.popleft()
        order.append(node_map[nid])
        for child in children[nid]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)
    return order
```

BFS 기반 위상 정렬입니다. 사이클이 있으면 일부 노드가 order에 포함되지 않으므로
사이클 감지도 자동으로 됩니다.

---

## Dispatch Dict 패턴

```python
# backend/app/tasks/workflow.py

_NODE_HANDLERS: dict[str, Any] = {
    "input":  _exec_input,
    "llm":    _exec_llm,
    "tool":   _exec_tool,
    "human":  _exec_human,
    "branch": _exec_branch,
    "output": _exec_output,
}

# 실행부 — if-elif 체인 대신 딕셔너리 디스패치
handler = _NODE_HANDLERS.get(node_type)
if handler is None:
    raise ValueError(f"Unknown node type: {node_type!r}")
output = handler(node_id, node_data, run, ...)
```

이전에는 150줄짜리 `if node_type == "input": ... elif node_type == "llm": ...` 체인이었습니다.
새 노드 타입을 추가할 때 기존 코드를 수정하지 않고 핸들러 함수와 딕셔너리 엔트리만 추가합니다.

---

## HumanNode: 중단-재개 프로토콜

가장 복잡한 노드입니다. Celery 태스크를 정지하고 사람의 승인을 기다립니다.

### 중단

```python
# backend/app/tasks/workflow.py — _exec_human()
def _exec_human(node_id, node_data, run, run_id, owner_id, context, ...):
    # 1. Redis에 중단 상태 저장 (TTL 24시간)
    _get_redis().setex(
        key_workflow_suspend(str(run_id)),
        _HUMAN_SUSPEND_TTL,
        json.dumps({"node_id": node_id, "context": context})
    )
    # 2. DB에 status = "suspended"
    run.status = "suspended"
    db.commit()
    # 3. WebSocket 이벤트 발행
    publish_workflow_event(str(owner_id), str(run_id), "workflow_suspended", ...)
    # 4. 예외를 던져 태스크 루프 종료
    raise _WorkflowSuspended(node_id)
```

`_WorkflowSuspended`는 일반 예외처럼 보이지만 정상적인 제어 흐름입니다.
`execute_workflow`의 메인 루프에서 이를 잡아 `{"status": "suspended"}`를 반환합니다.

### 재개

```python
# backend/app/routers/workflows.py — resume_run endpoint
# POST /workflow/runs/{run_id}/resume?approved=true

suspend_data = redis.get(key_workflow_suspend(run_id))  # 저장된 컨텍스트 복원
redis.delete(key_workflow_suspend(run_id))              # 중단 상태 삭제
run.context = suspend_data["context"]                   # 이전 컨텍스트 복원

# 완료된 WorkflowRunStep이 있는 노드는 건너뜀 (멱등성)
execute_workflow.apply_async(args=[str(run_id)])        # 태스크 재큐잉
```

### 멱등성 보장

```python
# 이미 완료된 스텝은 건너뜀
done_steps = {s.node_id for s in existing_steps if s.status == "done"}
if node_id in done_steps:
    continue
```

Celery 태스크는 재시작될 수 있습니다(워커 재시작, 브로커 재연결 등).
재시작 시 처음부터 다시 실행하면 LLM 호출이 중복됩니다.
`WorkflowRunStep`에 완료된 노드를 기록하고, 재시작 시 건너뜁니다.

---

## BranchNode: 안전한 조건 평가

```python
# backend/app/tasks/workflow.py — _exec_branch()

# 허용된 AST 노드만 평가
ALLOWED_NODES = {
    ast.Expression, ast.Compare, ast.BoolOp, ast.BinOp,
    ast.UnaryOp, ast.Constant, ast.Name, ast.Call,
}
# 허용된 함수 이름
ALLOWED_FUNCS = {"len", "str", "int", "float", "bool"}
```

Python `eval()`은 강력하지만 위험합니다. `eval("__import__('os').system('rm -rf /')")`처럼
악의적 코드가 실행될 수 있습니다. AST 화이트리스트로 허용된 표현식만 실행합니다:

```python
# 허용: context.get('score', 0) > 0.5
# 차단: __import__('os').system('ls')
# 차단: lambda x: x  (Lambda 노드 미허용)
# 차단: [x for x in range(10)]  (ListComp 미허용)
```

`context` 변수는 제한된 `locals` dict로만 전달합니다:

```python
result = eval(condition, {"__builtins__": {}}, {"context": context})
```

`__builtins__`를 빈 dict로 설정하면 `print`, `open`, `__import__` 등
내장 함수가 모두 비활성화됩니다.

---

## 컨텍스트 변수 치환

```python
# LLMNode 프롬프트에서 {{변수}} 치환
# context = {"input": {"message": "안녕"}, "node_1": "LLM 응답 텍스트"}
# 프롬프트: "다음을 요약해줘: {{node_1}}"
# → "다음을 요약해줘: LLM 응답 텍스트"

import re
def _substitute(template: str, context: dict) -> str:
    def replacer(m):
        key = m.group(1).strip()
        val = context.get(key, "")
        return str(val) if not isinstance(val, str) else val
    return re.sub(r"\{\{(.+?)\}\}", replacer, template)
```

---

## 프론트엔드 노드 에디터

```
frontend/src/app/workflow/[id]/page.tsx       — 캔버스 (React Flow)
frontend/src/components/workflow/
    ├── NodePalette.tsx                        — 좌측 노드 팔레트
    ├── NodeConfigPanel.tsx                    — 우측 노드 설정 패널
    └── nodes/
        ├── LLMNode.tsx
        ├── ToolNode.tsx
        ├── BranchNode.tsx
        ├── HumanNode.tsx
        ├── InputNode.tsx
        └── OutputNode.tsx
```

React Flow 라이브러리를 사용합니다. 각 노드는 커스텀 React 컴포넌트로 렌더링되고,
엣지는 드래그로 연결합니다. 저장 시 `{nodes: [...], edges: [...]}` JSON을
`Workflow.graph` 컬럼(JSONB)에 저장합니다.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `backend/app/tasks/workflow.py` | 실행 엔진, 핸들러, 위상 정렬 |
| `backend/app/routers/workflows.py` | REST API (생성/실행/재개/취소) |
| `backend/app/models/workflow.py` | `Workflow`, `WorkflowRun`, `WorkflowRunStep` |
| `frontend/src/app/workflow/` | 에디터 UI, 실행 히스토리 |
