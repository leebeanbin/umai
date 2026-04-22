"""
AI 에이전트 태스크 (ai queue)

- run_agent         : tool-use 에이전트 루프 (multi-step reasoning)
- web_search        : 웹 검색 (DuckDuckGo, 무료 / 키 불필요)
- execute_python    : Python 코드 실행 (제한된 sandbox)
- summarize         : 긴 텍스트 요약
- chat_completion   : 단순 LLM 호출 (스트리밍 불필요한 경우)

에이전트 루프 동작:
  1. LLM 호출 (tools 포함)
  2. tool_calls 있으면 → 도구 실행
  3. 결과를 messages에 추가 → 다시 LLM 호출
  4. tool_calls 없거나 max_steps 도달 시 최종 응답 반환
"""
import ast
import json
import os
import subprocess
import sys
import tempfile
from typing import Any, Literal

import httpx
from celery import shared_task
from celery.utils.log import get_task_logger

from app.core.config import settings
from app.core.http_headers import openai_auth_headers, anthropic_auth_headers
from app.core.model_registry import CONTEXT_WINDOW, MAX_TOKENS_RESERVE
from app.tasks._utils import UmaiBaseTask, publish_task_done
from app.services.embedding_service import embed_query_sync

logger = get_task_logger(__name__)

OLLAMA_URL        = settings.OLLAMA_URL

OPENAI_API_KEY    = settings.OPENAI_API_KEY
ANTHROPIC_API_KEY = settings.ANTHROPIC_API_KEY
GOOGLE_API_KEY    = settings.GOOGLE_API_KEY
XAI_API_KEY       = settings.XAI_API_KEY

# ── 도구 정의 (OpenAI function-calling 형식) ──────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "인터넷에서 최신 정보를 검색합니다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "검색어"},
                    "max_results": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_python",
            "description": "Python 코드를 실행하고 결과를 반환합니다. 데이터 분석, 계산에 활용하세요.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "실행할 Python 코드"},
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "knowledge_search",
            "description": "업로드된 Knowledge Base에서 관련 문서를 의미론적으로 검색합니다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query":   {"type": "string", "description": "검색할 내용"},
                    "top_k":   {"type": "integer", "default": 5},
                    "user_id": {"type": "string",  "description": "검색 대상 유저 ID"},
                },
                "required": ["query"],
            },
        },
    },
]


# ── 도구 실행 ─────────────────────────────────────────────────────────────────

def _run_web_search(args: dict) -> str:
    return _web_search(args.get("query", ""), args.get("max_results", 5))

def _run_execute_python(args: dict) -> str:
    return json.dumps(_execute_python(args.get("code", "")))

def _run_knowledge_search(args: dict) -> str:
    return _knowledge_search(args.get("query", ""), args.get("top_k", 5), args.get("user_id"))

_TOOL_REGISTRY: dict[str, Any] = {
    "web_search":       _run_web_search,
    "execute_python":   _run_execute_python,
    "knowledge_search": _run_knowledge_search,
}


def _run_tool(name: str, args: dict) -> str:
    """도구 이름과 인자를 받아 결과 문자열 반환"""
    fn = _TOOL_REGISTRY.get(name)
    if fn is None:
        return f"Unknown tool: {name}"
    return fn(args)


def _knowledge_search(query: str, top_k: int = 5, user_id: str | None = None) -> str:
    """
    동기식 RAG 검색 — Celery 에이전트에서 사용.
    /rag/search 엔드포인트와 동일한 로직을 인라인으로 실행.
    """
    if not user_id:
        return json.dumps({"results": [], "note": "user_id required for knowledge search"})
    try:
        import math
        from app.core.database import sync_session
        from app.models.workspace import KnowledgeItem

        # 임베딩 벡터 가져오기
        with sync_session() as db:
            from sqlalchemy import select as sa_select
            import uuid
            uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
            rows = db.execute(
                sa_select(KnowledgeItem).where(KnowledgeItem.user_id == uid)
            ).scalars().all()

        if not rows:
            return json.dumps({"results": [], "note": "No knowledge items found"})

        # 쿼리 임베딩 (sync)
        query_vector = embed_query_sync(query)

        scored: list[dict] = []
        keywords = query.lower().split()

        for item in rows:
            chunks: list[str] = []
            vectors: list[list[float]] = []
            try:
                raw_emb = item.embeddings_json
                # JSONB column is already deserialized to dict by SQLAlchemy;
                # legacy rows may still be a JSON string — handle both.
                if isinstance(raw_emb, str):
                    emb_data = json.loads(raw_emb)
                else:
                    emb_data = raw_emb or {}
                chunks  = emb_data.get("chunks", [])
                vectors = emb_data.get("vectors", [])
            except Exception as exc:
                logger.warning("knowledge_search: failed to parse embeddings for item %s: %s", item.name, exc)

            if not chunks and item.content:
                chunks = [item.content[i:i+500] for i in range(0, len(item.content), 400)]

            for i, chunk in enumerate(chunks):
                if query_vector and i < len(vectors) and vectors[i] and len(vectors[i]) == len(query_vector):
                    dot = sum(x * y for x, y in zip(query_vector, vectors[i]))
                    na  = math.sqrt(sum(x*x for x in query_vector))
                    nb  = math.sqrt(sum(x*x for x in vectors[i]))
                    score = dot / (na * nb) if na and nb else 0.0
                else:
                    score = float(sum(1 for kw in keywords if kw in chunk.lower()))
                scored.append({"chunk": chunk, "source": item.name, "score": round(score, 4)})

        scored.sort(key=lambda x: x["score"], reverse=True)
        return json.dumps({"results": scored[:top_k], "query": query})

    except Exception as e:
        return json.dumps({"results": [], "error": str(e)})


def _web_search(query: str, max_results: int = 5) -> str:
    """웹 검색. Tavily API 키가 있으면 Tavily, 없으면 DuckDuckGo fallback."""
    tavily_key = settings.TAVILY_API_KEY
    if tavily_key:
        return _web_search_tavily(query, max_results, tavily_key)
    return _web_search_duckduckgo(query, max_results)


def _web_search_tavily(query: str, max_results: int, api_key: str) -> str:
    """Tavily Search API — 실제 웹 검색 결과 반환."""
    try:
        with httpx.Client(timeout=15) as client:
            r = client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": api_key,
                    "query": query,
                    "max_results": max_results,
                    "search_depth": "basic",
                    "include_answer": True,
                },
            )
            r.raise_for_status()
            data = r.json()

        results = []
        if data.get("answer"):
            results.append({"title": "Summary", "snippet": data["answer"], "url": ""})
        for item in data.get("results", [])[:max_results]:
            results.append({
                "title": item.get("title", ""),
                "snippet": item.get("content", ""),
                "url": item.get("url", ""),
                "score": item.get("score"),
            })
        return json.dumps(results, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)})


def _web_search_duckduckgo(query: str, max_results: int) -> str:
    """DuckDuckGo Instant Answer API (Tavily 키 없을 때 fallback)."""
    try:
        with httpx.Client(timeout=15) as client:
            r = client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
                headers={"User-Agent": "Umai/1.0"},
            )
            r.raise_for_status()
            data = r.json()

        results = []
        if data.get("AbstractText"):
            results.append({"title": data.get("Heading", ""), "snippet": data["AbstractText"], "url": data.get("AbstractURL", "")})
        for topic in data.get("RelatedTopics", [])[:max_results - len(results)]:
            if "Text" in topic:
                results.append({"title": "", "snippet": topic["Text"], "url": topic.get("FirstURL", "")})

        return json.dumps(results, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)})


def _execute_python(code: str, timeout: int = 10) -> dict:
    """
    제한된 Python 실행 환경.

    ⚠️  보안 경고:
    이 구현은 신뢰된 내부 사용자(관리자) 전용입니다.
    외부 사용자에게 노출하는 경우 반드시 Docker / gVisor / nsjail 등
    OS 레벨 격리 컨테이너로 교체해야 합니다.
    현재 구현은 다층 방어(AST 분석 + 리소스 제한)를 적용하지만
    완전한 격리를 보장하지 않습니다.

    방어 레이어:
    1. AST 파싱: import 허용 모듈 화이트리스트, 위험 함수 호출 차단
    2. 리소스 제한: CPU 시간, 메모리(256MB), 프로세스 수 제한 (Unix)
    3. 타임아웃: subprocess timeout으로 실행 시간 강제 종료
    4. 출력 크기 제한: stdout 4096B, stderr 1024B
    """
    # ── 레이어 1: AST 기반 정적 분석 ─────────────────────────────────────────
    # 문자열 포함 여부가 아닌 실제 AST 노드 분석 → 문자열 우회 불가
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as e:
        return {"error": f"Syntax error: {e}", "stdout": "", "stderr": ""}

    _ALLOWED_IMPORTS = {
        "math", "json", "re", "datetime", "collections",
        "itertools", "functools", "string", "decimal", "fractions",
        "statistics", "random", "textwrap", "unicodedata",
    }
    _BLOCKED_BUILTINS = {
        "eval", "exec", "compile", "__import__", "open", "input",
        "breakpoint", "memoryview", "vars", "dir", "globals", "locals",
        # Prevent descriptor/attribute protocol abuse for sandbox escape
        "getattr", "setattr", "delattr", "type",
    }
    _BLOCKED_ATTRS = {
        "system", "popen", "spawn", "exec_command", "call", "run",
        "Popen", "check_output", "getoutput",
        # Prevent __builtins__ access to recover blocked builtins
        "__builtins__",
    }

    for node in ast.walk(tree):
        # import 화이트리스트
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name.split(".")[0]
                if top not in _ALLOWED_IMPORTS:
                    return {"error": f"Import not allowed: '{alias.name}'", "stdout": "", "stderr": ""}
        elif isinstance(node, ast.ImportFrom):
            top = (node.module or "").split(".")[0]
            if top not in _ALLOWED_IMPORTS:
                return {"error": f"Import not allowed: '{node.module}'", "stdout": "", "stderr": ""}
        # 위험 내장 이름 참조 차단 (호출뿐 아니라 별칭 할당도 방지: f = getattr; f(...))
        elif isinstance(node, ast.Name) and node.id in _BLOCKED_BUILTINS:
            return {"error": f"Built-in not allowed: '{node.id}'", "stdout": "", "stderr": ""}
        # 위험 메서드 호출 차단
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Attribute) and node.func.attr in _BLOCKED_ATTRS:
                return {"error": f"Attribute not allowed: '{node.func.attr}'", "stdout": "", "stderr": ""}
        # dunder attribute 접근 차단 (__class__, __subclasses__ 등)
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") and node.attr.endswith("__"):
                return {"error": f"Dunder attribute access not allowed: '{node.attr}'", "stdout": "", "stderr": ""}

    # ── 레이어 2: 임시 파일 작성 ─────────────────────────────────────────────
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write(code)
            fname = f.name
    except OSError as e:
        return {"error": f"Failed to create temp file: {e}", "stdout": "", "stderr": ""}

    # ── 레이어 3: 리소스 제한 (Unix 전용) ────────────────────────────────────
    def _set_resource_limits() -> None:
        """자식 프로세스에 OS 레벨 리소스 제한 적용."""
        try:
            import resource as _resource
            # CPU 시간 제한 (soft=timeout, hard=timeout+2)
            _resource.setrlimit(_resource.RLIMIT_CPU, (timeout, timeout + 2))
            # 가상 메모리 256MB
            _mem = 256 * 1024 * 1024
            _resource.setrlimit(_resource.RLIMIT_AS, (_mem, _mem))
            # 새 프로세스 생성 금지 (fork bomb 방지)
            _resource.setrlimit(_resource.RLIMIT_NPROC, (0, 0))
            # 파일 생성 금지
            _resource.setrlimit(_resource.RLIMIT_FSIZE, (0, 0))
        except Exception:
            pass  # Windows 또는 권한 없는 환경에서는 무시

    # preexec_fn은 Unix 전용 (Windows에서는 None 전달)
    _preexec = _set_resource_limits if sys.platform != "win32" else None

    try:
        result = subprocess.run(
            ["python3", fname],
            capture_output=True,
            text=True,
            timeout=timeout,
            preexec_fn=_preexec,
        )
        return {
            "stdout": result.stdout[:4096],
            "stderr": result.stderr[:1024],
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"error": f"Timeout after {timeout}s", "stdout": "", "stderr": ""}
    except Exception as e:
        return {"error": str(e), "stdout": "", "stderr": ""}
    finally:
        try:
            os.unlink(fname)
        except OSError:
            pass


# ── LLM 호출 (provider별 통합) ────────────────────────────────────────────────

# provider → caller 매핑 (함수 정의 후 모듈 수준에서 초기화)
_LLM_CALLERS: dict[str, Any] = {}  # populated after caller functions are defined


def _call_llm(
    messages: list[dict],
    model: str,
    provider: str,
    tools: list | None = None,
    temperature: float = 0.7,
) -> dict:
    """
    단일 LLM 호출. tool_calls 포함 응답 반환.
    Returns: {"content": str | None, "tool_calls": list | None, "finish_reason": str}
    """
    caller = _LLM_CALLERS.get(provider)
    if caller is None:
        raise ValueError(f"Unknown provider: {provider}")
    return caller(messages, model, tools, temperature)


def _call_openai(messages: list, model: str, tools: list | None, temperature: float) -> dict:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY not configured")
    body: dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    with httpx.Client(timeout=120) as client:
        r = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers=openai_auth_headers(OPENAI_API_KEY),
            json=body,
        )
        r.raise_for_status()
    choice = r.json()["choices"][0]
    msg = choice["message"]
    return {
        "content": msg.get("content"),
        "tool_calls": msg.get("tool_calls"),
        "finish_reason": choice.get("finish_reason"),
    }


def _call_anthropic(messages: list, model: str, tools: list | None, temperature: float) -> dict:
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY not configured")
    # Anthropic uses 'system' separately; tool role messages need conversion
    system_text = ""
    anthropic_msgs: list[dict] = []
    for m in messages:
        role = m["role"]
        if role == "system":
            system_text = m.get("content", "")
            continue
        if role == "tool":
            # OpenAI "tool" role → Anthropic "tool_result" inside user message
            anthropic_msgs.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": m.get("tool_call_id", ""),
                    "content": m.get("content", ""),
                }],
            })
            continue
        if role == "assistant" and m.get("tool_calls"):
            # OpenAI assistant with tool_calls → Anthropic content blocks
            content_blocks: list[dict] = []
            if m.get("content"):
                content_blocks.append({"type": "text", "text": m["content"]})
            for tc in m["tool_calls"]:
                try:
                    args = json.loads(tc["function"]["arguments"]) if isinstance(tc["function"]["arguments"], str) else tc["function"]["arguments"]
                except (TypeError, ValueError):
                    args = {}
                content_blocks.append({
                    "type": "tool_use",
                    "id": tc["id"],
                    "name": tc["function"]["name"],
                    "input": args,
                })
            anthropic_msgs.append({"role": "assistant", "content": content_blocks})
            continue
        anthropic_msgs.append(m)

    body: dict[str, Any] = {
        "model": model,
        "max_tokens": 4096,
        "temperature": temperature,
        "messages": anthropic_msgs,
    }
    if system_text:
        body["system"] = system_text
    if tools:
        # Anthropic tool format differs slightly
        body["tools"] = [
            {
                "name": t["function"]["name"],
                "description": t["function"].get("description", ""),
                "input_schema": t["function"]["parameters"],
            }
            for t in tools
        ]

    with httpx.Client(timeout=120) as client:
        r = client.post(
            "https://api.anthropic.com/v1/messages",
            headers=anthropic_auth_headers(ANTHROPIC_API_KEY),
            json=body,
        )
        r.raise_for_status()

    data = r.json()
    text_content = next((b["text"] for b in data["content"] if b["type"] == "text"), None)
    tool_uses    = [b for b in data["content"] if b["type"] == "tool_use"]

    # OpenAI 형식으로 정규화
    tool_calls = None
    if tool_uses:
        tool_calls = []
        for t in tool_uses:
            try:
                args_str = json.dumps(t["input"]) if isinstance(t["input"], dict) else str(t["input"])
            except (TypeError, ValueError):
                args_str = "{}"
            tool_calls.append({
                "id": t.get("id", f"call_{len(tool_calls)}"),
                "type": "function",
                "function": {"name": t["name"], "arguments": args_str},
            })
    return {
        "content": text_content,
        "tool_calls": tool_calls,
        "finish_reason": data.get("stop_reason"),
    }


def _call_ollama(messages: list, model: str, tools: list | None, temperature: float) -> dict:
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature},
    }
    if tools:
        body["tools"] = tools
    with httpx.Client(timeout=120) as client:
        r = client.post(f"{OLLAMA_URL}/api/chat", json=body)
        r.raise_for_status()
    data = r.json()
    msg = data.get("message", {})

    # Normalize Ollama tool_calls → OpenAI format
    # Ollama: arguments is dict, no id field
    # OpenAI: arguments is JSON string, has id field
    ollama_tcs = msg.get("tool_calls")
    tool_calls = None
    if ollama_tcs:
        tool_calls = []
        for i, tc in enumerate(ollama_tcs):
            fn = tc.get("function", {})
            args = fn.get("arguments", {})
            tool_calls.append({
                "id": tc.get("id", f"call_{i}"),
                "type": "function",
                "function": {
                    "name": fn.get("name", ""),
                    "arguments": json.dumps(args) if isinstance(args, dict) else args,
                },
            })

    return {
        "content": msg.get("content"),
        "tool_calls": tool_calls,
        "finish_reason": data.get("done_reason", "stop"),
    }


def _call_google(messages: list, model: str, tools: list | None, temperature: float) -> dict:
    """Google Generative Language API (Gemini 2.x / 3.x)."""
    if not GOOGLE_API_KEY:
        raise ValueError("GOOGLE_API_KEY not configured")

    # Convert OpenAI-style messages → Gemini format
    contents = []
    system_text = ""
    for m in messages:
        role_orig = m["role"]
        if role_orig == "system":
            system_text = m.get("content", "")
            continue
        if role_orig == "tool":
            # OpenAI tool result → Gemini functionResponse
            contents.append({
                "role": "user",
                "parts": [{"functionResponse": {
                    "name": m.get("name", ""),
                    "response": {"content": m.get("content", "")},
                }}],
            })
            continue
        if role_orig == "assistant" and m.get("tool_calls"):
            # OpenAI assistant tool_calls → Gemini functionCall parts
            parts = []
            if m.get("content"):
                parts.append({"text": m["content"]})
            for tc in m["tool_calls"]:
                try:
                    args = json.loads(tc["function"]["arguments"]) if isinstance(tc["function"]["arguments"], str) else tc["function"]["arguments"]
                except (TypeError, ValueError):
                    args = {}
                parts.append({"functionCall": {"name": tc["function"]["name"], "args": args}})
            contents.append({"role": "model", "parts": parts})
            continue
        gemini_role = "user" if role_orig == "user" else "model"
        contents.append({"role": gemini_role, "parts": [{"text": m.get("content", "")}]})

    body: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {"temperature": temperature, "maxOutputTokens": 8192},
    }
    if system_text:
        body["systemInstruction"] = {"parts": [{"text": system_text}]}
    if tools:
        body["tools"] = [{"functionDeclarations": [
            {
                "name": t["function"]["name"],
                "description": t["function"].get("description", ""),
                "parameters": t["function"].get("parameters", {}),
            }
            for t in tools
        ]}]

    api_model = model or "gemini-2.0-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{api_model}:generateContent?key={GOOGLE_API_KEY}"

    with httpx.Client(timeout=120) as client:
        r = client.post(url, json=body)
        r.raise_for_status()

    data = r.json()
    candidate = data["candidates"][0]
    parts = candidate["content"].get("parts", [])

    # Extract text and function calls
    text = next((p.get("text", "") for p in parts if "text" in p), None)
    fn_calls = [p["functionCall"] for p in parts if "functionCall" in p]

    tool_calls = None
    if fn_calls:
        tool_calls = []
        for i, fc in enumerate(fn_calls):
            try:
                args_str = json.dumps(fc.get("args", {}))
            except (TypeError, ValueError):
                args_str = "{}"
            tool_calls.append({
                "id": f"call_google_{i}_{fc['name']}",
                "type": "function",
                "function": {"name": fc["name"], "arguments": args_str},
            })

    return {
        "content": text,
        "tool_calls": tool_calls,
        "finish_reason": candidate.get("finishReason", "STOP"),
    }


def _call_xai(messages: list, model: str, tools: list | None, temperature: float) -> dict:
    """xAI Grok API — OpenAI-compatible endpoint."""
    if not XAI_API_KEY:
        raise ValueError("XAI_API_KEY not configured")
    body: dict[str, Any] = {
        "model": model or "grok-4.1",
        "messages": messages,
        "temperature": temperature,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    with httpx.Client(timeout=120) as client:
        r = client.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {XAI_API_KEY}"},
            json=body,
        )
        r.raise_for_status()
    choice = r.json()["choices"][0]
    msg = choice["message"]
    return {
        "content": msg.get("content"),
        "tool_calls": msg.get("tool_calls"),
        "finish_reason": choice.get("finish_reason"),
    }


# provider → caller 매핑 초기화 (모든 _call_* 함수 정의 후)
_LLM_CALLERS.update({
    "openai":    _call_openai,
    "anthropic": _call_anthropic,
    "google":    _call_google,
    "xai":       _call_xai,
    "ollama":    _call_ollama,
})


# ── 히스토리 트리밍 (컨텍스트 윈도우 초과 방지) ─────────────────────────────

def _count_tokens(messages: list[dict]) -> int:
    """Rough token estimate — 4 chars ≈ 1 token (no tiktoken dependency)."""
    return sum(len(str(m.get("content") or "")) for m in messages) // 4


def _trim_history(messages: list[dict], model: str) -> list[dict]:
    """Return a trimmed copy of messages that fits within the model context window.

    Preserves the system prompt and drops the oldest non-system messages first.
    Uses a character-count approximation so tiktoken is not required.
    """
    limit = CONTEXT_WINDOW.get(model, 32_000) - MAX_TOKENS_RESERVE
    if _count_tokens(messages) <= limit:
        return messages

    system_msgs = [m for m in messages if m.get("role") == "system"]
    other_msgs  = [m for m in messages if m.get("role") != "system"]

    while other_msgs and _count_tokens(system_msgs + other_msgs) > limit:
        other_msgs.pop(0)

    trimmed = system_msgs + other_msgs
    logger.warning(
        "History trimmed %d→%d messages to fit model=%s (limit≈%d tokens)",
        len(messages), len(trimmed), model, limit,
    )
    return trimmed


# ── 메인 태스크 ───────────────────────────────────────────────────────────────

@shared_task(
    bind=True,
    base=UmaiBaseTask,
    name="app.tasks.ai.run_agent",
    max_retries=1,
    soft_time_limit=300,   # 5분 후 SoftTimeLimitExceeded
    time_limit=360,        # 6분 후 강제 종료
)
def run_agent(
    self,
    messages: list[dict],
    model: str,
    provider: Literal["openai", "anthropic", "google", "xai", "ollama"] = "openai",
    enabled_tools: list[str] | None = None,
    max_steps: int = 5,    # 기본값 10 → 5 (timeout 안전 마진)
    temperature: float = 0.7,
    chat_id: str | None = None,
) -> dict:
    """
    Multi-step tool-use 에이전트 루프.

    enabled_tools: ["web_search", "execute_python", "knowledge_search"]
                   None이면 전체 비활성화 (일반 chat_completion 동작)

    Returns:
        {
          "content": str,          # 최종 응답
          "steps": int,            # 실행된 도구 호출 횟수
          "tool_calls_log": list,  # [{tool, args, result}, ...]
          "model": str,
          "provider": str,
        }
    """
    from celery.exceptions import SoftTimeLimitExceeded

    tools = None
    if enabled_tools:
        tools = [t for t in TOOL_DEFINITIONS if t["function"]["name"] in enabled_tools]

    history = list(messages)
    tool_calls_log: list[dict] = []
    steps = 0

    try:
        for _ in range(max_steps):
            response = _call_llm(_trim_history(history, model), model, provider, tools=tools, temperature=temperature)

            # 도구 호출 없음 → 최종 응답
            if not response.get("tool_calls"):
                publish_task_done(self.request.id, "run_agent")
                return {
                    "content": response.get("content", ""),
                    "steps": steps,
                    "tool_calls_log": tool_calls_log,
                    "model": model,
                    "provider": provider,
                }

            # 어시스턴트 메시지 추가
            history.append({
                "role": "assistant",
                "content": response.get("content"),
                "tool_calls": response["tool_calls"],
            })

            # 도구 실행
            for tc in response["tool_calls"]:
                fn_name = tc["function"]["name"]
                fn_args = json.loads(tc["function"]["arguments"])

                logger.info("Tool call: %s(%s)", fn_name, fn_args)
                result = _run_tool(fn_name, fn_args)
                steps += 1

                tool_calls_log.append({"tool": fn_name, "args": fn_args, "result": result})

                # tool result 메시지 추가 (name 포함 — Google functionResponse에 필요)
                history.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "name": fn_name,
                    "content": result,
                })

        # max_steps 도달 → 현재까지 내용으로 최종 응답 요청
        logger.warning("run_agent reached max_steps=%d, forcing final response", max_steps)
        history.append({"role": "user", "content": "지금까지 수집된 정보를 바탕으로 최종 답변을 해줘."})
        final = _call_llm(_trim_history(history, model), model, provider, tools=None, temperature=temperature)
        publish_task_done(self.request.id, "run_agent")
        return {
            "content": final.get("content", ""),
            "steps": steps,
            "tool_calls_log": tool_calls_log,
            "model": model,
            "provider": provider,
            "warning": "max_steps_reached",
        }
    except SoftTimeLimitExceeded:
        logger.warning("run_agent soft_time_limit exceeded after %d steps", steps)
        publish_task_done(self.request.id, "run_agent")
        return {
            "content": "요청 처리 시간이 초과되었습니다. 지금까지 수집된 정보만 반환합니다.",
            "steps": steps,
            "tool_calls_log": tool_calls_log,
            "model": model,
            "provider": provider,
            "warning": "soft_time_limit",
        }
    except Exception as exc:
        logger.error("run_agent failed after %d steps: %s", steps, exc, exc_info=True)
        publish_task_done(self.request.id, "run_agent")
        raise  # re-raise so Celery records the failure and retries if configured


@shared_task(bind=True, base=UmaiBaseTask, name="app.tasks.ai.web_search", max_retries=2)
def web_search(self, query: str, max_results: int = 5) -> dict:
    """독립 웹 검색 태스크"""
    try:
        result = _web_search(query, max_results)
        publish_task_done(self.request.id, "web_search")
        return {"query": query, "results": json.loads(result)}
    except Exception as exc:
        raise self.retry(exc=exc, countdown=5)


@shared_task(bind=True, base=UmaiBaseTask, name="app.tasks.ai.chat_completion", max_retries=1)
def chat_completion(
    self,
    messages: list[dict],
    model: str,
    provider: Literal["openai", "anthropic", "google", "xai", "ollama"] = "openai",
    temperature: float = 0.7,
) -> dict:
    """스트리밍 불필요한 단순 LLM 호출 (요약, 분류, 변환 등)"""
    try:
        response = _call_llm(messages, model, provider, tools=None, temperature=temperature)
        return {"content": response.get("content", ""), "model": model, "provider": provider}
    except Exception as exc:
        logger.error("chat_completion failed: %s", exc)
        raise self.retry(exc=exc, countdown=5)
