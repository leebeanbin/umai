"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Clock, BookmarkPlus } from "lucide-react";
import ChatNavbar from "@/components/chat/ChatNavbar";
import MessageList from "@/components/chat/MessageList";
import MessageInput from "@/components/chat/MessageInput";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useChat, saveToDb, type Message } from "@/lib/hooks/useChat";
import { useChatSocket, useTaskSocket } from "@/lib/hooks/useWebSocket";
import { createSession, updateSessionTitle } from "@/lib/store";
import { loadSettings } from "@/lib/appStore";
import { apiFetch, apiGenerateChatTitle, apiGetTask } from "@/lib/api/backendClient";
import { apiCreateDataset } from "@/lib/api/fineTuneClient";

// ── Intent 분석 — 도구가 필요한 질문인지 판단 ────────────────────────────────
function analyzeIntent(content: string): { useAgent: boolean; tools: string[] } {
  const tools: string[] = [];
  if (/검색|찾아|최신|뉴스|오늘.*뭐|지금.*어때|어디서|현재.*알려줘|search|find|latest|current/i.test(content))
    tools.push("web_search");
  if (/계산|실행해|코드 짜|파이썬|python|수식|compute|calculate|run this|execute/i.test(content))
    tools.push("execute_python");
  if (/문서에서|자료에서|업로드한|내 파일|내 자료|knowledge base/i.test(content))
    tools.push("knowledge_search");
  return { useAgent: tools.length > 0, tools };
}

type AttachedImage = { id: string; dataUrl: string; name: string };

export default function ChatSession() {
  const { id }  = useParams<{ id: string }>();
  const { t }   = useLanguage();
  const {
    messages, setMessages, generating, setGenerating,
    msgRef, push, send, stop, editMessage, regenerate, sendAsAgent,
  } = useChat(id);

  // DB에서 채팅 히스토리 로드 (페이지 마운트 시 1회)
  useEffect(() => {
    if (!id) return;
    apiFetch<{ messages: { id: string; role: "user" | "assistant"; content: string; images?: string[] | null; created_at: string }[] }>(`/api/v1/chats/${id}`)
      .then((data) => {
        if (!data?.messages?.length) return;
        const dbMsgs: Message[] = data.messages.map((m) => ({
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

  // Agent 태스크 완료 대기 Map: taskId → { thinkingId, userId }
  const pendingAgentTasks = useRef<Map<string, { thinkingId: string; userId: string }>>(new Map());

  useTaskSocket(async (taskId: string) => {
    const pending = pendingAgentTasks.current.get(taskId);
    if (!pending) return;
    pendingAgentTasks.current.delete(taskId);
    try {
      const t = await apiGetTask(taskId);
      const result = t.result as { content?: string; steps?: number } | null;
      const content = result?.content ?? "";
      push((prev) => prev.map((m) =>
        m.id === pending.thinkingId
          ? { ...m, content, streaming: false }
          : m
      ), true);
      const userMsg = msgRef.current.find((m) => m.id === pending.userId);
      const asstMsg = msgRef.current.find((m) => m.id === pending.thinkingId);
      if (userMsg && asstMsg) {
        saveToDb(id, userMsg, asstMsg);
        if (ftModeOnRef.current && userMsg.content && asstMsg.content) {
          ftExamples.current.push({ user: userMsg.content, assistant: asstMsg.content });
          setFtCount(ftExamples.current.length);
        }
      }
    } catch {
      push((prev) => prev.map((m) =>
        m.id === pending.thinkingId
          ? { ...m, content: "", streaming: false, error: t("error.agentFailed") }
          : m
      ), false);
    }
    setGenerating(false);
  });

  // ── 파인튜닝 모드 ──────────────────────────────────────────────────────────
  const [ftModeOn, setFtModeOn] = useState(false);
  // ftModeOnRef: useTaskSocket 콜백이 최신 ftModeOn을 참조하기 위한 ref
  // (콜백은 callbackRef.current = fn 으로 매 렌더 갱신되므로 ref 없어도 동작하나,
  //  선언 순서상 ftModeOn이 useTaskSocket 이후에 위치하여 명시적 ref로 안정화)
  const ftModeOnRef = useRef(false);
  useEffect(() => { ftModeOnRef.current = ftModeOn; }, [ftModeOn]);
  // 수집된 예제: [{user: string, assistant: string}]
  const ftExamples = useRef<{ user: string; assistant: string }[]>([]);
  const [ftCount, setFtCount] = useState(0);

  const [isTemp,    setIsTemp]    = useState(false);
  const [tempSaved, setTempSaved] = useState(false);
  const started         = useRef(false);
  const titleGenerated  = useRef(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef      = useRef(true); // unmount 후 타이머 콜백 실행 방지

  // Mount: 세션 사이드바 등록 + pending prompt 자동 전송
  useEffect(() => {
    mountedRef.current = true;
    if (started.current) return;
    started.current = true;

    createSession(id, t("chat.newSession"), "chat");

    const pending = sessionStorage.getItem("umai_pending_prompt");
    if (pending) {
      sessionStorage.removeItem("umai_pending_prompt");
      pendingTimerRef.current = setTimeout(() => {
        if (mountedRef.current) send(pending, []);
      }, 200);
    }

    if (sessionStorage.getItem("umai_temp_chat") === "1") {
      sessionStorage.removeItem("umai_temp_chat");
      setIsTemp(true);
    }

    return () => {
      mountedRef.current = false;
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 파인튜닝 모드: 스트리밍 완료 시 예제 수집 ─────────────────────────────
  const lastFtMsgCount = useRef(0);
  useEffect(() => {
    if (generating || !ftModeOn) return;
    // 스트리밍 직후만 실행 (메시지 수가 늘었을 때)
    if (messages.length <= lastFtMsgCount.current) return;
    lastFtMsgCount.current = messages.length;
    // 가장 최근 user+assistant 쌍
    const asstMsg = [...messages].reverse().find((m) => m.role === "assistant" && !m.streaming && !m.error && m.content.length > 0);
    const userMsg = asstMsg
      ? [...messages].reverse().find((m) => m.role === "user" && !m.error)
      : null;
    if (userMsg && asstMsg) {
      const alreadyExists = ftExamples.current.some(
        (ex) => ex.user === userMsg.content && ex.assistant === asstMsg.content,
      );
      if (!alreadyExists) {
        ftExamples.current.push({ user: userMsg.content, assistant: asstMsg.content });
        setFtCount(ftExamples.current.length);
      }
    }
  }, [generating, ftModeOn, messages]);

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

  const handleSend = useCallback(async (
    content: string,
    images: AttachedImage[],
    webSearch?: boolean,
    docContext?: string,
    useRag?: boolean,
  ) => {
    // 이미지 첨부 시 → 항상 스트리밍 (이미지 분석 결과는 docContext에 이미 포함)
    if (images.length > 0) {
      send(content, images.map((i) => i.dataUrl), { webSearch, docContext, useRag });
      return;
    }

    const { useAgent, tools } = analyzeIntent(content);
    if (useAgent) {
      const ids = await sendAsAgent(content, tools);
      if (ids) pendingAgentTasks.current.set(ids.taskId, { thinkingId: ids.thinkingId, userId: ids.userId });
    } else {
      send(content, [], { webSearch, docContext, useRag });
    }
  }, [send, sendAsAgent]);

  const tempSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (tempSavedTimerRef.current) clearTimeout(tempSavedTimerRef.current); }, []);

  const saveTempChat = useCallback(() => {
    setIsTemp(false);
    setTempSaved(true);
    if (tempSavedTimerRef.current) clearTimeout(tempSavedTimerRef.current);
    tempSavedTimerRef.current = setTimeout(() => setTempSaved(false), 2000);
  }, []);

  // ── FT 예제를 데이터셋으로 저장 ──────────────────────────────────────────
  const handleSaveFtExamples = useCallback(async () => {
    const examples = ftExamples.current;
    if (examples.length === 0) return;
    const name = prompt(
      `${examples.length}개의 대화 쌍을 데이터셋으로 저장합니다.\n데이터셋 이름을 입력하세요:`,
      `채팅 수집 ${new Date().toLocaleDateString("ko-KR")}`,
    );
    if (!name) return;
    const rawData = examples
      .map((ex) =>
        JSON.stringify({
          messages: [
            { role: "user",      content: ex.user },
            { role: "assistant", content: ex.assistant },
          ],
        }),
      )
      .join("\n");
    try {
      await apiCreateDataset({ name, format: "chat", raw_data: rawData });
      alert(`✅ "${name}" 데이터셋이 저장되었습니다.\nWorkspace › Fine-tune에서 학습을 시작하세요.`);
      ftExamples.current = [];
      setFtCount(0);
      setFtModeOn(false);
    } catch (e: unknown) {
      alert(`저장 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-base">
      <ChatNavbar
        chatId={id}
        fineTuneModeOn={ftModeOn}
        fineTuneExampleCount={ftCount}
        onToggleFineTuneMode={() => {
          if (ftModeOn && ftCount > 0) {
            if (!confirm(`파인튜닝 모드를 끄면 수집된 ${ftCount}개 예제가 사라집니다. 계속하시겠습니까?`)) return;
            ftExamples.current = [];
            setFtCount(0);
          }
          setFtModeOn((v) => !v);
        }}
        onSaveFineTuneExamples={handleSaveFtExamples}
      />

      {/* Temporary chat indicator */}
      {isTemp && (
        <div className="flex items-center justify-between px-4 py-2 bg-[--color-warning-bg] border-b border-warning/15">
          <div className="flex items-center gap-2 text-xs text-warning">
            <Clock size={12} />
            <span>{t("chat.temp.label")}</span>
            <span className="text-warning/60">· {t("chat.temp.tooltip")}</span>
          </div>
          <button
            onClick={saveTempChat}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-warning/15 border border-warning/25 text-warning hover:bg-warning/25 transition-colors"
          >
            <BookmarkPlus size={11} />
            {tempSaved ? t("chat.temp.saved") : t("chat.temp.save")}
          </button>
        </div>
      )}

      {/* 파인튜닝 모드 배너 */}
      {ftModeOn && (
        <div className="flex items-center justify-between px-4 py-2 bg-accent/6 border-b border-accent/15">
          <div className="flex items-center gap-2 text-xs text-accent">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span>파인튜닝 모드 — 대화가 학습 데이터로 수집됩니다</span>
            {ftCount > 0 && (
              <span className="text-accent/70">({ftCount}개 수집됨)</span>
            )}
          </div>
          {ftCount > 0 && (
            <button
              onClick={handleSaveFtExamples}
              className="text-[11px] px-2.5 py-1 rounded-full bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 transition-colors font-medium"
            >
              데이터셋 저장
            </button>
          )}
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
