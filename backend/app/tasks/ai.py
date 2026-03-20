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
import json
import os
import subprocess
import tempfile
from typing import Any, Literal

import httpx
from celery import shared_task
from celery.utils.log import get_task_logger

from app.core.config import settings

logger = get_task_logger(__name__)

OLLAMA_URL        = settings.OLLAMA_URL
OPENAI_API_KEY    = settings.OPENAI_API_KEY
ANTHROPIC_API_KEY = settings.ANTHROPIC_API_KEY
GOOGLE_API_KEY    = settings.GOOGLE_API_KEY

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
            "description": "업로드된 Knowledge Base에서 관련 문서를 검색합니다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer", "default": 3},
                },
                "required": ["query"],
            },
        },
    },
]


# ── 도구 실행 ─────────────────────────────────────────────────────────────────

def _run_tool(name: str, args: dict) -> str:
    """도구 이름과 인자를 받아 결과 문자열 반환"""
    if name == "web_search":
        return _web_search(args.get("query", ""), args.get("max_results", 5))
    elif name == "execute_python":
        result = _execute_python(args.get("code", ""))
        return json.dumps(result)
    elif name == "knowledge_search":
        # 임베딩 검색 — 현재는 키워드 매칭 stub, 추후 pgvector로 교체
        return json.dumps({"results": [], "note": "Vector search not yet configured"})
    else:
        return f"Unknown tool: {name}"


def _web_search(query: str, max_results: int = 5) -> str:
    """DuckDuckGo Instant Answer API (무료, 키 불필요)"""
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
    subprocess + 타임아웃으로 실행 시간 제한.
    """
    # 위험 패턴 차단 (보안: 파일 시스템/프로세스 접근 차단)
    BLOCKED = [
        "import os", "import sys", "import subprocess", "import socket",
        "import importlib", "import ctypes", "import multiprocessing",
        "open(", "file(", "__import__", "__builtins__", "__dict__", "__class__",
        "eval(", "exec(", "compile(", "getattr(", "setattr(", "hasattr(",
        "globals(", "locals(", "vars(", "dir(",
        "exit(", "quit(", "input(", "breakpoint(",
    ]
    for pattern in BLOCKED:
        if pattern in code:
            return {"error": f"Blocked pattern: '{pattern}'", "stdout": "", "stderr": ""}

    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(code)
        fname = f.name

    try:
        result = subprocess.run(
            ["python3", fname],
            capture_output=True, text=True, timeout=timeout,
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
        os.unlink(fname)


# ── LLM 호출 (provider별 통합) ────────────────────────────────────────────────

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
    if provider == "ollama":
        return _call_ollama(messages, model, tools, temperature)
    elif provider == "openai":
        return _call_openai(messages, model, tools, temperature)
    elif provider == "anthropic":
        return _call_anthropic(messages, model, tools, temperature)
    else:
        raise ValueError(f"Unknown provider: {provider}")


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
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
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
    # Anthropic uses 'system' separately
    system_msgs = [m for m in messages if m["role"] == "system"]
    user_msgs   = [m for m in messages if m["role"] != "system"]
    system_text = system_msgs[0]["content"] if system_msgs else ""

    body: dict[str, Any] = {
        "model": model,
        "max_tokens": 4096,
        "temperature": temperature,
        "messages": user_msgs,
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
            headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01"},
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


# ── 메인 태스크 ───────────────────────────────────────────────────────────────

@shared_task(bind=True, name="app.tasks.ai.run_agent", max_retries=1)
def run_agent(
    self,
    messages: list[dict],
    model: str,
    provider: Literal["openai", "anthropic", "ollama"] = "openai",
    enabled_tools: list[str] | None = None,
    max_steps: int = 10,
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
    tools = None
    if enabled_tools:
        tools = [t for t in TOOL_DEFINITIONS if t["function"]["name"] in enabled_tools]

    history = list(messages)
    tool_calls_log: list[dict] = []
    steps = 0

    for _ in range(max_steps):
        response = _call_llm(history, model, provider, tools=tools, temperature=temperature)

        # 도구 호출 없음 → 최종 응답
        if not response.get("tool_calls"):
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

            # tool result 메시지 추가
            history.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": result,
            })

    # max_steps 도달 → 현재까지 내용으로 최종 응답 요청
    logger.warning("run_agent reached max_steps=%d, forcing final response", max_steps)
    history.append({"role": "user", "content": "지금까지 수집된 정보를 바탕으로 최종 답변을 해줘."})
    final = _call_llm(history, model, provider, tools=None, temperature=temperature)
    return {
        "content": final.get("content", ""),
        "steps": steps,
        "tool_calls_log": tool_calls_log,
        "model": model,
        "provider": provider,
        "warning": "max_steps_reached",
    }


@shared_task(bind=True, name="app.tasks.ai.web_search", max_retries=2)
def web_search(self, query: str, max_results: int = 5) -> dict:
    """독립 웹 검색 태스크"""
    try:
        result = _web_search(query, max_results)
        return {"query": query, "results": json.loads(result)}
    except Exception as exc:
        raise self.retry(exc=exc, countdown=5)


@shared_task(bind=True, name="app.tasks.ai.execute_python", max_retries=1)
def execute_python_task(self, code: str, timeout: int = 10) -> dict:
    """독립 Python 실행 태스크"""
    try:
        return _execute_python(code, timeout)
    except Exception as exc:
        raise self.retry(exc=exc, countdown=3)


@shared_task(bind=True, name="app.tasks.ai.chat_completion", max_retries=1)
def chat_completion(
    self,
    messages: list[dict],
    model: str,
    provider: Literal["openai", "anthropic", "ollama"] = "openai",
    temperature: float = 0.7,
) -> dict:
    """스트리밍 불필요한 단순 LLM 호출 (요약, 분류, 변환 등)"""
    try:
        response = _call_llm(messages, model, provider, tools=None, temperature=temperature)
        return {"content": response.get("content", ""), "model": model, "provider": provider}
    except Exception as exc:
        logger.error("chat_completion failed: %s", exc)
        raise self.retry(exc=exc, countdown=5)
