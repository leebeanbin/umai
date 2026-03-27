"use client";

/**
 * Model capability registry.
 *
 * Sources of truth (in priority order):
 *  1. Model tags stored in appStore (e.g. tags: ["Vision"])
 *  2. Pattern matching on model ID
 *
 * Capabilities:
 *  vision — model can receive images natively in the message payload
 *  tools  — model supports function calling / tool use
 */

import { loadModels } from "@/lib/appStore";

export type ModelCapabilities = {
  vision: boolean;
  tools: boolean;
};

// ── Pattern tables ─────────────────────────────────────────────────────────────

// ── Vision capability patterns ─────────────────────────────────────────────
const VISION_PATTERNS: RegExp[] = [
  // ── OpenAI ──────────────────────────────────────────────────────────────
  /^gpt-5/,                  // GPT-5.x all support vision
  /^gpt-4o/,
  /^gpt-4-vision/,
  /^gpt-4-turbo/,
  /^gpt-oss/,                // gpt-oss-120b (open-weight)
  /^o1/,
  /^o3/,
  /^o4/,
  // ── Anthropic (claude-3+ all vision) ─────────────────────────────────────
  /^claude-3/,
  /^claude-sonnet/,
  /^claude-opus/,
  /^claude-haiku/,
  // ── Google ───────────────────────────────────────────────────────────────
  /^gemini/,
  /^gemma3/i,                // Gemma 3 multimodal
  // ── xAI ──────────────────────────────────────────────────────────────────
  /^grok-4/,                 // Grok 4.x vision
  /^grok-3/,
  // ── Ollama / open-weight vision models ───────────────────────────────────
  /^llava/i,
  /bakllava/i,
  /moondream/i,
  /minicpm.?v/i,             // MiniCPM-V 2.6
  /internvl/i,
  /cogvlm/i,
  /qwen.*vl/i,               // qwen2.5vl, qwen3-vl, qwen2-vl
  /llama3\.[23].*vision/i,
  /phi.*vision/i,
  /phi-?4.*vision/i,
  /pixtral/i,                // Mistral Pixtral (124B)
  /mistral.*vision/i,
  /gemma3/i,
  /kimi/i,                   // Kimi K2.5 — native multimodal
  /glm.*ocr/i,               // GLM-OCR
  /glm-5/i,                  // GLM-5 multimodal
  /minimax/i,                // MiniMax-M2.5 multimodal
  /qwen3-vl/i,
];

// ── Tool/function-calling capability patterns ─────────────────────────────
const TOOLS_PATTERNS: RegExp[] = [
  // ── OpenAI ──────────────────────────────────────────────────────────────
  /^gpt-5/,
  /^gpt-4/,
  /^gpt-3\.5-turbo/,
  /^gpt-oss/,
  /^o1/,
  /^o3/,
  /^o4/,
  // ── Anthropic ────────────────────────────────────────────────────────────
  /^claude-3/,
  /^claude-sonnet/,
  /^claude-opus/,
  /^claude-haiku/,
  // ── Google ───────────────────────────────────────────────────────────────
  /^gemini/,
  /^gemma3/i,
  // ── xAI ──────────────────────────────────────────────────────────────────
  /^grok/,
  // ── Ollama — confirmed tool/function calling support ─────────────────────
  /^llama3/,                 // llama3.1, llama3.2, llama3.3
  /^mistral/,                // mistral, mistral-nemo
  /^mixtral/,
  /^qwen2/,                  // qwen2, qwen2.5, qwen2.5-coder
  /^qwen3/,                  // qwen3, qwen3.5, qwen3-coder, qwen3-vl
  /^deepseek/,               // deepseek-r1, deepseek-v3
  /^firefunction/,
  /^command-r/,
  /^phi-?4/,                 // Phi-4, Phi-4-mini
  /^phi3/,
  /^exaone/i,                // EXAONE 4.0 (LG AI — Korean/English)
  /^glm/i,                   // GLM-4, GLM-5
  /^internlm/i,              // InternLM 2.5+
  /^kimi/i,                  // Kimi K2, K2.5
  /^minimax/i,               // MiniMax-M2, M2.5
  /^qwen3-coder/i,
];

// ── Public API ─────────────────────────────────────────────────────────────────

export function getModelCapabilities(modelId: string): ModelCapabilities {
  // 1. Check tag registry first (user-configured)
  const model = loadModels().find((m) => m.id === modelId);
  if (model) {
    const tags = model.tags.map((t) => t.toLowerCase());
    const visionFromTag = tags.includes("vision");
    const toolsFromTag  = tags.includes("tools");
    return {
      vision: visionFromTag || VISION_PATTERNS.some((p) => p.test(modelId)),
      tools:  toolsFromTag  || TOOLS_PATTERNS.some((p) => p.test(modelId)),
    };
  }

  // 2. Pattern matching fallback
  return {
    vision: VISION_PATTERNS.some((p) => p.test(modelId)),
    tools:  TOOLS_PATTERNS.some((p) => p.test(modelId)),
  };
}
