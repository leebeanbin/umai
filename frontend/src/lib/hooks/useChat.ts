"use client";

import { useCallback, useRef, useState } from "react";
import { streamChat, type ChatMessage } from "@/lib/apis/chat";
import { loadSettings } from "@/lib/appStore";

// Canonical Message type
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  createdAt: Date;
  streaming?: boolean;
  error?: string;
};

type SendOpts = {
  model?: string;
  temperature?: number | null;
};

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
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return; // 백엔드 URL 미설정 시 skip
  const token = typeof window !== "undefined" ? localStorage.getItem("umai_access_token") : null;
  if (!token) return; // 미인증 시 skip

  const saveable = messages.filter((m) => !m.streaming && !m.error && m.id !== "greeting");
  // 최근 두 메시지만 저장 (user + assistant 쌍)
  const toSave = saveable.slice(-2);
  for (const m of toSave) {
    fetch(`${apiUrl}/api/v1/chats/${chatId}/messages`, {
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
      const apiMsgs: ChatMessage[] = [];
      if (settings.systemPrompt) apiMsgs.push({ role: "system", content: settings.systemPrompt });

      msgRef.current
        .filter((m) => m.id !== "greeting" && !m.streaming && !m.error)
        .forEach((m) => apiMsgs.push({ role: m.role, content: m.content }));
      apiMsgs.push({ role: "user", content });

      // UI에 유저 메시지 + 빈 스트리밍 메시지 추가
      push((prev) => [
        ...prev,
        { id: userId, role: "user",      content, images, createdAt: new Date() },
        { id: asstId, role: "assistant", content: "", streaming: true, createdAt: new Date() },
      ], false); // 스트리밍 시작 시 localStorage 저장 안 함

      setGenerating(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      await streamChat({
        messages:            apiMsgs,
        signal:              ctrl.signal,
        modelOverride:       opts?.model,
        temperatureOverride: opts?.temperature ?? undefined,

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
