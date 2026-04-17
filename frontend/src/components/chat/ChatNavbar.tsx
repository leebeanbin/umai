"use client";

import { useCallback, useEffect, useState } from "react";
import { loadSettings, saveSettings, loadModels, type DynamicModel } from "@/lib/appStore";
import { loadSessions, updateSessionModel } from "@/lib/store";
import ModelSelect from "@/components/common/ModelSelect";
import { Cpu } from "lucide-react";

type Props = {
  chatId?: string;
  fineTuneModeOn?: boolean;
  fineTuneExampleCount?: number;
  onToggleFineTuneMode?: () => void;
  onSaveFineTuneExamples?: () => void;
};

export default function ChatNavbar({
  chatId,
  fineTuneModeOn = false,
  fineTuneExampleCount = 0,
  onToggleFineTuneMode,
  onSaveFineTuneExamples,
}: Props) {
  // null = not yet hydrated (SSR/client 불일치 방지 — localStorage는 클라이언트 전용)
  const [navState, setNavState] = useState<{
    model: DynamicModel;
    inputBadge: string | null;
    outputBadge: string | null;
  } | null>(null);

  // 클라이언트 마운트 후 localStorage에서 초기값 로드
  useEffect(() => {
    const all = loadModels();
    const s   = loadSettings();
    const sessionModel = chatId
      ? loadSessions().find((sess) => sess.id === chatId)?.modelId
      : undefined;
    const activeId = sessionModel ?? s.selectedModel;
    setNavState({
      model:       all.find((m) => m.id === activeId) ?? all[0],
      inputBadge:  s.inputLang  !== "auto" ? s.inputLang.toUpperCase()  : null,
      outputBadge: s.outputLang !== "auto" ? s.outputLang.toUpperCase() : null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModelChange = useCallback((m: DynamicModel) => {
    setNavState((prev) => prev ? { ...prev, model: m } : null);
    saveSettings({ selectedModel: m.id });
    // Also persist to the specific chat session so it loads correctly next time
    if (chatId) updateSessionModel(chatId, m.id);
  }, [chatId]);

  // Reload when models are fetched or settings change externally
  useEffect(() => {
    function onModelsChange() {
      const all = loadModels();
      const s   = loadSettings();
      const sessionModel = chatId
        ? loadSessions().find((sess) => sess.id === chatId)?.modelId
        : undefined;
      const activeId = sessionModel ?? s.selectedModel;
      setNavState((prev) => prev
        ? { ...prev, model: all.find((m) => m.id === activeId) ?? all[0] ?? prev.model }
        : null
      );
    }
    function onSettingsChange() {
      const s   = loadSettings();
      const all = loadModels();
      const sessionModel = chatId
        ? loadSessions().find((sess) => sess.id === chatId)?.modelId
        : undefined;
      const activeId = sessionModel ?? s.selectedModel;
      setNavState({
        model:       all.find((m) => m.id === activeId) ?? all[0],
        inputBadge:  s.inputLang  !== "auto" ? s.inputLang.toUpperCase()  : null,
        outputBadge: s.outputLang !== "auto" ? s.outputLang.toUpperCase() : null,
      });
    }
    window.addEventListener("umai:models-change",   onModelsChange);
    window.addEventListener("umai:settings-change", onSettingsChange);
    return () => {
      window.removeEventListener("umai:models-change",   onModelsChange);
      window.removeEventListener("umai:settings-change", onSettingsChange);
    };
  }, [chatId]);

  if (!navState?.model) return null;

  return (
    <nav className="sticky top-0 z-20 flex items-center justify-between px-4 pt-3 pb-8 bg-linear-to-b from-base/95 via-base/60 via-50% to-transparent pointer-events-none [&>*]:pointer-events-auto">

      <div className="flex items-center gap-2">
        <ModelSelect value={navState.model} onChange={handleModelChange} />

        {navState.inputBadge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
            IN→{navState.inputBadge}
          </span>
        )}
        {navState.outputBadge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">
            OUT→{navState.outputBadge}
          </span>
        )}
      </div>

      {/* 파인튜닝 모드 토글 */}
      <div className="flex items-center gap-2">
        {fineTuneModeOn && fineTuneExampleCount > 0 && (
          <button
            onClick={onSaveFineTuneExamples}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 transition-colors font-medium"
          >
            {fineTuneExampleCount}개 저장
          </button>
        )}
        <button
          onClick={onToggleFineTuneMode}
          title={fineTuneModeOn ? "파인튜닝 모드 끄기" : "파인튜닝 모드 켜기 — 대화를 학습 데이터로 수집"}
          className={
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors " +
            (fineTuneModeOn
              ? "bg-accent/15 border-accent/40 text-accent"
              : "bg-elevated border-border text-text-muted hover:text-text-primary hover:border-border-hover")
          }
        >
          <Cpu size={11} />
          {fineTuneModeOn ? "FT 수집 중" : "FT 모드"}
        </button>
      </div>

    </nav>
  );
}
