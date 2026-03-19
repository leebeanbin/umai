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
  apiKeys: { openai: string; anthropic: string; google: string };
  inputLang:  LangOverride;
  outputLang: LangOverride;
};

const STORAGE_KEY = "umai_settings";
const MODELS_KEY  = "umai_models";

// Shown when no API keys are configured yet
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
  apiKeys:  { openai: "", anthropic: "", google: "" },
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
 * Fetches available models from the provider's API using the given key.
 * Returns an empty array on error (no throws — caller handles UI feedback).
 */
export async function fetchModelsForProvider(
  provider: "openai" | "anthropic" | "google",
  apiKey: string
): Promise<DynamicModel[]> {
  if (!apiKey.trim()) return [];

  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as { data: { id: string }[] };
      return data.data
        .filter((m) =>
          m.id.startsWith("gpt-") ||
          m.id.startsWith("o1") ||
          m.id.startsWith("o3") ||
          m.id.startsWith("o4")
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => ({
          id: m.id,
          name: formatModelName(m.id),
          provider: "OpenAI" as const,
          tags: inferTags(m.id),
        }));
    }

    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as { data: { id: string; display_name?: string }[] };
      return data.data.map((m) => ({
        id: m.id,
        name: m.display_name ?? formatModelName(m.id),
        provider: "Anthropic" as const,
        tags: inferTags(m.id),
      }));
    }

    if (provider === "google") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as {
        models: {
          name: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }[];
      };
      return data.models
        .filter(
          (m) =>
            (m.supportedGenerationMethods ?? []).includes("generateContent") &&
            m.name.includes("gemini")
        )
        .map((m) => ({
          id: m.name.replace("models/", ""),
          name: m.displayName ?? formatModelName(m.name),
          provider: "Google" as const,
          tags: inferTags(m.name),
        }));
    }
  } catch {
    // Return empty — caller surfaces the error to the user
  }

  return [];
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
