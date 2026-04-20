"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Copy, RotateCcw, ThumbsUp, ThumbsDown, Pencil, ChevronDown, Check, ExternalLink } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { type TranslationKey } from "@/lib/i18n";
import { apiRateMessage } from "@/lib/api/backendClient";

// Import from canonical location and re-export for backward compatibility
import type { Message, SearchSource } from "@/lib/hooks/useChat";
export type { Message };

type Props = {
  messages: Message[];
  chatId?: string;
  onEdit?: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
};

export default function MessageList({ messages, chatId, onEdit, onRegenerate }: Props) {
  const bottomRef    = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t, lang }  = useLanguage();
  const [autoScroll, setAutoScroll]       = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // 스트리밍 중 새 콘텐츠가 도착할 때만 스크롤 (매 렌더링이 아닌 streaming 상태 변화 시)
  const streamingMsg = messages.find((m) => m.streaming);
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingMsg?.content, messages.length, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom   = distFromBottom < 80;
    setAutoScroll(isNearBottom);
    setShowScrollBtn(!isNearBottom && messages.length > 0);
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const lastMsg = messages[messages.length - 1];
  const streamingDone = lastMsg && !lastMsg.streaming && lastMsg.role === "assistant";

  if (messages.length === 0) return null;

  return (
    <div className="relative flex-1 min-h-0">
      {/* Screen-reader live region for streaming completion */}
      <div role="status" aria-live="polite" aria-atomic="false" className="sr-only">
        {streamingDone ? "응답이 완성되었습니다." : ""}
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        role="feed"
        aria-label="메시지 목록"
        className="h-full overflow-y-auto overflow-x-hidden overscroll-contain flex flex-col px-2.5"
      >
        <div className="w-full max-w-3xl mx-auto py-6 flex flex-col gap-2">
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <MemoUserMessage
                key={msg.id}
                message={msg}
                lang={lang}
                onEdit={onEdit}
                t={t}
              />
            ) : (
              <MemoAssistantMessage
                key={msg.id}
                message={msg}
                chatId={chatId}
                isLast={i === messages.length - 1}
                lang={lang}
                onRegenerate={onRegenerate}
                t={t}
              />
            )
          )}
          <div ref={bottomRef} className="h-4" />
        </div>
      </div>

      {showScrollBtn && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 pointer-events-none flex justify-center">
          <button
            onClick={scrollToBottom}
            className="bg-elevated border border-border/60 p-1.5 rounded-full pointer-events-auto hover:bg-hover transition shadow-lg"
            title={t("msg.scrollDown")}
          >
            <ChevronDown size={16} className="text-text-secondary" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Client-only time display (fixes hydration mismatch) ── */
function ClientTime({ date, lang }: { date: Date; lang: string }) {
  const [time, setTime] = useState("");
  useEffect(() => {
    setTime(date.toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US", { // eslint-disable-line react-hooks/set-state-in-effect
      hour: "2-digit", minute: "2-digit",
    }));
  }, [date, lang]);
  return <>{time}</>;
}

/* ── 유저 메시지 ── */
// onEdit prop을 (messageId, val) 형태로 통일 — MessageList가 id를 래핑하지 않아도 됨
type UserMessageProps = {
  message: Message;
  lang: string;
  onEdit?: (messageId: string, val: string) => void;
  t: (key: TranslationKey) => string;
};

const MemoUserMessage = memo(UserMessage, (prev, next) =>
  prev.message.content === next.message.content &&
  prev.message.id      === next.message.id      &&
  prev.lang            === next.lang             &&
  prev.onEdit          === next.onEdit
);

function UserMessage({ message, lang, onEdit, t }: UserMessageProps) {
  const [copied, setCopied]     = useState(false);
  const [editing, setEditing]   = useState(false);
  const [editVal, setEditVal]   = useState(message.content);
  const editRef                 = useRef<HTMLTextAreaElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current)  clearTimeout(copyTimerRef.current);
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
  }, []);

  function handleCopy() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 800);
    });
  }

  function startEdit() {
    setEditVal(message.content);
    setEditing(true);
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      editRef.current?.focus();
      editRef.current?.select();
    }, 30);
  }

  function commitEdit() {
    if (editVal.trim() && editVal.trim() !== message.content) {
      onEdit?.(message.id, editVal.trim());
    }
    setEditing(false);
  }

  return (
    <div className="flex w-full group justify-end animate-slide-up" id={`message-${message.id}`}>
      <div className="max-w-[90%] flex flex-col items-end gap-1">
        {message.images && message.images.length > 0 && (
          <div className="mb-1 flex flex-col items-end gap-1 w-full">
            <div className="flex gap-2 flex-wrap justify-end">
              {message.images.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt="" loading="lazy" className="max-h-96 rounded-2xl object-cover border border-border" />
              ))}
            </div>
          </div>
        )}

        {editing ? (
          <div className="w-full">
            <textarea
              ref={editRef}
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                if (e.key === "Escape") setEditing(false);
              }}
              rows={3}
              className="w-full px-4 py-2 rounded-2xl bg-elevated border border-accent text-sm text-text-primary outline-none resize-none leading-relaxed"
            />
            <div className="flex justify-end gap-1.5 mt-1.5">
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1 rounded-lg text-xs text-text-secondary hover:bg-hover transition-colors"
              >
                {t("msg.editCancel")}
              </button>
              <button
                onClick={commitEdit}
                className="px-3 py-1 rounded-full text-xs font-medium text-white bg-accent hover:bg-accent-hover transition-colors"
              >
                {t("msg.editSave")}
              </button>
            </div>
          </div>
        ) : (
          message.content && (
            <div className="px-4 py-1.5 rounded-3xl bg-elevated border border-border/30 text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
              {message.content}
            </div>
          )
        )}

        {!editing && (
          <div className="flex items-center gap-1 pr-1">
            {onEdit && (
              <button
                onClick={startEdit}
                title={t("msg.edit")}
                className="invisible group-hover:visible p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg text-text-muted hover:text-text-secondary transition"
              >
                <Pencil size={12} />
              </button>
            )}
            <button
              onClick={handleCopy}
              title={copied ? t("msg.copied") : t("msg.copy")}
              className="invisible group-hover:visible p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg text-text-muted hover:text-text-secondary transition"
            >
              {copied ? <Check size={12} className="text-accent" /> : <Copy size={12} />}
            </button>
            <span className="text-[0.65rem] font-medium text-text-muted invisible group-hover:visible transition" suppressHydrationWarning>
              <ClientTime date={message.createdAt} lang={lang} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 어시스턴트 메시지 ── */
type AssistantMessageProps = {
  message: Message;
  chatId?: string;
  isLast: boolean;
  lang: string;
  onRegenerate?: (messageId: string) => void;
  t: (key: TranslationKey) => string;
};

const MemoAssistantMessage = memo(AssistantMessage, (prev, next) =>
  prev.message.id        === next.message.id        &&
  prev.message.content   === next.message.content   &&
  prev.message.streaming === next.message.streaming &&
  prev.message.error     === next.message.error     &&
  prev.message.sources   === next.message.sources   &&
  prev.isLast            === next.isLast             &&
  prev.lang              === next.lang               &&
  prev.chatId            === next.chatId             &&
  prev.onRegenerate      === next.onRegenerate
);

function AssistantMessage({ message, chatId, isLast, lang, onRegenerate, t }: AssistantMessageProps) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreaming = !!message.streaming;
  const hasError    = !!message.error;

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  function handleCopy() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 800);
    });
  }

  return (
    <div className="flex w-full group animate-slide-up" id={`message-${message.id}`}>
      {/* 아바타 */}
      <div className="shrink-0 mr-3 mt-1 flex">
        <div className="size-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-xs font-bold text-accent">
          U
        </div>
      </div>

      <div className="flex-auto w-0 pl-1 relative">
        {/* 이름 + 타임스탬프 */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-text-primary">Umai</span>
          <span className="text-[0.65rem] font-medium text-text-muted invisible group-hover:visible transition" suppressHydrationWarning>
            <ClientTime date={message.createdAt} lang={lang} />
          </span>
        </div>

        {/* 이미지 결과물 */}
        {message.images && message.images.length > 0 && (
          <div className="my-1 w-full flex overflow-x-auto gap-2 flex-wrap mb-3">
            {message.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={`result ${i + 1}`}
                loading="lazy"
                className="h-40 rounded-2xl object-cover border border-border cursor-pointer hover:border-accent/50 transition-colors"
              />
            ))}
          </div>
        )}

        {/* 스트리밍 / 에러 / 본문 */}
        {isStreaming && !message.content && (
          <div className="flex gap-1 mt-1 mb-0.5">
            <span className="size-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:0ms]" />
            <span className="size-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:120ms]" />
            <span className="size-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:240ms]" />
          </div>
        )}
        {hasError && (
          <ErrorBubble error={message.error!} onRetry={onRegenerate ? () => onRegenerate(message.id) : undefined} t={t} />
        )}
        {!hasError && message.content && (
          <>
            <MarkdownRenderer content={message.content} sources={message.sources} />
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-text-primary rounded animate-pulse ml-0.5 align-middle" />
            )}
          </>
        )}

        {/* Citation sources — shown after streaming completes */}
        {!isStreaming && !hasError && message.sources && message.sources.length > 0 && (
          <CitationList sources={message.sources} />
        )}

        {/* 액션 버튼 */}
        <div className={`flex justify-start mt-1.5 text-text-muted gap-0.5 transition-opacity ${isLast ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          <button
            onClick={handleCopy}
            title={copied ? t("msg.copied") : t("msg.copy")}
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg hover:text-text-primary transition"
          >
            {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
          </button>

          {onRegenerate && (
            <button
              onClick={() => onRegenerate(message.id)}
              title={t("msg.regenerate")}
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg hover:text-text-primary transition"
            >
              <RotateCcw size={14} />
            </button>
          )}

          <button
            onClick={() => {
              const prev = rating;
              const next = rating === "up" ? null : "up";
              setRating(next);
              if (chatId) apiRateMessage(chatId, message.id, next ? "positive" : null).catch(() => {
                setRating(prev); // rollback on failure
              });
            }}
            title={t("msg.like")}
            className={`p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg hover:text-text-primary transition ${rating === "up" ? "text-accent" : ""}`}
          >
            <ThumbsUp size={14} />
          </button>
          <button
            onClick={() => {
              const prev = rating;
              const next = rating === "down" ? null : "down";
              setRating(next);
              if (chatId) apiRateMessage(chatId, message.id, next ? "negative" : null).catch(() => {
                setRating(prev); // rollback on failure
              });
            }}
            title={t("msg.dislike")}
            className={`p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg hover:text-text-primary transition ${rating === "down" ? "text-danger" : ""}`}
          >
            <ThumbsDown size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 에러 버블 ── */
function ErrorBubble({ error, onRetry, t }: { error: string; onRetry?: () => void; t: (k: TranslationKey) => string }) {
  const isNoKey = error.startsWith("__NO_KEY__:");
  const provider = isNoKey ? error.split(":")[1] : null;

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 rounded-xl bg-danger/5 border border-danger/20 text-xs mt-1">
      <div className="flex items-start gap-2">
        <span className="text-danger font-bold shrink-0 mt-0.5">!</span>
        <div className="flex-1">
          {isNoKey ? (
            <span className="text-text-secondary">
              {provider && <strong className="capitalize">{provider}</strong>} API key not set.{" "}
              <span className="text-text-muted">{t("chat.noKeyHint")}</span>
            </span>
          ) : (
            <span className="text-text-secondary">{error}</span>
          )}
        </div>
      </div>
      <div className="flex gap-2 pl-4">
        {isNoKey && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("umai:open-settings", { detail: "api" }))}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition"
          >
            {t("chat.goToSettings")}
          </button>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-2.5 py-1 rounded-lg text-xs text-text-secondary border border-border hover:bg-hover transition"
          >
            {t("msg.regenerate")}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Citation sources footer ── */
function safeHref(url: string): string {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : "#";
  } catch {
    return "#";
  }
}

function CitationList({ sources }: { sources: SearchSource[] }) {
  return (
    <div className="mt-3 pt-2.5 border-t border-border-subtle">
      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Sources</p>
      <div className="flex flex-col gap-1">
        {sources.map((src, i) => (
          <a
            key={i}
            href={safeHref(src.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-text-secondary hover:text-accent transition-colors group"
          >
            <span className="shrink-0 size-4 rounded bg-elevated border border-border text-[10px] font-mono text-text-muted flex items-center justify-center">
              {i + 1}
            </span>
            <span className="truncate group-hover:underline">{src.title || src.url}</span>
            <ExternalLink size={10} className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
          </a>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Lightweight Markdown Renderer
   Supports: code blocks, headers, bold, italic,
   inline code, lists, blockquotes, hr, [N] citations
   ═══════════════════════════════════════════ */
function MarkdownRenderer({ content, sources }: { content: string; sources?: SearchSource[] }) {
  // Split on fenced code blocks first
  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="text-sm text-text-primary leading-relaxed space-y-1">
      {segments.map((seg, i) => {
        if (seg.startsWith("```")) {
          const inner = seg.slice(3, -3);
          const newlineIdx = inner.indexOf("\n");
          const lang = newlineIdx >= 0 ? inner.slice(0, newlineIdx).trim() : "";
          const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
          return <CodeBlock key={i} lang={lang} code={code} />;
        }
        return <InlineMarkdown key={i} text={seg} sources={sources} />;
      })}
    </div>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const { t }       = useLanguage();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 800);
    });
  }

  return (
    <div className="my-2 rounded-xl border border-border overflow-hidden text-xs">
      <div className="flex items-center justify-between px-4 py-1.5 bg-elevated border-b border-border">
        <span className="text-text-muted font-mono">{lang || "code"}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-text-muted hover:text-text-secondary transition"
        >
          {copied ? <Check size={11} className="text-accent" /> : <Copy size={11} />}
          <span>{copied ? t("msg.copied") : t("msg.copy")}</span>
        </button>
      </div>
      <pre className="px-4 py-3 overflow-x-auto font-mono text-text-primary bg-surface whitespace-pre">
        <code>{code.trimEnd()}</code>
      </pre>
    </div>
  );
}

function InlineMarkdown({ text, sources }: { text: string; sources?: SearchSource[] }) {
  const lines = text.split("\n");
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (line.startsWith("### ")) {
      result.push(<h3 key={i} className="text-sm font-bold text-text-primary mt-3 mb-0.5">{parseInline(line.slice(4), sources)}</h3>);
    } else if (line.startsWith("## ")) {
      result.push(<h2 key={i} className="text-base font-bold text-text-primary mt-3 mb-1">{parseInline(line.slice(3), sources)}</h2>);
    } else if (line.startsWith("# ")) {
      result.push(<h1 key={i} className="text-lg font-bold text-text-primary mt-3 mb-1">{parseInline(line.slice(2), sources)}</h1>);
    }
    // Horizontal rule
    else if (/^---+$/.test(line.trim())) {
      result.push(<hr key={i} className="border-border my-3" />);
    }
    // Blockquote
    else if (line.startsWith("> ")) {
      result.push(
        <blockquote key={i} className="rounded-md border border-border bg-elevated/60 px-3 py-2 text-text-muted italic my-1">
          {parseInline(line.slice(2), sources)}
        </blockquote>
      );
    }
    // Unordered list
    else if (/^[-*] /.test(line)) {
      result.push(
        <div key={i} className="flex items-start gap-2 my-0.5">
          <span className="text-text-muted shrink-0 mt-1.5">•</span>
          <span>{parseInline(line.slice(2), sources)}</span>
        </div>
      );
    }
    // Ordered list
    else if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1] ?? "";
      result.push(
        <div key={i} className="flex items-start gap-2 my-0.5">
          <span className="text-text-muted shrink-0 font-mono text-xs mt-0.5 w-4 text-right">{num}.</span>
          <span>{parseInline(line.replace(/^\d+\. /, ""), sources)}</span>
        </div>
      );
    }
    // Empty line → spacing
    else if (!line.trim()) {
      result.push(<div key={i} className="h-2" />);
    }
    // Regular paragraph
    else {
      result.push(<p key={i} className="leading-relaxed">{parseInline(line, sources)}</p>);
    }

    i++;
  }

  return <>{result}</>;
}

function parseInline(text: string, sources?: SearchSource[]): React.ReactNode {
  // Split on **bold**, *italic*, `code`, ~~strikethrough~~, [N] citation
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|~~[^~\n]+~~|\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={i} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>;
        if (part.startsWith("*") && part.endsWith("*"))
          return <em key={i} className="italic">{part.slice(1, -1)}</em>;
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={i} className="px-1.5 py-0.5 rounded bg-elevated border border-border text-xs font-mono text-accent">{part.slice(1, -1)}</code>;
        if (part.startsWith("~~") && part.endsWith("~~"))
          return <del key={i} className="text-text-muted">{part.slice(2, -2)}</del>;
        // Citation [N] → superscript link if sources exist
        if (/^\[\d+\]$/.test(part) && sources) {
          const n = parseInt(part.slice(1, -1), 10);
          const src = sources[n - 1];
          if (src?.url) {
            return (
              <a key={i} href={src.url} target="_blank" rel="noopener noreferrer"
                title={src.title || src.url}
                className="inline-flex items-center justify-center size-4 align-super text-[10px] font-mono rounded bg-accent/15 border border-accent/25 text-accent hover:bg-accent/25 transition-colors mx-0.5 no-underline"
              >
                {n}
              </a>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
