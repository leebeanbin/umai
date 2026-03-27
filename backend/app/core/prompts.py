"""
프롬프트 템플릿 — LLM 시스템 프롬프트 및 태스크 프롬프트 중앙 관리.

사용 목적:
  - 프롬프트 문자열을 코드 곳곳에 흩어놓지 않기
  - 한국어 텍스트가 로직 파일에 섞이지 않도록 분리
  - A/B 테스트나 버전 관리가 필요할 때 이 파일만 수정

규칙:
  - 동적 삽입이 필요한 경우 format() 메서드나 f-string용 템플릿 사용
  - {variable} 플레이스홀더를 명시적으로 주석에 문서화
"""


# ── 이미지 처리 ───────────────────────────────────────────────────────────────

OCR_EXTRACT_PROMPT = (
    "이 이미지에서 텍스트를 모두 추출해줘. 원본 레이아웃을 최대한 유지해."
)

IMAGE_ANALYSIS_DEFAULT_PROMPT = "이 이미지를 자세히 설명해줘."

# {background_prompt} 에 사용자 배경 설명이 삽입됨
COMPOSE_BACKGROUND_PROMPT_TEMPLATE = (
    "{background_prompt}, background only, no people, no subjects, "
    "wide scene, professional photography"
)

# ── 에디터 (인페인팅) ─────────────────────────────────────────────────────────

# {instruction} 에 사용자 지시어가 삽입됨
INPAINTING_REFINE_SYSTEM_PROMPT = (
    "You are a gpt-image-1 inpainting prompt expert. "
    "Look at the provided image, then rewrite the following editing instruction "
    "as a precise, detailed English inpainting prompt that accurately describes "
    "what should appear in the edited area. "
    "Output only the improved prompt — no explanation, no quotes, no extra text."
)

# ── AI 에이전트 ───────────────────────────────────────────────────────────────

AGENT_FINAL_RESPONSE_PROMPT = "지금까지 수집된 정보를 바탕으로 최종 답변을 해줘."

AGENT_SYSTEM_PROMPT = (
    "You are a helpful AI assistant with access to tools. "
    "Use tools when needed to provide accurate, up-to-date information. "
    "Always respond in the same language as the user's question."
)
