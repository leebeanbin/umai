"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { loadSettings, saveSettings, loadModels, type DynamicModel } from "@/lib/appStore";
import ModelSelect from "@/components/common/ModelSelect";

export default function ChatNavbar() {
  const { t } = useLanguage();

  // Load once on mount via lazy initializer — no localStorage read on every render
  const [navState, setNavState] = useState(() => {
    const all = loadModels();
    const s   = loadSettings();
    return {
      model:       all.find((m) => m.id === s.selectedModel) ?? all[0],
      inputBadge:  s.inputLang  !== "auto" ? s.inputLang.toUpperCase()  : null as string | null,
      outputBadge: s.outputLang !== "auto" ? s.outputLang.toUpperCase() : null as string | null,
    };
  });

  const handleModelChange = useCallback((m: DynamicModel) => {
    setNavState((prev) => ({ ...prev, model: m }));
    saveSettings({ selectedModel: m.id });
  }, []);

  // Reload when models are fetched or settings change externally
  useEffect(() => {
    function onModelsChange() {
      const all = loadModels();
      const s   = loadSettings();
      setNavState((prev) => ({
        ...prev,
        model: all.find((m) => m.id === s.selectedModel) ?? all[0] ?? prev.model,
      }));
    }
    function onSettingsChange() {
      const s   = loadSettings();
      const all = loadModels();
      setNavState({
        model:       all.find((m) => m.id === s.selectedModel) ?? all[0],
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
  }, []);

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
