/**
 * LLM streaming client — routes through /api/chat proxy.
 *
 * The proxy (src/app/api/chat/route.ts) handles:
 *   • Server-side API key injection (from env vars)
 *   • Normalizing all providers to OpenAI SSE format
 *   • CORS-free Anthropic access
 *
 * The client reads normalized SSE and batches chunk callbacks via
 * requestAnimationFrame so React state updates run at ≤60 fps,
 * not once per character.
 */

import { loadSettings, loadModels } from "@/lib/appStore";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type StreamChatOptions = {
  messages:            ChatMessage[];
  onChunk:             (text: string) => void;
  onDone:              () => void;
  onError:             (err: string) => void;
  signal?:             AbortSignal;
  modelOverride?:      string;
  temperatureOverride?: number;
};

// ── Provider resolution ───────────────────────────────────────────────────────

function getProvider(modelId: string): "openai" | "anthropic" | "google" | null {
  const model = loadModels().find((m) => m.id === modelId);
  if (model) {
    const p = model.provider.toLowerCase();
    if (p === "openai")    return "openai";
    if (p === "anthropic") return "anthropic";
    if (p === "google")    return "google";
  }
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3") || modelId.startsWith("o4")) return "openai";
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "google";
  return null;
}

function buildSystemPrompt(base: string, outputLang: string): string {
  const parts: string[] = [];
  if (base.trim()) parts.push(base.trim());
  if (outputLang !== "auto") {
    const name: Record<string, string> = { en: "English", ko: "Korean (한국어)" };
    parts.push(`Always respond in ${name[outputLang] ?? outputLang}.`);
  }
  return parts.join("\n\n");
}

// ── RAF-based chunk batcher ───────────────────────────────────────────────────
// Accumulates text deltas and flushes them at most once per animation frame.
// This caps React state updates to ~60/s instead of one per character,
// eliminating the "1000 setState calls for 1KB response" problem.
//
// Hidden-tab fallback: requestAnimationFrame never fires on hidden tabs, so
// pending chunks would pile up forever. We use a 1s setTimeout as a fallback
// (matching Open WebUI's behavior), then switch back to rAF when visible again.

function createChunkBatcher(onFlush: (text: string) => void) {
  let pending    = "";
  let rafId:     ReturnType<typeof requestAnimationFrame> | null = null;
  let timeoutId: ReturnType<typeof setTimeout>            | null = null;

  function flush() {
    if (pending) {
      onFlush(pending);
      pending = "";
    }
    rafId     = null;
    timeoutId = null;
  }

  function schedule() {
    if (typeof document !== "undefined" && document.hidden) {
      // Tab hidden: rAF doesn't fire — use 1 s timeout fallback
      if (timeoutId === null) {
        timeoutId = setTimeout(flush, 1000);
      }
    } else {
      // Tab visible: cancel any pending timeout, use rAF
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (rafId === null) {
        rafId = requestAnimationFrame(flush);
      }
    }
  }

  return {
    push(chunk: string) {
      pending += chunk;
      schedule();
    },
    flushNow() {
      if (rafId     !== null) { cancelAnimationFrame(rafId); rafId     = null; }
      if (timeoutId !== null) { clearTimeout(timeoutId);     timeoutId = null; }
      flush();
    },
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function streamChat({
  messages,
  onChunk,
  onDone,
  onError,
  signal,
  modelOverride,
  temperatureOverride,
}: StreamChatOptions): Promise<void> {
  const settings = loadSettings();
  const { apiKeys, systemPrompt, temperature, maxTokens, inputLang, outputLang } = settings;

  const model = modelOverride ?? settings.selectedModel;
  const temp  = temperatureOverride !== undefined ? temperatureOverride : temperature;

  const provider = getProvider(model);
  if (!provider) {
    onError("Unknown model. Please select a model in Settings → Models.");
    return;
  }

  // inputLang: inject translation hint on last user message
  let processedMessages = messages;
  if (inputLang !== "auto" && messages.length > 0) {
    const langName: Record<string, string> = { en: "English", ko: "Korean" };
    const target = langName[inputLang] ?? inputLang;
    processedMessages = messages.map((m, i) =>
      m.role === "user" && i === messages.length - 1
        ? { ...m, content: `[Respond in ${target}, interpreting intent regardless of input language]: ${m.content}` }
        : m
    );
  }

  const sysPrompt = buildSystemPrompt(systemPrompt, outputLang);

  try {
    const res = await fetch("/api/chat", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model,
        messages:     processedMessages,
        sysPrompt:    sysPrompt || undefined,
        temperature:  temp,
        maxTokens,
        clientApiKey: apiKeys[provider as keyof typeof apiKeys] ?? "",
      }),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      onError(err?.error ?? `API error ${res.status}`);
      return;
    }

    // ── SSE parsing with RAF batching ─────────────────────────────────────────
    const reader  = res.body!.getReader();
    const decoder = new TextDecoder();
    const batcher = createChunkBatcher(onChunk);
    let buf             = "";
    let contentStarted  = false; // Skip leading \n (matches Open WebUI behavior)

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.replace(/^data: /, "").trim();
        if (!trimmed || trimmed === "[DONE]") continue;
        try {
          const json = JSON.parse(trimmed) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta === undefined || delta === null) continue;
          // Skip a leading newline before any real content has arrived
          if (!contentStarted && delta === "\n") continue;
          contentStarted = true;
          batcher.push(delta);
        } catch { /* skip malformed */ }
      }
    }

    // Flush any remaining buffered text before calling onDone
    batcher.flushNow();
    onDone();
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      onDone();
    } else {
      onError((err as Error).message ?? "Unknown error");
    }
  }
}
