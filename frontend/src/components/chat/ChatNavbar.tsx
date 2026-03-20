"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { loadSettings, saveSettings, loadModels, type DynamicModel } from "@/lib/appStore";
import { loadSessions, updateSessionModel } from "@/lib/store";
import ModelSelect from "@/components/common/ModelSelect";

type Props = {
  chatId?: string;
};

export default function ChatNavbar({ chatId }: Props) {
  const { t } = useLanguage();

  const [navState, setNavState] = useState(() => {
    const all = loadModels();
    const s   = loadSettings();
    // Per-chat model: if chatId is given, prefer the session's saved modelId
    const sessionModel = chatId
      ? loadSessions().find((sess) => sess.id === chatId)?.modelId
      : undefined;
    const activeId = sessionModel ?? s.selectedModel;
    return {
      model:       all.find((m) => m.id === activeId) ?? all[0],
      inputBadge:  s.inputLang  !== "auto" ? s.inputLang.toUpperCase()  : null as string | null,
      outputBadge: s.outputLang !== "auto" ? s.outputLang.toUpperCase() : null as string | null,
    };
  });

  const handleModelChange = useCallback((m: DynamicModel) => {
    setNavState((prev) => ({ ...prev, model: m }));
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
      setNavState((prev) => ({
        ...prev,
        model: all.find((m) => m.id === activeId) ?? all[0] ?? prev.model,
      }));
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

  if (!navState.model) return null;

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

    </nav>
  );
}
