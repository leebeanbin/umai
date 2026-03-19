"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, StopCircle, Trash2, FlaskConical, ChevronDown, Sliders } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { type TranslationKey } from "@/lib/i18n";
import { loadModels, type DynamicModel } from "@/lib/appStore";
import { useChat } from "@/lib/hooks/useChat";
import ModelSelect from "@/components/common/ModelSelect";
import type { Message } from "@/components/chat/MessageList";

type Tab = "chat" | "completions" | "images";
type TFn = (key: TranslationKey) => string;

export default function PlaygroundPage() {
  const { t }       = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>("chat");

  const tabLabel = (tab: Tab): string => {
    if (tab === "chat")        return t("playground.tab.chat");
    if (tab === "completions") return t("playground.tab.completions");
    return t("playground.tab.images");
  };

  return (
    <div className="flex flex-col h-full bg-base overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border-subtle bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-accent" />
          <h1 className="text-sm font-semibold text-text-primary">{t("playground.title")}</h1>
        </div>
        <div className="flex items-center gap-1 ml-2">
          {(["chat", "completions", "images"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === tab
                  ? "bg-hover text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "chat" && <ChatPlayground t={t} />}
        {activeTab !== "chat" && <ComingSoon label={tabLabel(activeTab)} />}
      </div>
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted">
      <FlaskConical size={36} className="opacity-30" />
      <p className="text-sm">{label} — Coming Soon</p>
    </div>
  );
}

function ChatPlayground({ t }: { t: TFn }) {
  const [model, setModel]           = useState<DynamicModel>(() => loadModels()[0]);
  const [systemPrompt, setSystem]   = useState("");
  const [showSystem, setShowSystem] = useState(true);
  const [temperature, setTemp]      = useState(0.8);
  const [showParams, setShowParams] = useState(false);
  const [input, setInput]           = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, generating, send, stop, clear } = useChat();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    if (!input.trim() || generating) return;
    const content = input.trim();
    setInput("");
    send(content, [], { model: model.id, temperature });
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: config panel */}
      <div className="w-64 shrink-0 border-r border-border-subtle bg-surface flex flex-col overflow-y-auto">
        <div className="p-4 flex flex-col gap-4">
          {/* Model selector */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">{t("playground.model")}</label>
            <ModelSelect value={model} onChange={setModel} showTuning={false} />
          </div>

          {/* System prompt */}
          <div>
            <button
              onClick={() => setShowSystem((v) => !v)}
              className="flex items-center justify-between w-full text-xs font-medium text-text-secondary mb-1.5"
            >
              <span>{t("playground.systemPrompt")}</span>
              <ChevronDown size={11} className={`text-text-muted transition-transform ${showSystem ? "rotate-180" : ""}`} />
            </button>
            {showSystem && (
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystem(e.target.value)}
                rows={5}
                placeholder={t("playground.systemPromptPh")}
                className="w-full resize-none px-3 py-2.5 rounded-xl bg-elevated border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors leading-relaxed"
              />
            )}
          </div>

          {/* Parameters */}
          <div>
            <button
              onClick={() => setShowParams((v) => !v)}
              className="flex items-center justify-between w-full text-xs font-medium text-text-secondary mb-1.5"
            >
              <span className="flex items-center gap-1.5"><Sliders size={11} />{t("playground.parameters")}</span>
              <ChevronDown size={11} className={`text-text-muted transition-transform ${showParams ? "rotate-180" : ""}`} />
            </button>
            {showParams && (
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-text-secondary">{t("navbar.temperature")}</span>
                  <span className="text-xs font-mono text-accent">{temperature.toFixed(2)}</span>
                </div>
                <input
                  type="range" min={0} max={2} step={0.05} value={temperature}
                  onChange={(e) => setTemp(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full cursor-pointer accent-accent"
                  style={{ background: `linear-gradient(to right, #7c6af5 ${(temperature / 2) * 100}%, var(--color-border) ${(temperature / 2) * 100}%)` }}
                />
                <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
                  <span>{t("navbar.deterministic")}</span><span>{t("navbar.creative")}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto p-4 border-t border-border-subtle">
          <button
            onClick={clear}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs text-text-muted hover:bg-hover hover:text-text-secondary transition-colors"
          >
            <Trash2 size={13} />{t("playground.clear")}
          </button>
        </div>
      </div>

      {/* Right: chat area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-text-muted">
              <FlaskConical size={28} className="opacity-30" />
              <p className="text-sm">{t("playground.empty")}</p>
            </div>
          ) : messages.map((m) => (
            <PlaygroundMessage key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-4 pb-4">
          <div className="flex items-end gap-2 p-3 rounded-2xl border border-border bg-surface">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t("playground.inputPh")}
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none leading-relaxed"
              style={{ maxHeight: "120px" }}
            />
            {generating ? (
              <button onClick={stop} className="p-1.5 rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors shrink-0">
                <StopCircle size={16} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className={`p-1.5 rounded-full shrink-0 transition-colors ${
                  input.trim() ? "bg-accent hover:bg-accent-hover text-white" : "bg-hover text-text-muted cursor-not-allowed"
                }`}
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaygroundMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`size-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
        isUser ? "bg-accent text-white" : "bg-surface border border-border text-text-secondary"
      }`}>
        {isUser ? "Y" : "A"}
      </div>
      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
        isUser
          ? "bg-accent/15 border border-accent/20 text-text-primary"
          : "bg-surface border border-border text-text-primary"
      }`}>
        {message.error ? (
          <span className="text-red-400 text-xs">{message.error}</span>
        ) : message.streaming && !message.content ? (
          <span className="inline-flex gap-1">
            <span className="size-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="size-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="size-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "300ms" }} />
          </span>
        ) : (
          <span className="whitespace-pre-wrap">{message.content}</span>
        )}
      </div>
    </div>
  );
}
