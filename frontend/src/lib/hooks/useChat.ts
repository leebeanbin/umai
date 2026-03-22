"use client";

import { useCallback, useRef, useState } from "react";
import { streamChat, type ChatMessage } from "@/lib/apis/chat";
import { loadSettings } from "@/lib/appStore";
import { getModelCapabilities } from "@/lib/modelCapabilities";
import { getStoredToken, isAuthenticated } from "@/lib/api/backendClient";

export type SearchSource = { title: string; snippet: string; url: string };

// Canonical Message type
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  sources?: SearchSource[];  // Web search citation sources
  createdAt: Date;
  streaming?: boolean;
  error?: string;
};

type SendOpts = {
  model?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
  webSearch?: boolean;
  docContext?: string;  // Extracted document text to inject as context
  useRag?: boolean;     // Search user's knowledge base before responding
};

// ── Language-aware context instructions ──────────────────────────────────────
//
// outputLang이 "auto"가 아닐 때는 그 값을 사용하고,
// "auto"이면 UI 언어(settings.language)로 fallback한다.
// 모든 컨텍스트 주입(document / RAG / OCR / web search) 지시문을
// 응답 언어에 맞게 동적으로 선택해 AI가 일관된 언어로 응답하도록 유도한다.

function effectiveLang(outputLang: string, uiLang: string): string {
  return outputLang !== "auto" ? outputLang : uiLang;
}

const CTX_INSTRUCTIONS = {
  document: {
    en: "Use the above document content to answer the user's question accurately.",
    ko: "위의 문서 내용을 바탕으로 사용자 질문에 정확히 답변하세요.",
  },
  rag: {
    en: "Use the above retrieved knowledge to inform your answer when relevant.",
    ko: "위의 검색된 지식을 참고하여 관련된 내용으로 답변하세요.",
  },
  ocr: {
    en: "The above text was extracted from an image the user attached.",
    ko: "위의 텍스트는 사용자가 첨부한 이미지에서 추출된 내용입니다.",
  },
  webSearch: {
    en: "Answer using these results. Cite sources inline with [1], [2], etc. notation where relevant.",
    ko: "위 검색 결과를 바탕으로 답변하세요. 관련 내용에는 [1], [2] 등 인라인 인용을 사용하세요.",
  },
} as const satisfies Record<string, Record<string, string>>;

type CtxKey = keyof typeof CTX_INSTRUCTIONS;

function ctxMsg(type: CtxKey, lang: string): string {
  const map = CTX_INSTRUCTIONS[type] as Record<string, string>;
  return map[lang] ?? map["en"];
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function msgStorageKey(chatId: string) { return `umai_msgs_${chatId}`; }

function loadMessages(chatId: string): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(msgStorageKey(chatId));
    if (!raw) return [];
    return (JSON.parse(raw) as Array<Message & { createdAt: string }>).map((m) => ({
      ...m,
      createdAt: new Date(m.createdAt),
    }));
  } catch { return []; }
}

/** localStorage 저장: 스트리밍 중인 메시지와 greeting은 제외 */
function saveMessages(chatId: string, messages: Message[]) {
  if (typeof window === "undefined") return;
  const saveable = messages.filter((m) => !m.streaming && !m.error && m.id !== "greeting");
  localStorage.setItem(msgStorageKey(chatId), JSON.stringify(saveable));
}

/** 백엔드 DB에 완성된 메시지 저장 (fire-and-forget, 실패해도 무시) */
async function persistToDb(chatId: string, messages: Message[]) {
  if (!isAuthenticated()) return; // 미인증 시 skip
  const token = getStoredToken();

  const saveable = messages.filter((m) => !m.streaming && !m.error && m.id !== "greeting");
  // 최근 두 메시지만 저장 (user + assistant 쌍)
  const toSave = saveable.slice(-2);
  for (const m of toSave) {
    // Relative path — Next.js rewrite proxies /api/* to backend
    fetch(`/api/v1/chats/${chatId}/messages`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: m.role, content: m.content, images: m.images }),
    }).catch(() => {}); // 실패 무시
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useChat(chatId?: string) {
  const [messages, setMessages]     = useState<Message[]>(() =>
    chatId ? loadMessages(chatId) : []
  );
  const [generating, setGenerating] = useState(false);
  const msgRef   = useRef<Message[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // ── 내부 상태 업데이트 ────────────────────────────────────────────────────
  // persistNow: true → localStorage 즉시 저장 (스트리밍 완료, 편집 등)
  //             false → 저장 안 함 (스트리밍 중 RAF 배치 업데이트)
  const push = useCallback(
    (updater: (prev: Message[]) => Message[], persistNow = false) => {
      setMessages((prev) => {
        const next = updater(prev);
        msgRef.current = next;
        if (chatId && persistNow) saveMessages(chatId, next);
        return next;
      });
    },
    [chatId]
  );

  const addMessage = useCallback((msg: Message) => {
    push((prev) => [...prev, msg], true);
  }, [push]);

  // ── Core send ─────────────────────────────────────────────────────────────
  const send = useCallback(
    async (content: string, images: string[] = [], opts?: SendOpts) => {
      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();

      const settings = loadSettings();
      const modelId = opts?.model ?? settings.selectedModel;
      const caps = getModelCapabilities(modelId);
      // 응답 언어: outputLang이 강제 설정된 경우 우선, 아니면 UI 언어
      const lang = effectiveLang(settings.outputLang, settings.language);

      const apiMsgs: ChatMessage[] = [];
      if (settings.systemPrompt) apiMsgs.push({ role: "system", content: settings.systemPrompt });

      // History — include images only for vision-capable models
      msgRef.current
        .filter((m) => m.id !== "greeting" && !m.streaming && !m.error)
        .forEach((m) => apiMsgs.push({
          role: m.role,
          content: m.content,
          images: (m.role === "user" && caps.vision && m.images?.length) ? m.images : undefined,
        }));

      // ── [1] Document context ─────────────────────────────────────────────────
      if (opts?.docContext) {
        apiMsgs.push({
          role: "system",
          content: `[Document Context]\n${opts.docContext}\n\n${ctxMsg("document", lang)}`,
        });
      }

      // ── [2] RAG: Knowledge Base search ───────────────────────────────────────
      if (opts?.useRag && content.trim()) {
        try {
            const ragToken = getStoredToken();
          const r = await fetch(
            `/api/v1/rag/search?q=${encodeURIComponent(content)}&top_k=5`,
            {
              credentials: "include",
              headers: ragToken ? { Authorization: `Bearer ${ragToken}` } : {},
              signal: AbortSignal.timeout(10_000),
            }
          );
          if (r.ok) {
            const { results } = await r.json() as {
              results: { chunk: string; source: string; score: number }[];
            };
            if (results.length > 0) {
              const context = results
                .map((item, i) => `[KB${i + 1}] (${item.source})\n${item.chunk}`)
                .join("\n\n---\n\n");
              apiMsgs.push({
                role: "system",
                content: `[Knowledge Base]\n${context}\n\n${ctxMsg("rag", lang)}`,
              });
            }
          }
        } catch { /* RAG failure is non-fatal */ }
      }

      // ── [3] OCR fallback: extract text from images when model lacks vision ───
      if (images.length > 0 && !caps.vision) {
        for (const img of images) {
          try {
            const r = await fetch("/api/ocr", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image: img }),
              signal: AbortSignal.timeout(30_000),
            });
            if (r.ok) {
              const { text } = await r.json() as { text: string };
              if (text.trim()) {
                apiMsgs.push({
                  role: "system",
                  content: `[Image OCR Text]\n${text.trim()}\n\n${ctxMsg("ocr", lang)}`,
                });
              }
            }
          } catch { /* OCR failure is non-fatal */ }
        }
      }

      // ── [4] Web search (Tavily) ───────────────────────────────────────────────
      let searchSources: SearchSource[] = [];
      if (opts?.webSearch) {
        try {
          const r = await fetch(`/api/websearch?q=${encodeURIComponent(content)}`, { signal: AbortSignal.timeout(8000) });
          if (r.ok) {
            const { results } = await r.json() as { results: SearchSource[] };
            if (results.length > 0) {
              searchSources = results;
              const searchContext = results
                .map((s, i) => `[${i + 1}] ${s.title ? s.title + ': ' : ''}${s.snippet} (${s.url})`)
                .join('\n');
              apiMsgs.push({
                role: "system",
                content: `[Web Search Results for: "${content}"]\n${searchContext}\n\n${ctxMsg("webSearch", lang)}`,
              });
            }
          }
        } catch { /* timeout or fail — continue without search */ }
      }

      // ── [5] User message (with vision images if supported) ───────────────────
      apiMsgs.push({
        role: "user",
        content,
        images: (images.length > 0 && caps.vision) ? images : undefined,
      });

      // UI에 유저 메시지 + 빈 스트리밍 메시지 추가
      push((prev) => [
        ...prev,
        { id: userId, role: "user",      content, images, createdAt: new Date() },
        { id: asstId, role: "assistant", content: "", streaming: true,
          sources: searchSources.length > 0 ? searchSources : undefined,
          createdAt: new Date() },
      ], false); // 스트리밍 시작 시 localStorage 저장 안 함

      setGenerating(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      await streamChat({
        messages:            apiMsgs,
        signal:              ctrl.signal,
        modelOverride:       opts?.model,
        temperatureOverride: opts?.temperature ?? undefined,
        maxTokensOverride:   opts?.maxTokens,
        topPOverride:        opts?.topP,

        // RAF 배치로 이미 묶인 텍스트 → localStorage 저장 없이 state만 업데이트
        onChunk: (chunk) =>
          push(
            (prev) => prev.map((m) => m.id === asstId ? { ...m, content: m.content + chunk } : m),
            false // ← 스트리밍 중 localStorage 쓰기 금지
          ),

        // 완료: localStorage 1회 저장 + DB 저장 (fire-and-forget)
        onDone: () => {
          push(
            (prev) => prev.map((m) => m.id === asstId ? { ...m, streaming: false } : m),
            true  // ← 완료 시 localStorage 1회 저장
          );
          setGenerating(false);
          abortRef.current = null;
          if (chatId) persistToDb(chatId, msgRef.current);
        },

        onError: (err) => {
          push(
            (prev) => prev.map((m) =>
              m.id === asstId ? { ...m, streaming: false, content: "", error: err } : m
            ),
            false // 에러 메시지는 localStorage에 저장 안 함
          );
          setGenerating(false);
          abortRef.current = null;
        },
      });
    },
    [chatId, push]
  );

  // ── Actions ───────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
    push(
      (prev) => prev.map((m) => m.streaming ? { ...m, streaming: false } : m),
      true // 중지 시 현재 상태 저장
    );
  }, [push]);

  const editMessage = useCallback((id: string, content: string) => {
    push((prev) => prev.map((m) => m.id === id ? { ...m, content } : m), true);
  }, [push]);

  const regenerate = useCallback((messageId: string) => {
    const snap = msgRef.current;
    const idx  = snap.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const userMsg = snap.slice(0, idx).reverse().find((m) => m.role === "user");
    if (!userMsg) return;
    push((prev) => prev.filter((m) => m.id !== messageId), false);
    send(userMsg.content, []);
  }, [push, send]);

  const clear = useCallback(() => {
    setMessages([]);
    msgRef.current = [];
    if (chatId) localStorage.removeItem(msgStorageKey(chatId));
  }, [chatId]);

  return { messages, generating, msgRef, push, addMessage, send, stop, editMessage, regenerate, clear };
}
