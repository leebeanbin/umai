"use client";

import { useCallback, useRef, useState } from "react";
import { streamChat, type ChatMessage } from "@/lib/apis/chat";
import { loadSettings } from "@/lib/appStore";
import { getModelCapabilities } from "@/lib/modelCapabilities";
import { apiFetch, isAuthenticated, apiEnqueueAgentTask } from "@/lib/api/backendClient";
import { loadWs } from "@/lib/workspaceStore";

/** Custom model의 systemPrompt를 가져온다. 없으면 undefined. */
function getCustomModelSystemPrompt(modelId: string): string | undefined {
  try {
    const items = loadWs<{ id: string; baseModel: string; systemPrompt: string }>("custom-models", []);
    const match = items.find((m) => m.id === modelId || m.baseModel === modelId);
    return match?.systemPrompt || undefined;
  } catch { return undefined; }
}

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

/** localStorage 저장: 스트리밍 중인 메시지와 greeting은 제외. 최근 50개로 제한 */
function saveMessages(chatId: string, messages: Message[]) {
  if (typeof window === "undefined") return;
  const saveable = messages
    .filter((m) => !m.streaming && !m.error && m.id !== "greeting")
    .slice(-50); // 최근 50개만 유지
  localStorage.setItem(msgStorageKey(chatId), JSON.stringify(saveable));
}

// LLM 프로바이더 추론 (모델명 기반)
// Celery run_agent 태스크에서 사용 — 백엔드 _call_llm() provider 인자와 매핑
export function inferProvider(model: string): "openai" | "anthropic" | "google" | "xai" | "ollama" {
  if (/^(gpt-|o1|o3|o4|chatgpt)/i.test(model)) return "openai";
  if (/^claude-/i.test(model)) return "anthropic";
  if (/^gemini/i.test(model)) return "google";
  if (/^grok/i.test(model)) return "xai";
  return "ollama";
}

/**
 * 스트리밍 완료 후 user+assistant 쌍을 Celery write-back 배치 엔드포인트로 저장.
 * - 즉시 202 반환 → WS messages_saved 이벤트로 완료 확인
 * - 실패해도 localStorage에는 존재하므로 non-fatal
 */
export async function saveToDb(chatId: string, userMsg: Message, asstMsg: Message) {
  if (!isAuthenticated()) return;
  const messages = [
    { id: userMsg.id, role: userMsg.role, content: userMsg.content, images: userMsg.images ?? null },
    { id: asstMsg.id, role: asstMsg.role, content: asstMsg.content, images: null },
  ];
  apiFetch(`/api/v1/chats/${chatId}/messages/batch`, {
    method: "POST",
    body: JSON.stringify({ messages }),
  }).catch((e) => { console.error("saveToDb failed:", e); });
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
      // Custom model의 systemPrompt가 있으면 글로벌 설정보다 우선 적용
      const customSysPrompt = getCustomModelSystemPrompt(modelId);
      const effectiveSysPrompt = customSysPrompt ?? settings.systemPrompt;
      if (effectiveSysPrompt) apiMsgs.push({ role: "system", content: effectiveSysPrompt });

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
          const body = await apiFetch<{ results?: { chunk: string; source: string; score: number }[] }>(
            `/api/v1/rag/search?q=${encodeURIComponent(content)}&top_k=5`,
            { signal: AbortSignal.timeout(10_000) },
          );
          const results = Array.isArray(body.results) ? body.results : [];
          if (results.length > 0) {
            const context = results
              .map((item, i) => `[KB${i + 1}] (${item.source})\n${item.chunk}`)
              .join("\n\n---\n\n");
            apiMsgs.push({
              role: "system",
              content: `[Knowledge Base]\n${context}\n\n${ctxMsg("rag", lang)}`,
            });
          }
        } catch { /* RAG failure is non-fatal */ }
      }

      // ── [3] OCR fallback: extract text from images when model lacks vision ───
      if (images.length > 0 && !caps.vision) {
        for (const img of images) {
          try {
            const { text } = await apiFetch<{ text: string }>("/api/ocr", {
              method: "POST",
              body: JSON.stringify({ image: img }),
              signal: AbortSignal.timeout(30_000),
            });
            if (text.trim()) {
              apiMsgs.push({
                role: "system",
                content: `[Image OCR Text]\n${text.trim()}\n\n${ctxMsg("ocr", lang)}`,
              });
            }
          } catch { /* OCR failure is non-fatal */ }
        }
      }

      // ── [4] Web search (Tavily) ───────────────────────────────────────────────
      let searchSources: SearchSource[] = [];
      if (opts?.webSearch) {
        try {
          const wsBody = await apiFetch<{ results?: SearchSource[] }>(
            `/api/websearch?q=${encodeURIComponent(content)}`,
            { signal: AbortSignal.timeout(8000) },
          );
          const results = Array.isArray(wsBody.results) ? wsBody.results : [];
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

        // 완료: localStorage 1회 저장 + DB 배치 저장
        onDone: () => {
          // push의 updater 내부에서 최신 prev를 이용해 메시지를 가져옴.
          // setMessages updater는 항상 최신 state를 받으므로
          // push() 직후 msgRef.current 접근 시 streaming=false 반영 전 race 방지.
          let _userMsg: Message | undefined;
          let _asstMsg: Message | undefined;
          push((prev) => {
            const next = prev.map((m) =>
              m.id === asstId ? { ...m, streaming: false } : m
            );
            _userMsg = next.find((m) => m.id === userId);
            _asstMsg = next.find((m) => m.id === asstId);
            return next;
          }, true);
          setGenerating(false);
          abortRef.current = null;
          if (chatId && _userMsg && _asstMsg) {
            saveToDb(chatId, _userMsg, _asstMsg);
          }
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
    // Abort any in-flight generation
    abortRef.current?.abort();
    const snap = msgRef.current;
    const idx = snap.findIndex((m) => m.id === id);
    if (idx < 0) return;
    // Truncate messages at the edited user message (drop it and everything after)
    push((prev) => prev.slice(0, idx), false);
    // Re-send from the edited content
    send(content, []);
  }, [push, send, abortRef]);

  const regenerate = useCallback((messageId: string) => {
    // abort any in-flight generation before starting a new one
    abortRef.current?.abort();
    const snap = msgRef.current;
    const idx  = snap.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const userMsg = snap.slice(0, idx).reverse().find((m) => m.role === "user");
    if (!userMsg) return;
    push((prev) => prev.filter((m) => m.id !== messageId), false);
    send(userMsg.content, []);
  }, [push, send, abortRef]);

  const clear = useCallback(() => {
    setMessages([]);
    msgRef.current = [];
    if (chatId) localStorage.removeItem(msgStorageKey(chatId));
  }, [chatId]);

  // ── Agent 전송 (Celery run_agent 태스크) ───────────────────────────────────
  // 반환: { taskId, thinkingId, userId } — 호출자가 useTaskSocket으로 완료 대기
  const sendAsAgent = useCallback(async (
    content: string,
    enabledTools: string[],
  ): Promise<{ taskId: string; thinkingId: string; userId: string } | null> => {
    const settings = loadSettings();
    const userId     = crypto.randomUUID();
    const thinkingId = crypto.randomUUID();

    const apiMsgs = [
      ...(settings.systemPrompt ? [{ role: "system" as const, content: settings.systemPrompt }] : []),
      ...msgRef.current
        .filter((m) => m.id !== "greeting" && !m.streaming && !m.error)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content },
    ];

    push((prev) => [
      ...prev,
      { id: userId,     role: "user",      content,  createdAt: new Date() },
      { id: thinkingId, role: "assistant",  content: "...", streaming: true, createdAt: new Date() },
    ], false);
    setGenerating(true);

    try {
      const task = await apiEnqueueAgentTask({
        messages:      apiMsgs,
        model:         settings.selectedModel,
        provider:      inferProvider(settings.selectedModel),
        enabled_tools: enabledTools,
        chat_id:       chatId,
      });
      return { taskId: task.task_id, thinkingId, userId };
    } catch {
      push((prev) => prev.map((m) =>
        m.id === thinkingId ? { ...m, content: "", streaming: false, error: "태스크 전송 실패" } : m
      ), false);
      setGenerating(false);
      return null;
    }
  }, [chatId, push, msgRef]);

  return { messages, setMessages, generating, setGenerating, msgRef, push, addMessage, send, stop, editMessage, regenerate, clear, sendAsAgent };
}
