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
  { id: "gpt-4o",            name: "GPT-4o",            provider: "OpenAI",    tags: ["Vision"] },
  { id: "gpt-4o-mini",       name: "GPT-4o mini",       provider: "OpenAI",    tags: ["Fast"] },
  { id: "gemini-2.0-flash",  name: "Gemini 2.0 Flash",  provider: "Google",    tags: ["Vision", "Fast"] },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "Anthropic", tags: ["Vision"] },
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
    const token = typeof window !== "undefined"
      ? (localStorage.getItem("umai_access_token") ?? "")
      : "";
    const res = await fetch("/api/models", {
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

function formatModelName(id: string): string {
  return id
    .replace("models/", "")
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function inferTags(id: string): string[] {
  const tags: string[] = [];
  if (
    id.includes("vision") ||
    id.includes("4o") ||
    id.includes("gemini") ||
    id.includes("claude")
  )
    tags.push("Vision");
  if (
    id.includes("mini") ||
    id.includes("flash") ||
    id.includes("haiku")
  )
    tags.push("Fast");
  return tags;
}
