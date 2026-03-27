"""
HTTP 헤더 빌더 — 외부 API 요청 헤더 구성 함수 모음.

사용 목적:
  - Authorization 헤더를 여러 파일에서 직접 구성하는 중복 제거
  - API 버전 문자열 오타 방지
  - 헤더 구조 변경 시 이 파일만 수정
"""
from app.core.model_registry import ANTHROPIC_API_VERSION


def openai_auth_headers(api_key: str) -> dict[str, str]:
    """OpenAI API 인증 헤더."""
    return {"Authorization": f"Bearer {api_key}"}


def anthropic_auth_headers(api_key: str) -> dict[str, str]:
    """Anthropic Messages API 인증 헤더 (버전 포함)."""
    return {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_API_VERSION,
    }


def sse_response_headers() -> dict[str, str]:
    """SSE(Server-Sent Events) 스트리밍 응답 헤더."""
    return {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    }
