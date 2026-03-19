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

type AttachedImage = { id: string; dataUrl: string; name: string };

export default function ChatSession() {
  const { id }  = useParams<{ id: string }>();
  const { t }   = useLanguage();
  const {
    messages, generating,
    msgRef, push,
    send, stop, editMessage, regenerate,
  } = useChat(id);

  const [isTemp,    setIsTemp]    = useState(false);
  const [tempSaved, setTempSaved] = useState(false);
  const started        = useRef(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount: 세션 등록 + greeting + auto-send pending prompt
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // 기존 메시지가 없는 새 채팅만 초기화
    const isNew = messages.length === 0;

    if (isNew) {
      const greeting = {
        id: "greeting", role: "assistant" as const,
        content: t("chat.greeting"), createdAt: new Date(),
      };
      push(() => [greeting]);
    }

    // 세션이 존재하지 않으면 sidebar에 추가
    createSession(id, isNew ? t("chat.newSession") : messages[0]?.content?.slice(0, 40) || t("chat.newSession"), "chat");

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

  // 첫 번째 유저 메시지를 세션 제목으로 업데이트
  useEffect(() => {
    const firstUser = messages.find((m) => m.role === "user" && m.id !== "greeting");
    if (firstUser) {
      const title = firstUser.content.slice(0, 50);
      updateSessionTitle(id, title);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.find((m) => m.role === "user")?.id]);

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
      <ChatNavbar />

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
          <div className="h-full flex items-center justify-center text-sm text-text-muted">
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
