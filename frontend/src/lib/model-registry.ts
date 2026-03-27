/**
 * AI/LLM 모델명 레지스트리 (프론트엔드)
 *
 * 백엔드 app/core/model_registry.py 와 값을 맞춰 관리.
 * 모델 변경 시 두 파일을 함께 수정할 것.
 */

// ── OpenAI ────────────────────────────────────────────────────────────────────
export const OPENAI_GPT_4O       = "gpt-4o";
export const OPENAI_GPT_4O_MINI  = "gpt-4o-mini";
export const OPENAI_GPT_IMAGE_1  = "gpt-image-1";
export const OPENAI_DALLE_3      = "dall-e-3";
export const OPENAI_EMBED_SMALL  = "text-embedding-3-small";

// ── Anthropic ─────────────────────────────────────────────────────────────────
export const ANTHROPIC_SONNET    = "claude-sonnet-4-6";
export const ANTHROPIC_HAIKU     = "claude-haiku-4-5-20251001";

// ── Ollama ────────────────────────────────────────────────────────────────────
export const OLLAMA_EMBED_DEFAULT  = "nomic-embed-text";
export const OLLAMA_VISION_DEFAULT = "llava";

// ── 기본값 ────────────────────────────────────────────────────────────────────
export const DEFAULT_EMBEDDING_MODEL = OLLAMA_EMBED_DEFAULT;
export const DEFAULT_IMAGE_EDIT_MODEL: "gpt-image-1" | "comfyui" = "gpt-image-1";
