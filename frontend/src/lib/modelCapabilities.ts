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

const VISION_PATTERNS: RegExp[] = [
  // OpenAI
  /^gpt-4o/,
  /^gpt-4-vision/,
  /^gpt-4-turbo/,
  /^o1/,
  /^o3/,
  /^o4/,
  // Anthropic — claude-3 and above all support vision
  /^claude-3/,
  /^claude-sonnet/,
  /^claude-opus/,
  /^claude-haiku/,
  // Google
  /^gemini/,
  // Ollama vision models
  /llava/i,
  /bakllava/i,
  /moondream/i,
  /minicpm.?v/i,
  /internvl/i,
  /cogvlm/i,
  /qwen.*vl/i,
  /llama3\.2.*vision/i,
  /phi.*vision/i,
];

const TOOLS_PATTERNS: RegExp[] = [
  // OpenAI
  /^gpt-4/,
  /^gpt-3\.5-turbo/,
  /^o1/,
  /^o3/,
  /^o4/,
  // Anthropic
  /^claude-3/,
  /^claude-sonnet/,
  /^claude-opus/,
  /^claude-haiku/,
  // Google
  /^gemini/,
  // Ollama models that support tools (as of Ollama 0.3+)
  /^llama3/,
  /^mistral/,
  /^qwen2/,
  /^deepseek/,
  /^firefunction/,
  /^command-r/,
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
