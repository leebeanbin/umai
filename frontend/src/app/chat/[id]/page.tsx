"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Clock, BookmarkPlus } from "lucide-react";
import ChatNavbar from "@/components/chat/ChatNavbar";
import MessageList from "@/components/chat/MessageList";
import MessageInput from "@/components/chat/MessageInput";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useChat, type Message } from "@/lib/hooks/useChat";
import { useChatSocket } from "@/lib/hooks/useWebSocket";
import { createSession, updateSessionTitle } from "@/lib/store";
import { loadSettings } from "@/lib/appStore";
import { apiGenerateChatTitle, getStoredToken } from "@/lib/api/backendClient";

type AttachedImage = { id: string; dataUrl: string; name: string };

export default function ChatSession() {
  const { id }  = useParams<{ id: string }>();
  const { t }   = useLanguage();
  const {
    messages, setMessages, generating,
    send, stop, editMessage, regenerate,
  } = useChat(id);

  // DB에서 채팅 히스토리 로드 (페이지 마운트 시 1회)
  useEffect(() => {
    if (!id) return;
    const token = getStoredToken();
    if (!token) return;
    fetch(`/api/v1/chats/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.messages?.length) return;
        const dbMsgs: Message[] = data.messages.map((m: {
          id: string; role: "user" | "assistant"; content: string;
          images?: string[] | null; created_at: string;
        }) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          images: m.images ?? undefined,
          createdAt: new Date(m.created_at),
        }));
        // DB 메시지가 localStorage보다 많으면 DB 우선
        if (dbMsgs.length > messages.length) {
          setMessages(dbMsgs);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // WebSocket 연결 — messages_saved 등 실시간 이벤트 수신
  useChatSocket(id, (event) => {
    if (event.type === "messages_saved") {
      // DB 저장 완료 확인 — 필요 시 추가 동작 (예: 저장 인디케이터 숨김)
    }
  });

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

  // 첫 번째 응답 완료 후 → Ollama 경량 모델로 제목 생성 (백엔드 위임)
  useEffect(() => {
    if (generating || titleGenerated.current) return;

    const userMsg = messages.find((m) => m.role === "user"      && !m.error);
    const asstMsg = messages.find((m) => m.role === "assistant" && !m.streaming && !m.error && m.content.length > 0);
    if (!userMsg || !asstMsg) return;

    titleGenerated.current = true;

    // 백엔드가 Ollama를 호출해 제목을 생성하고 DB에 저장한다.
    // 성공 시 반환된 title로 사이드바를 즉시 갱신 (추가 GET 불필요).
    // 실패(Ollama 미실행 등)는 조용히 무시 — 기본 제목 "새 채팅" 유지.
    const { language, outputLang } = loadSettings();
    const titleLang = outputLang !== "auto" ? outputLang : language;
    apiGenerateChatTitle(id, userMsg.content, asstMsg.content, titleLang)
      .then((title) => {
        if (title) updateSessionTitle(id, title, false); // DB는 이미 저장됨
      })
      .catch(() => { /* Ollama 오류 — 기본 제목 유지 */ });
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

  const handleSend = useCallback((content: string, images: AttachedImage[], webSearch?: boolean, docContext?: string, useRag?: boolean) => {
    send(content, images.map((i) => i.dataUrl), { webSearch, docContext, useRag });
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
            chatId={id}
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
