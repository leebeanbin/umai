"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Clock, BookmarkPlus } from "lucide-react";
import ChatNavbar from "@/components/chat/ChatNavbar";
import MessageList from "@/components/chat/MessageList";
import MessageInput from "@/components/chat/MessageInput";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useChat } from "@/lib/hooks/useChat";
import { createSession, updateSessionTitle } from "@/lib/store";
import { streamChat } from "@/lib/apis/chat";

type AttachedImage = { id: string; dataUrl: string; name: string };

export default function ChatSession() {
  const { id }  = useParams<{ id: string }>();
  const { t }   = useLanguage();
  const {
    messages, generating,
    send, stop, editMessage, regenerate,
  } = useChat(id);

  const [isTemp,    setIsTemp]    = useState(false);
  const [tempSaved, setTempSaved] = useState(false);
  const started         = useRef(false);
  const titleGenerated  = useRef(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount: 세션 사이드바 등록 + pending prompt 자동 전송
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    createSession(id, t("chat.newSession"), "chat");

    const pending = sessionStorage.getItem("umai_pending_prompt");
    if (pending) {
      sessionStorage.removeItem("umai_pending_prompt");
      pendingTimerRef.current = setTimeout(() => send(pending, []), 200);
    }

    if (sessionStorage.getItem("umai_temp_chat") === "1") {
      sessionStorage.removeItem("umai_temp_chat");
      setIsTemp(true);
    }

    return () => { if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 첫 번째 응답 완료 후 → 로컬 모델로 짧은 제목 스트리밍 생성
  useEffect(() => {
    if (generating || titleGenerated.current) return;

    const userMsg  = messages.find((m) => m.role === "user"      && !m.error);
    const asstMsg  = messages.find((m) => m.role === "assistant" && !m.streaming && !m.error && m.content.length > 0);
    if (!userMsg || !asstMsg) return;

    titleGenerated.current = true;

    const titlePrompt = [
      { role: "user"      as const, content: userMsg.content },
      { role: "assistant" as const, content: asstMsg.content.slice(0, 500) },
      {
        role: "user" as const,
        content:
          "위 대화를 3~6단어의 한국어 제목으로 요약해줘. " +
          "제목만, 따옴표·마침표·설명 없이 짧게.",
      },
    ];

    let built = "";
    streamChat({
      messages: titlePrompt,
      onChunk: (chunk) => {
        built += chunk;
        // 마침표·따옴표 제거 후 실시간 반영 (백엔드 sync 없이)
        const cleaned = built.replace(/["""'''.。]/g, "").trim();
        if (cleaned) updateSessionTitle(id, cleaned, false);
      },
      onDone: () => {
        const final = built.replace(/["""'''.。]/g, "").trim().slice(0, 60);
        if (final) updateSessionTitle(id, final, true); // 최종만 백엔드 sync
      },
      onError: () => {
        // 조용히 실패 — 기본 제목 유지
      },
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, messages.length]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") stop();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        window.location.href = "/chat/new";
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = useCallback((content: string, images: AttachedImage[]) => {
    send(content, images.map((i) => i.dataUrl));
  }, [send]);

  const tempSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (tempSavedTimerRef.current) clearTimeout(tempSavedTimerRef.current); }, []);

  const saveTempChat = useCallback(() => {
    setIsTemp(false);
    setTempSaved(true);
    if (tempSavedTimerRef.current) clearTimeout(tempSavedTimerRef.current);
    tempSavedTimerRef.current = setTimeout(() => setTempSaved(false), 2000);
  }, []);

  return (
    <div className="flex flex-col h-full bg-base">
      <ChatNavbar chatId={id} />

      {/* Temporary chat indicator */}
      {isTemp && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-500/8 border-b border-amber-500/15">
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <Clock size={12} />
            <span>{t("chat.temp.label")}</span>
            <span className="text-amber-400/60">· {t("chat.temp.tooltip")}</span>
          </div>
          <button
            onClick={saveTempChat}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 transition-colors"
          >
            <BookmarkPlus size={11} />
            {tempSaved ? t("chat.temp.saved") : t("chat.temp.save")}
          </button>
        </div>
      )}

      <div className="flex-1 relative min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-text-muted select-none">
            {t("chat.empty")}
          </div>
        ) : (
          <MessageList
            messages={messages}
            onEdit={editMessage}
            onRegenerate={regenerate}
          />
        )}
      </div>

      <MessageInput
        onSend={handleSend}
        onStop={stop}
        generating={generating}
        disabled={false}
      />
    </div>
  );
}
