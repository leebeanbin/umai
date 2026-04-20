# AI 에이전트 & LLM 통합

## 개요

Umai의 AI 레이어는 두 가지 실행 경로를 가집니다:

| 경로 | 위치 | 용도 |
|---|---|---|
| 스트리밍 채팅 | `frontend/src/app/api/chat/route.ts` | 실시간 채팅 스트리밍 (Next.js 서버 사이드) |
| 비동기 에이전트 | `backend/app/tasks/ai.py` (Celery) | Tool-use 에이전트, 장시간 태스크 |

---

## 멀티 프로바이더 LLM 디스패치

```python
# backend/app/tasks/ai.py

_LLM_CALLERS: dict[str, Any] = {}  # 함수 정의 전에 선언

def _call_openai(messages, model, tools, ...): ...
def _call_anthropic(messages, model, tools, ...): ...
def _call_google(messages, model, tools, ...): ...
def _call_xai(messages, model, tools, ...): ...
def _call_ollama(messages, model, tools, ...): ...

# 모든 _call_* 함수 정의 후에 등록
_LLM_CALLERS.update({
    "openai":    _call_openai,
    "anthropic": _call_anthropic,
    "google":    _call_google,
    "xai":       _call_xai,
    "ollama":    _call_ollama,
})

def _call_llm(provider, messages, model, tools=None):
    caller = _LLM_CALLERS.get(provider)
    if caller is None:
        raise ValueError(f"Unknown LLM provider: {provider!r}")
    return caller(messages, model, tools)
```

**왜 `_LLM_CALLERS = {}` 먼저 선언?**

Python은 파일을 위에서 아래로 파싱합니다. `_call_llm`이 파일 중간에 정의되고,
`_call_openai` 등이 그 아래에 있으면 `_call_llm` 시점에는 참조가 불가능합니다.
빈 dict를 먼저 선언하고 나중에 `.update()`로 채우는 패턴으로 해결합니다.

---

## Tool-Use 에이전트 루프

```python
# backend/app/tasks/ai.py — run_agent 태스크

def run_agent(prompt, provider, model, tools_enabled=True, max_steps=10):
    messages = [{"role": "user", "content": prompt}]

    for step in range(max_steps):
        # 1. LLM 호출 (tools 포함)
        response = _call_llm(provider, messages, model,
                             tools=TOOL_DEFINITIONS if tools_enabled else None)

        # 2. tool_calls 없으면 → 최종 응답
        if not response.get("tool_calls"):
            return response["content"]

        # 3. 도구 실행
        for tool_call in response["tool_calls"]:
            tool_result = _run_tool(tool_call["name"], tool_call["arguments"])
            # 4. 결과를 메시지 히스토리에 추가
            messages.append({"role": "tool", "content": tool_result, ...})

        # 5. 다시 LLM 호출 (루프)

    return "최대 반복 수 초과"
```

ReAct 패턴(Reason + Act)의 구현입니다:
1. LLM이 추론하고 어떤 도구가 필요한지 결정
2. 도구 실행 결과를 컨텍스트에 추가
3. LLM이 결과를 보고 다음 행동 결정

`max_steps=5`으로 무한 루프를 방지합니다 (기본값 — timeout 안전 마진).

---

## 컨텍스트 윈도우 트리밍

```python
# backend/app/core/model_registry.py

CONTEXT_WINDOW: dict[str, int] = {
    "gpt-4o":            128_000,
    "claude-sonnet-4-6": 200_000,
    "gemini-2.0-flash":  1_048_576,
    # ...
}
MAX_TOKENS_RESERVE = 8_000  # 응답 + tool call 여유분

# backend/app/tasks/ai.py

def _trim_history(messages, model):
    limit = CONTEXT_WINDOW.get(model, 32_000) - MAX_TOKENS_RESERVE
    if _count_tokens(messages) <= limit:
        return messages
    # 시스템 프롬프트 보존 + 오래된 메시지부터 제거
    system = [m for m in messages if m["role"] == "system"]
    others = [m for m in messages if m["role"] != "system"]
    while others and _count_tokens(system + others) > limit:
        others.pop(0)
    return system + others

# 에이전트 루프에서 매 호출 전 적용
response = _call_llm(_trim_history(history, model), model, provider, ...)
```

**왜 필요한가:**
GPT-4o 기준 컨텍스트 128K 토큰 초과 시 OpenAI API 422 오류 → 태스크 실패.
Tool call 결과가 누적되면 수십 번 반복 후 한도를 초과할 수 있습니다.

트리밍 전략: 시스템 프롬프트(지시사항)를 항상 유지하고,
히스토리가 길어지면 **가장 오래된 메시지부터 제거**합니다.
최신 tool result가 더 중요하기 때문입니다.

---

## 도구 레지스트리

```python
# backend/app/tasks/ai.py

_TOOL_REGISTRY: dict[str, Any] = {
    "web_search":       _run_web_search,
    "execute_python":   _run_execute_python,
    "knowledge_search": _run_knowledge_search,
}

def _run_tool(name: str, args: dict) -> str:
    fn = _TOOL_REGISTRY.get(name)
    if fn is None:
        return f"Unknown tool: {name}"
    return fn(args)
```

### 웹 검색 (DuckDuckGo)

API 키 없이 무료로 사용 가능한 DuckDuckGo를 사용합니다:

```python
from duckduckgo_search import DDGS

def _web_search(query: str, max_results: int = 5) -> str:
    with DDGS() as ddgs:
        results = list(ddgs.text(query, max_results=max_results))
    return json.dumps(results, ensure_ascii=False)
```

### Python 코드 실행 (Sandboxed)

```python
def _execute_python(code: str) -> dict:
    # 1단계: AST 화이트리스트 검사
    _BLOCKED_BUILTINS = {
        "eval", "exec", "compile", "__import__", "open", "input",
        "breakpoint", "memoryview", "vars", "dir", "globals", "locals",
        # descriptor/attribute 프로토콜 우회 차단 (sandbox escape vector)
        "getattr", "setattr", "delattr", "type",
    }
    _BLOCKED_ATTRS = {
        "system", "popen", "spawn", "exec_command", "call", "run",
        "Popen", "check_output", "getoutput",
        # __builtins__ 접근으로 차단된 함수를 복구하는 경로 차단
        "__builtins__",
    }

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if top not in _ALLOWED_IMPORTS:
                return {"error": f"Import not allowed"}
        elif isinstance(node, ast.Call):
            if node.func.id in _BLOCKED_BUILTINS:
                return {"error": f"Built-in not allowed"}
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") or node.attr in _BLOCKED_ATTRS:
                return {"error": f"Attribute not allowed"}

    # 2단계: 임시 파일에 저장 후 subprocess 실행
    result = subprocess.run(
        [sys.executable, fname],
        capture_output=True, text=True,
        timeout=10,
        preexec_fn=_set_resource_limits,  # CPU/메모리/fork 제한 (Unix)
    )
```

보안 계층 (4단계 다층 방어):
1. **AST 정적 분석** — import 화이트리스트, 위험 함수·속성 차단
   - `getattr`/`setattr`/`delattr`/`type` 차단 — descriptor 프로토콜 우회 방지
   - `__builtins__` 속성 접근 차단 — 차단된 함수를 복구하는 경로 제거
   - dunder(`__x__`) 속성 전체 차단
2. **subprocess 프로세스 격리** — 별도 프로세스에서 실행
3. **OS 리소스 제한** — CPU 시간, 메모리 256MB, fork 금지, 파일 생성 금지 (Unix)
4. **타임아웃** — 10초 초과 시 강제 종료

### Knowledge Search (RAG)

```python
def _knowledge_search(query, top_k=5, user_id=None):
    # 쿼리 임베딩 생성
    query_vector = embed_query_sync(query)

    # DB에서 코사인 유사도 검색 (동기 세션)
    with sync_session() as db:
        rows = db.execute(
            select(KnowledgeItem)
            .where(KnowledgeItem.user_id == user_id)
            .order_by(KnowledgeItem.embedding.cosine_distance(query_vector))
            .limit(top_k)
        ).scalars().all()
```

Celery 태스크는 동기 컨텍스트이므로 `sync_session()`을 사용합니다.
FastAPI 엔드포인트의 `AsyncSession`과 구분됩니다.

---

## 스트리밍 채팅 (Next.js Route)

```
브라우저 ──SSE 스트림──▶ Next.js /api/chat ──HTTP──▶ OpenAI/Anthropic/Ollama
                         (서버 사이드)
```

```typescript
// frontend/src/app/api/chat/route.ts
export async function POST(req: Request) {
    const { messages, model, provider } = await req.json();

    // Provider별 스트리밍 API 호출
    const upstream = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model, messages, stream: true }),
    });

    // ReadableStream으로 클라이언트에 전달
    return new Response(upstream.body, {
        headers: { "Content-Type": "text/event-stream" },
    });
}
```

Next.js가 프록시 역할을 합니다. 이유:
1. LLM API 키를 브라우저에 노출하지 않음
2. CORS 문제 없음 (같은 도메인)
3. SSE 스트림을 그대로 전달 (청크 단위 텍스트가 실시간으로 표시)

---

## RAG 컨텍스트 주입 (useChat.ts)

```typescript
// frontend/src/lib/hooks/useChat.ts

// [1] Tool-use agent: 검색/계산 필요 시 Celery 태스크
if (opts?.useAgent) {
    const task = await apiEnqueueAgentTask({ prompt: content });
    // 태스크 완료 시 WS /ws/tasks 채널로 알림
}

// [2] RAG: Knowledge Base 검색
if (opts?.useRag) {
    const body = await apiFetch(`/api/v1/rag/search?q=${query}&top_k=5`);
    // 검색 결과를 system 메시지로 주입
    apiMsgs.push({ role: "system", content: `[Knowledge Base]\n${context}` });
}

// [3] OCR: 비전 미지원 모델에서 이미지 텍스트 추출
if (images.length > 0 && !caps.vision) {
    const { text } = await apiFetch("/api/ocr", {
        method: "POST", body: JSON.stringify({ image: img })
    });
    apiMsgs.push({ role: "system", content: `[Image OCR Text]\n${text}` });
}

// [4] Web search: Tavily 실시간 검색
if (opts?.webSearch) {
    const wsBody = await apiFetch(`/api/websearch?q=${query}`);
    // 결과를 system 메시지로 주입
}

// [5] 실제 LLM 호출
const res = await fetch("/api/chat", { body: JSON.stringify({ messages: apiMsgs }) });
```

각 단계는 non-fatal입니다. RAG 실패해도 채팅은 계속됩니다.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `backend/app/tasks/ai.py` | Celery 에이전트, 도구 레지스트리, LLM 디스패치 |
| `frontend/src/app/api/chat/route.ts` | LLM 스트리밍 프록시 |
| `frontend/src/lib/hooks/useChat.ts` | 채팅 훅, RAG/OCR/검색 컨텍스트 주입 |
| `frontend/src/app/api/websearch/route.ts` | Tavily 웹 검색 API |
| `frontend/src/app/api/ocr/route.ts` | Ollama OCR |
