"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, ArrowUp, Globe, Zap, Clock } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

const SUGGESTION_PROMPTS = [
  "배경을 밝은 스튜디오 배경으로 바꿔줘",
  "선택한 영역의 오브젝트를 자연스럽게 제거해줘",
  "선택 영역을 따뜻한 골든아워 톤으로 보정해줘",
  "선택 영역만 자연스럽게 리터칭해줘",
  "선택 영역을 수채화 스타일로 변환해줘",
  "배경을 모던 미니멀 인테리어로 바꿔줘",
];

export default function ChatHome() {
  const router = useRouter();
  const { t } = useLanguage();

  const suggestions = SUGGESTION_PROMPTS.map((prompt, i) => ({
    title:    t(`suggest.${i}.title` as Parameters<typeof t>[0]),
    subtitle: t(`suggest.${i}.subtitle` as Parameters<typeof t>[0]),
    prompt,
  }));
  const [input, setInput]         = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  // auto-resize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [input]);

  function handleSubmit(e?: React.FormEvent, overridePrompt?: string, temporary = false) {
    e?.preventDefault();
    const prompt = overridePrompt ?? input;
    if (!prompt.trim()) return;
    sessionStorage.setItem("umai_pending_prompt", prompt.trim());
    if (temporary) sessionStorage.setItem("umai_temp_chat", "1");
    router.push("/chat/new");
  }

  function startTempChat() {
    sessionStorage.setItem("umai_temp_chat", "1");
    router.push("/chat/new");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col h-full items-center justify-center px-4 bg-base">

      {/* 로고 + 타이틀 */}
      <div className="mb-8 text-center select-none">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-accent/10 border border-accent/20 mb-4">
          <span className="text-2xl font-bold text-accent">U</span>
        </div>
        <h1 className="text-xl font-semibold text-text-primary mb-1.5">{t("home.title")}</h1>
        <p className="text-sm text-text-muted mb-3">{t("home.subtitle")}</p>
        <button
          onClick={startTempChat}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-text-muted border border-border hover:border-accent/40 hover:text-text-secondary transition-colors"
        >
          <Clock size={11} />
          {t("chat.temp.start")}
        </button>
      </div>

      {/* 입력창 */}
      <form onSubmit={handleSubmit} className="w-full max-w-2xl">
        <div className="flex flex-col relative w-full shadow-lg rounded-3xl border border-border/30 bg-white/5 backdrop-blur-sm px-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("home.placeholder")}
            rows={1}
            className="scrollbar-none bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none w-full py-3.5 px-3 resize-none leading-relaxed"
            style={{ maxHeight: "144px" }}
          />
          <div className="flex justify-between mt-0.5 mb-2.5 mx-0.5">
            <div className="ml-1 self-end flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-transparent hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary rounded-full size-8 flex justify-center items-center outline-none transition"
              >
                <ImageIcon size={16} />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" />
              <div className="flex self-center w-px h-4 mx-0.5 bg-border/50" />
              <button
                type="button"
                onClick={() => setWebSearch((v) => !v)}
                className={`group p-[7px] flex gap-1.5 items-center text-xs rounded-full transition-colors duration-300 outline-none ${
                  webSearch
                    ? "text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20"
                    : "bg-transparent text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <Globe size={14} />
                <span className="pr-0.5">{t("home.webSearch")}</span>
              </button>
            </div>
            <div className="self-end flex items-center mr-1">
              <button
                type="submit"
                disabled={!input.trim()}
                className={`transition rounded-full p-1.5 ${
                  input.trim()
                    ? "bg-accent hover:bg-accent-hover text-white cursor-pointer"
                    : "text-text-muted bg-hover cursor-not-allowed"
                }`}
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Suggested 칩 — Open WebUI 스타일 */}
      <div className="w-full max-w-2xl mt-5">
        <div className="mb-1.5 flex gap-1 text-xs font-medium items-center text-text-muted select-none">
          <Zap size={12} />
          {t("home.suggested")}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-0.5">
          {suggestions.map((s, i) => (
            <button
              key={s.title}
              onClick={() => handleSubmit(undefined, s.prompt)}
              className="waterfall flex flex-col flex-1 shrink-0 w-full justify-between px-3 py-2 rounded-xl bg-transparent hover:bg-black/5 dark:hover:bg-white/5 transition group text-left"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex flex-col">
                <div className="font-medium text-text-secondary group-hover:text-text-primary transition line-clamp-1 text-sm">
                  {s.title}
                </div>
                <div className="text-xs text-text-muted font-normal line-clamp-1 mt-0.5">
                  {s.subtitle}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
