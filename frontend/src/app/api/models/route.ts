/**
 * GET /api/models
 *
 * 인증된 유저가 사용 가능한 모델 목록을 반환.
 * 우선순위:
 *   1. 백엔드 system_settings.models 에 저장된 목록 (관리자가 설정한 활성화 모델)
 *   2. 서버 env에 API 키가 있는 provider만 포함
 *   3. Ollama는 백엔드가 live query해서 반환
 *
 * 백엔드 GET /api/v1/admin/models 를 내부 프록시로 호출.
 * Next.js rewrite는 /api/* → backend 이지만, route handler가 우선하므로
 * 이 파일이 먼저 실행된다. 여기서 백엔드를 직접 호출.
 *
 * GET /api/models  → DynamicModel[]
 */

import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? "http://localhost:8000";

export type DynamicModel = {
  id: string;
  name: string;
  provider: "OpenAI" | "Anthropic" | "Google" | "Ollama" | string;
  tags: string[];
};

// Which providers have server-side API keys configured
function serverProviders(): Set<string> {
  const providers = new Set<string>();
  if (process.env.OPENAI_API_KEY)    providers.add("OpenAI");
  if (process.env.ANTHROPIC_API_KEY) providers.add("Anthropic");
  if (process.env.GOOGLE_API_KEY)    providers.add("Google");
  if (process.env.XAI_API_KEY)       providers.add("xAI");
  // Ollama is always potentially available (no key needed)
  providers.add("Ollama");
  return providers;
}

function inferTags(id: string, provider: string): string[] {
  const tags: string[] = [];
  const idL = id.toLowerCase();

  if (
    idL.includes("vision") || idL.includes("4o") ||
    idL.includes("gpt-5") || idL.includes("gpt-oss") ||
    idL.includes("gemini") || idL.includes("gemma3") ||
    idL.includes("claude") ||
    idL.includes("grok-4") || idL.includes("grok-3") ||
    idL.includes("kimi") || idL.includes("glm-5") || idL.includes("minimax") ||
    idL.includes("llava") || idL.includes("moondream") ||
    idL.includes("-vl") || idL.includes("vl:")
  ) tags.push("Vision");

  if (
    idL.includes("mini") || idL.includes("flash") ||
    idL.includes("haiku") || idL.includes("3b") ||
    idL.includes("1b") || idL.includes("7b") ||
    idL.includes("grok-4.1")
  ) tags.push("Fast");

  if (provider === "Ollama") tags.push("Local");

  return tags;
}

function formatName(id: string): string {
  // e.g. "gpt-4o-mini" → "GPT-4o mini"  "claude-sonnet-4-6" → "Claude Sonnet 4.6"
  return id
    .replace("models/", "")
    .replace(/-/g, " ")
    .replace(/\b(\w)/g, (c) => c.toUpperCase())
    .replace(/(\d+)\.(\d+)/g, "$1.$2")
    .trim();
}

export async function GET(req: NextRequest) {
  // Forward Authorization header from the browser request
  const authHeader = req.headers.get("authorization") ?? "";

  let backendModels: { id: string; name: string; provider: string }[] = [];

  if (authHeader) {
    try {
      const res = await fetch(`${INTERNAL_API_URL}/api/v1/admin/models`, {
        headers: { Authorization: authHeader },
        next: { revalidate: 30 }, // cache 30s
      });
      if (res.ok) {
        backendModels = await res.json() as typeof backendModels;
      }
    } catch {
      // Backend unreachable — fall through to fallback
    }
  }

  const available = serverProviders();

  // Filter: only include models whose provider has an API key on this server
  // (Ollama is always included since it has no key requirement)
  const models: DynamicModel[] = backendModels
    .filter((m) => available.has(m.provider))
    .map((m) => ({
      id:       m.id,
      name:     formatName(m.id),
      provider: m.provider as DynamicModel["provider"],
      tags:     inferTags(m.id, m.provider),
    }));

  // Fallback: if backend unavailable or returned nothing, return env-based defaults
  if (models.length === 0) {
    const fallback: DynamicModel[] = [];
    if (available.has("OpenAI")) {
      fallback.push(
        { id: "gpt-4o",      name: "GPT-4o",      provider: "OpenAI",    tags: ["Vision"] },
        { id: "gpt-4o-mini", name: "GPT-4o Mini",  provider: "OpenAI",    tags: ["Fast"] },
      );
    }
    if (available.has("Anthropic")) {
      fallback.push(
        { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "Anthropic", tags: ["Vision"] },
      );
    }
    if (available.has("Google")) {
      fallback.push(
        { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", provider: "Google", tags: ["Vision"] },
        { id: "gemini-3-flash",         name: "Gemini 3 Flash",  provider: "Google", tags: ["Vision", "Fast"] },
      );
    }
    if (available.has("xAI")) {
      fallback.push(
        { id: "grok-4.20", name: "Grok 4.20", provider: "xAI", tags: ["Vision"] },
        { id: "grok-4.1",  name: "Grok 4.1",  provider: "xAI", tags: ["Vision", "Fast"] },
      );
    }
    return NextResponse.json(fallback, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
    });
  }

  return NextResponse.json(models, {
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
  });
}
