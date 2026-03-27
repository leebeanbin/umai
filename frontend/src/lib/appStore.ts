"use client";

// 앱 전역 설정 — localStorage 기반 persist

export type LangOverride = "auto" | "en" | "ko";

export type DynamicModel = {
  id: string;
  name: string;
  provider: "OpenAI" | "Anthropic" | "Google" | string;
  tags: string[];
};

export type AppSettings = {
  selectedModel: string;
  temperature:   number | null;
  maxTokens:     number | null;
  systemPrompt:  string;
  webSearchEnabled: boolean;
  theme:    "dark" | "light" | "system";
  language: "ko" | "en";
  inputLang:  LangOverride;
  outputLang: LangOverride;
};

const STORAGE_KEY = "umai_settings";
const MODELS_KEY  = "umai_models";

export const FALLBACK_MODELS: DynamicModel[] = [
  // ── OpenAI (March 2026) ───────────────────────────────────────────────────
  { id: "gpt-5.4-pro",              name: "GPT-5.4 Pro",            provider: "OpenAI",    tags: ["Vision", "Fast"] },
  { id: "gpt-5.4",                  name: "GPT-5.4",                provider: "OpenAI",    tags: ["Vision"] },
  { id: "gpt-4o",                   name: "GPT-4o",                 provider: "OpenAI",    tags: ["Vision"] },
  { id: "gpt-4o-mini",              name: "GPT-4o mini",            provider: "OpenAI",    tags: ["Fast"] },
  { id: "o4-mini",                  name: "o4-mini",                provider: "OpenAI",    tags: ["Reasoning"] },
  { id: "o3",                       name: "o3",                     provider: "OpenAI",    tags: ["Reasoning"] },
  // ── Anthropic (Feb 2026) ────────────────────────────────────────────────
  { id: "claude-opus-4-6",          name: "Claude Opus 4.6",        provider: "Anthropic", tags: ["Vision", "Coding"] },
  { id: "claude-sonnet-4-6",        name: "Claude Sonnet 4.6",      provider: "Anthropic", tags: ["Vision"] },
  { id: "claude-sonnet-4-5",        name: "Claude Sonnet 4.5",      provider: "Anthropic", tags: ["Vision"] },
  { id: "claude-haiku-4-5-20251001",name: "Claude Haiku 4.5",       provider: "Anthropic", tags: ["Fast"] },
  // ── Google (March 2026) ─────────────────────────────────────────────────
  { id: "gemini-3.1-pro-preview",   name: "Gemini 3.1 Pro",         provider: "Google",    tags: ["Vision", "Reasoning"] },
  { id: "gemini-3-flash",           name: "Gemini 3 Flash",         provider: "Google",    tags: ["Vision", "Fast"] },
  { id: "gemini-2.5-pro",           name: "Gemini 2.5 Pro",         provider: "Google",    tags: ["Vision"] },
  { id: "gemini-2.0-flash",         name: "Gemini 2.0 Flash",       provider: "Google",    tags: ["Vision", "Fast"] },
  // ── xAI / Grok ──────────────────────────────────────────────────────────
  { id: "grok-4.20",                name: "Grok 4.20",              provider: "xAI",       tags: ["Vision", "Coding"] },
  { id: "grok-4.1",                 name: "Grok 4.1",               provider: "xAI",       tags: ["Vision", "Fast"] },
  // ── Ollama — Frontier open-weight (March 2026) ───────────────────────────
  { id: "gpt-oss-120b",             name: "GPT-OSS 120B",           provider: "Ollama",    tags: ["Vision", "Open"] },
  { id: "kimi-k2.5",               name: "Kimi K2.5",              provider: "Ollama",    tags: ["Vision", "Open", "Agentic"] },
  { id: "minimax-m2.5",            name: "MiniMax M2.5",           provider: "Ollama",    tags: ["Open", "Coding"] },
  { id: "glm-5",                    name: "GLM-5",                  provider: "Ollama",    tags: ["Vision", "Open"] },
  // ── Qwen3 family ────────────────────────────────────────────────────────
  { id: "qwen3:32b",                name: "Qwen3 32B",              provider: "Ollama",    tags: ["Open"] },
  { id: "qwen3:14b",                name: "Qwen3 14B",              provider: "Ollama",    tags: ["Open"] },
  { id: "qwen3:8b",                 name: "Qwen3 8B",               provider: "Ollama",    tags: ["Fast", "Open"] },
  { id: "qwen3:4b",                 name: "Qwen3 4B",               provider: "Ollama",    tags: ["Fast", "Open"] },
  { id: "qwen3-coder:32b",          name: "Qwen3-Coder 32B",        provider: "Ollama",    tags: ["Coding", "Open"] },
  // ── DeepSeek-R1 (reasoning) ─────────────────────────────────────────────
  { id: "deepseek-r1:70b",          name: "DeepSeek-R1 70B",        provider: "Ollama",    tags: ["Reasoning", "Open"] },
  { id: "deepseek-r1:14b",          name: "DeepSeek-R1 14B",        provider: "Ollama",    tags: ["Reasoning", "Open"] },
  { id: "deepseek-r1:8b",           name: "DeepSeek-R1 8B",         provider: "Ollama",    tags: ["Reasoning", "Fast", "Open"] },
  // ── Other open-weight ───────────────────────────────────────────────────
  { id: "llama3.3:70b",             name: "Llama 3.3 70B",          provider: "Ollama",    tags: ["Open"] },
  { id: "phi4:14b",                 name: "Phi-4 14B",              provider: "Ollama",    tags: ["Fast", "Open"] },
  { id: "gemma3:12b",               name: "Gemma 3 12B",            provider: "Ollama",    tags: ["Vision", "Open"] },
  { id: "exaone4.0:7.8b",           name: "EXAONE 4.0 7.8B",        provider: "Ollama",    tags: ["Fast", "Open"] },
  // ── Vision ───────────────────────────────────────────────────────────────
  { id: "qwen3-vl:7b",              name: "Qwen3-VL 7B",            provider: "Ollama",    tags: ["Vision", "Open"] },
  { id: "qwen2.5vl:7b",             name: "Qwen2.5-VL 7B",          provider: "Ollama",    tags: ["Vision", "Open"] },
  { id: "minicpm-v:8b",             name: "MiniCPM-V 8B",           provider: "Ollama",    tags: ["Vision", "Open"] },
  { id: "moondream2",               name: "Moondream 2",            provider: "Ollama",    tags: ["Vision", "Open", "Fast"] },
];

const DEFAULTS: AppSettings = {
  selectedModel: "gpt-4o",
  temperature:   null,
  maxTokens:     null,
  systemPrompt:  "",
  webSearchEnabled: false,
  theme:    "dark",
  language: "ko",
  inputLang:  "auto",
  outputLang: "auto",
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: Partial<AppSettings>) {
  if (typeof window === "undefined") return;
  const current = loadSettings();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...settings }));
}

export function loadModels(): DynamicModel[] {
  if (typeof window === "undefined") return FALLBACK_MODELS;
  try {
    const raw = localStorage.getItem(MODELS_KEY);
    if (!raw) return FALLBACK_MODELS;
    const parsed = JSON.parse(raw) as DynamicModel[];
    return parsed.length > 0 ? parsed : FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}

export function saveModels(models: DynamicModel[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(MODELS_KEY, JSON.stringify(models));
}

/**
 * Fetch the current user's available models from /api/models.
 * Automatically persists to localStorage for stale-while-revalidate.
 * Falls back to cached/FALLBACK_MODELS on error.
 */
export async function fetchModels(): Promise<DynamicModel[]> {
  try {
    const { getStoredToken } = await import("@/lib/api/backendClient");
    const token = typeof window !== "undefined" ? getStoredToken() : "";
    const res = await fetch("/api/models", {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("fetch failed");
    const models = (await res.json()) as DynamicModel[];
    if (models.length > 0) {
      saveModels(models);
      return models;
    }
  } catch {
    // ignore — fall through
  }
  return loadModels();
}

