"""
AI/LLM 모델명 레지스트리 — 모든 모델 ID 문자열을 한 곳에서 관리.

사용 목적:
  - 모델 ID 오타 방지
  - 모델 업그레이드/변경 시 이 파일만 수정
  - 태스크·라우터·임베딩 서비스가 동일한 ID를 참조

주의:
  - 실제 사용 가능 여부는 API 키 설정에 따라 다름
  - 기본값(default)은 시스템 설정(SystemSettings)에서 오버라이드 가능
"""

# ── OpenAI Chat ───────────────────────────────────────────────────────────────

OPENAI_GPT_4O          = "gpt-4o"
OPENAI_GPT_4O_MINI     = "gpt-4o-mini"

# ── OpenAI Image ──────────────────────────────────────────────────────────────

OPENAI_GPT_IMAGE_1     = "gpt-image-1"    # 인페인팅 (edit_image, compose_studio)
OPENAI_DALLE_3         = "dall-e-3"       # 텍스트→이미지 생성
OPENAI_DALLE_2         = "dall-e-2"       # 레거시 (비권장)

# ── OpenAI Embedding ──────────────────────────────────────────────────────────

OPENAI_EMBED_SMALL     = "text-embedding-3-small"
OPENAI_EMBED_LARGE     = "text-embedding-3-large"

# ── OpenAI Vision / OCR ───────────────────────────────────────────────────────

OPENAI_VISION_MODEL    = "gpt-4o"         # analyze_image에서 사용

# ── Anthropic ─────────────────────────────────────────────────────────────────

ANTHROPIC_SONNET       = "claude-sonnet-4-6"
ANTHROPIC_HAIKU        = "claude-haiku-4-5-20251001"

ANTHROPIC_API_VERSION  = "2023-06-01"     # anthropic-version 헤더값

# ── Ollama ────────────────────────────────────────────────────────────────────

OLLAMA_EMBED_DEFAULT   = "nomic-embed-text"   # 임베딩 기본 모델
OLLAMA_VISION_DEFAULT  = "llava"              # OCR/vision fallback

# ── 컨텍스트 윈도우 크기 (토큰) ──────────────────────────────────────────────
# run_agent 히스토리 트리밍에 사용. 미등록 모델은 32K fallback.

CONTEXT_WINDOW: dict[str, int] = {
    "gpt-4o":                       128_000,
    "gpt-4o-mini":                  128_000,
    "claude-opus-4-7":              200_000,
    "claude-sonnet-4-6":            200_000,
    "claude-haiku-4-5-20251001":    200_000,
    "gemini-2.0-flash":           1_048_576,
    "gemini-2.5-pro":             2_097_152,
    "gemini-2.5-flash":           1_048_576,
    "grok-3":                       131_072,
    "grok-3-mini":                  131_072,
}

MAX_TOKENS_RESERVE = 8_000  # 응답 + tool call 여유분

# ── 기본값 (시스템 설정에서 오버라이드 가능) ──────────────────────────────────

DEFAULT_CHAT_MODEL           = OPENAI_GPT_4O
DEFAULT_IMAGE_GEN_MODEL      = OPENAI_DALLE_3
DEFAULT_IMAGE_EDIT_MODEL     = OPENAI_GPT_IMAGE_1
DEFAULT_EMBEDDING_MODEL_OAI  = OPENAI_EMBED_SMALL
DEFAULT_EMBEDDING_MODEL_OLLA = OLLAMA_EMBED_DEFAULT
