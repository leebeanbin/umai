"""
제목 생성 서비스 — Ollama 경량 모델로 대화 내용을 요약해 짧은 제목을 생성한다.

계층 분리:
  비즈니스 로직  generate()         — "어떤" 제목을 만들어야 하는가 (규칙, 포맷)
  서비스 로직    _call_ollama()      — Ollama API를 "어떻게" 호출하는가
  에러 처리      OllamaConnectionError / OllamaTimeoutError / TitleGenerationError

호출자(라우터)는 TitleGenerationError 계열을 잡아 HTTP 상태코드로 변환한다.
"""
from __future__ import annotations

import re

import httpx


# ── 도메인 예외 ───────────────────────────────────────────────────────────────

class TitleGenerationError(Exception):
    """제목 생성 파이프라인의 기본 예외."""


class OllamaConnectionError(TitleGenerationError):
    """Ollama 서버에 연결할 수 없는 경우."""


class OllamaTimeoutError(TitleGenerationError):
    """Ollama 서버 응답 시간 초과."""


class OllamaModelNotFoundError(TitleGenerationError):
    """요청한 모델이 Ollama에 존재하지 않는 경우."""


# ── 서비스 ────────────────────────────────────────────────────────────────────

class TitleService:
    """
    Ollama 경량 모델로 대화 첫 번째 교환(user + assistant)에서
    최대 10단어짜리 제목을 생성한다.
    언어는 호출 시 지정하며, 기본값은 영어(en).
    """

    # ── 비즈니스 규칙 상수 ────────────────────────────────────────────────────
    # 언어 코드 → 제목 생성 지시문 (LLM이 이해하기 쉽도록 해당 언어로 작성)
    TITLE_INSTRUCTIONS: dict[str, str] = {
        "ko": (
            "위 대화를 최대 10단어의 한국어 제목으로 요약해줘. "
            "제목만, 따옴표·마침표·설명 없이 간결하게."
        ),
        "en": (
            "Summarize this conversation as a concise title in up to 10 words. "
            "Title only — no quotes, periods, or explanations."
        ),
        "ja": (
            "この会話を最大10語の日本語タイトルで要約してください。"
            "タイトルのみ、引用符・句読点・説明なし。"
        ),
        "zh": (
            "用最多10个词的中文标题总结以上对话。"
            "只需标题，无引号、句号或解释。"
        ),
        "es": (
            "Resume esta conversación en un título de máximo 10 palabras en español. "
            "Solo el título, sin comillas, puntos ni explicaciones."
        ),
        "fr": (
            "Résumez cette conversation en un titre d'au plus 10 mots en français. "
            "Titre seulement, sans guillemets, points ni explications."
        ),
        "de": (
            "Fasse dieses Gespräch in einem Titel mit maximal 10 Wörtern auf Deutsch zusammen. "
            "Nur der Titel, ohne Anführungszeichen, Punkte oder Erklärungen."
        ),
    }
    DEFAULT_LANGUAGE    = "en"

    MAX_ASSISTANT_CHARS = 500   # 너무 긴 응답은 잘라 프롬프트 토큰 절약
    MAX_TITLE_LENGTH    = 80    # 최대 10단어 기준 여유 있게
    _CLEAN_RE           = re.compile(r"""[""\"'''\'.。\n\r]""")

    def __init__(self, ollama_url: str, model: str, timeout: int = 10) -> None:
        self._ollama_url = ollama_url.rstrip("/")
        self._model      = model
        self._timeout    = timeout

    # ── 퍼블릭 API ────────────────────────────────────────────────────────────

    async def generate(
        self, user_content: str, assistant_content: str, language: str = "en"
    ) -> str:
        """
        대화의 첫 교환을 받아 짧은 제목을 반환한다.

        Args:
            user_content:      유저 메시지 (전체)
            assistant_content: 어시스턴트 응답 (MAX_ASSISTANT_CHARS까지)
            language:          제목 언어 코드 (ko / en / ja / zh / es / fr / de)
                               지원하지 않는 코드는 DEFAULT_LANGUAGE(en)로 fallback.

        Returns:
            정리된 제목 문자열. Ollama 오류 시 TitleGenerationError 계열 raise.
        """
        messages = self._build_messages(user_content, assistant_content, language)
        raw      = await self._call_ollama(messages)
        return self._clean(raw)

    # ── 비즈니스 로직 ─────────────────────────────────────────────────────────

    def _build_messages(
        self, user_content: str, assistant_content: str, language: str
    ) -> list[dict]:
        """제목 생성을 위한 3-메시지 프롬프트 구성."""
        instruction = self.TITLE_INSTRUCTIONS.get(
            language,
            self.TITLE_INSTRUCTIONS[self.DEFAULT_LANGUAGE],
        )
        return [
            {"role": "user",      "content": user_content},
            {"role": "assistant", "content": assistant_content[: self.MAX_ASSISTANT_CHARS]},
            {"role": "user",      "content": instruction},
        ]

    def _clean(self, raw: str) -> str:
        """따옴표·마침표·개행 제거 후 최대 길이 적용."""
        return self._CLEAN_RE.sub("", raw).strip()[: self.MAX_TITLE_LENGTH]

    # ── 서비스 로직 (Ollama I/O) ──────────────────────────────────────────────

    async def _call_ollama(self, messages: list[dict]) -> str:
        """
        Ollama /api/chat 엔드포인트를 호출하고 응답 텍스트를 반환한다.

        Raises:
            OllamaConnectionError: 서버 연결 실패
            OllamaTimeoutError:    응답 시간 초과
            OllamaModelNotFoundError: 404 (모델 없음)
            TitleGenerationError:  그 외 HTTP 오류
        """
        url     = f"{self._ollama_url}/api/chat"
        payload = {
            "model":    self._model,
            "messages": messages,
            "stream":   False,
            "options":  {"temperature": 0.3},  # 낮은 temperature → 일관된 짧은 제목
        }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, timeout=self._timeout)

            if resp.status_code == 404:
                raise OllamaModelNotFoundError(
                    f"모델 '{self._model}'이 Ollama에 없습니다. "
                    f"`ollama pull {self._model}` 로 다운로드하세요."
                )
            resp.raise_for_status()
            return resp.json().get("message", {}).get("content", "")

        except httpx.ConnectError as exc:
            raise OllamaConnectionError(
                f"Ollama 서버({self._ollama_url})에 연결할 수 없습니다."
            ) from exc
        except httpx.TimeoutException as exc:
            raise OllamaTimeoutError(
                f"Ollama 응답 시간 초과 ({self._timeout}초)."
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise TitleGenerationError(
                f"Ollama HTTP 오류: {exc.response.status_code}"
            ) from exc
