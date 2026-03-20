/**
 * /api/chat — LLM streaming proxy
 *
 * Priority:
 *   1. Server-side env keys (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY)
 *   2. Client-provided key (from browser localStorage, passed in request body)
 *
 * All providers are normalized to OpenAI SSE format so the client
 * can use a single parser regardless of the upstream provider.
 *
 * GET  /api/chat  → { openai: bool, anthropic: bool, google: bool }
 * POST /api/chat  → SSE stream
 */

import { NextRequest, NextResponse } from "next/server";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

// ── Key resolution ────────────────────────────────────────────────────────────

function serverKey(provider: string): string {
  if (provider === "openai")    return process.env.OPENAI_API_KEY    ?? "";
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY ?? "";
  if (provider === "google")    return process.env.GOOGLE_API_KEY    ?? "";
  return "";
}

/** Reports which providers have server-configured API keys. */
export async function GET() {
  let ollamaReachable = false;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    ollamaReachable = res.ok;
  } catch { /* unreachable */ }

  return NextResponse.json({
    openai:    !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    google:    !!process.env.GOOGLE_API_KEY,
    ollama:    ollamaReachable,
  });
}

// ── Request handler ───────────────────────────────────────────────────────────

type RequestBody = {
  provider: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  sysPrompt?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
};

export async function POST(req: NextRequest) {
  const body = await req.json() as RequestBody;
  const { provider, model, messages, sysPrompt, temperature, maxTokens, topP } = body;

  // Ollama needs no API key — handle before the key check
  if (provider === "ollama") return proxyOllama({ model, messages, apiKey: "", sysPrompt, temperature, maxTokens, topP });

  const apiKey = serverKey(provider);

  if (!apiKey) {
    return NextResponse.json({ error: `__NO_KEY__:${provider}` }, { status: 401 });
  }

  if (provider === "openai")    return proxyOpenAI({ model, messages, apiKey, sysPrompt, temperature, maxTokens, topP });
  if (provider === "anthropic") return proxyAnthropic({ model, messages, apiKey, sysPrompt, temperature, maxTokens, topP });
  if (provider === "google")    return proxyGoogle({ model, messages, apiKey, sysPrompt, temperature, maxTokens, topP });

  return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
}

// ── SSE normalization helper ──────────────────────────────────────────────────

/**
 * Returns a TransformStream that parses upstream SSE chunks and
 * re-emits them as OpenAI-compatible SSE:
 *   data: {"choices":[{"delta":{"content":"…"}}]}\n\n
 *
 * `extractText` receives the raw `data: …` payload and returns the text
 * delta (or null to skip the line).
 */
function normalizeToOpenAISse(
  extractText: (data: string) => string | null
): TransformStream<Uint8Array, Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf   = "";

  return new TransformStream({
    transform(chunk, ctrl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const text = extractText(payload);
          if (text) {
            const out = JSON.stringify({ choices: [{ delta: { content: text } }] });
            ctrl.enqueue(enc.encode(`data: ${out}\n\n`));
          }
        } catch { /* skip malformed */ }
      }
    },
    flush(ctrl) {
      ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
    },
  });
}

// ── Provider proxy functions ──────────────────────────────────────────────────

type ProxyArgs = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  apiKey: string;
  sysPrompt?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
};

const SSE_HEADERS = {
  "Content-Type":      "text/event-stream",
  "Cache-Control":     "no-cache",
  "X-Accel-Buffering": "no",
} as const;

// ─ OpenAI ────────────────────────────────────────────────────────────────────

async function proxyOpenAI({ model, messages, apiKey, sysPrompt, temperature, maxTokens, topP }: ProxyArgs) {
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: sysPrompt
      ? [{ role: "system", content: sysPrompt }, ...messages]
      : messages,
  };
  if (temperature != null) body.temperature = temperature;
  if (maxTokens   != null) body.max_tokens  = maxTokens;
  if (topP        != null) body.top_p       = topP;

  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({})) as Record<string, Record<string, string>>;
    return NextResponse.json(
      { error: err?.error?.message ?? `OpenAI error ${upstream.status}` },
      { status: upstream.status }
    );
  }

  // OpenAI already emits OpenAI-format SSE — pipe through directly.
  return new Response(upstream.body, { headers: SSE_HEADERS });
}

// ─ Anthropic ─────────────────────────────────────────────────────────────────

async function proxyAnthropic({ model, messages, apiKey, sysPrompt, temperature, maxTokens, topP }: ProxyArgs) {
  const body: Record<string, unknown> = {
    model,
    stream: true,
    max_tokens: maxTokens ?? 1024,
    messages:   messages.filter((m) => m.role !== "system"),
  };
  if (sysPrompt)           body.system      = sysPrompt;
  if (temperature != null) body.temperature = temperature;
  if (topP        != null) body.top_p       = topP;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({})) as Record<string, Record<string, string>>;
    return NextResponse.json(
      { error: err?.error?.message ?? `Anthropic error ${upstream.status}` },
      { status: upstream.status }
    );
  }

  // Transform Anthropic SSE → OpenAI SSE format
  // Anthropic: data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}
  const xform = normalizeToOpenAISse((payload) => {
    const json = JSON.parse(payload) as {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
      return json.delta.text ?? null;
    }
    return null;
  });

  return new Response(upstream.body!.pipeThrough(xform), { headers: SSE_HEADERS });
}

// ─ Ollama ─────────────────────────────────────────────────────────────────────

async function proxyOllama({ model, messages, sysPrompt, temperature, maxTokens }: ProxyArgs) {
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: sysPrompt
      ? [{ role: "system", content: sysPrompt }, ...messages]
      : messages,
  };
  if (temperature != null) body.options = { ...(body.options as object ?? {}), temperature };
  if (maxTokens   != null) body.options = { ...(body.options as object ?? {}), num_predict: maxTokens };

  const upstream = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: "Ollama unreachable. Make sure Ollama is running." }, { status: 503 });
  }

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({})) as Record<string, Record<string, string>>;
    return NextResponse.json(
      { error: err?.error?.message ?? `Ollama error ${upstream.status}` },
      { status: upstream.status }
    );
  }

  // Ollama's /v1/chat/completions emits OpenAI-format SSE — pipe through directly.
  return new Response(upstream.body, { headers: SSE_HEADERS });
}

// ─ Google ─────────────────────────────────────────────────────────────────────

async function proxyGoogle({ model, messages, apiKey, sysPrompt, temperature, maxTokens, topP }: ProxyArgs) {
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role:  m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const generationConfig: Record<string, unknown> = {};
  if (temperature != null) generationConfig.temperature     = temperature;
  if (maxTokens   != null) generationConfig.maxOutputTokens = maxTokens;
  if (topP        != null) generationConfig.topP            = topP;

  const body: Record<string, unknown> = { contents };
  if (Object.keys(generationConfig).length) body.generationConfig   = generationConfig;
  if (sysPrompt)                            body.systemInstruction  = { parts: [{ text: sysPrompt }] };

  const modelId  = model.startsWith("models/") ? model : `models/${model}`;
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelId}:streamGenerateContent?key=${apiKey}&alt=sse`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    }
  );

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({})) as Record<string, Record<string, string>>;
    return NextResponse.json(
      { error: err?.error?.message ?? `Google error ${upstream.status}` },
      { status: upstream.status }
    );
  }

  // Transform Google SSE → OpenAI SSE format
  // Google: data: {"candidates":[{"content":{"parts":[{"text":"…"}]}}]}
  const xform = normalizeToOpenAISse((payload) => {
    const json = JSON.parse(payload) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  });

  return new Response(upstream.body!.pipeThrough(xform), { headers: SSE_HEADERS });
}
