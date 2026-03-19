"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { type Lang, type TranslationKey, translations } from "@/lib/i18n";
import { loadSettings, saveSettings } from "@/lib/appStore";

type LangContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
};

const LangContext = createContext<LangContextValue>({
  lang: "ko",
  setLang: () => {},
  t: (key) => key,
});

export function useLanguage() {
  return useContext(LangContext);
}

export default function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ko");

  useEffect(() => {
    setLangState(loadSettings().language ?? "ko");

    function handler() { setLangState(loadSettings().language ?? "ko"); }
    window.addEventListener("umai:lang-change", handler);
    return () => window.removeEventListener("umai:lang-change", handler);
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    saveSettings({ language: l });
    window.dispatchEvent(new Event("umai:lang-change"));
  }

  function t(key: TranslationKey): string {
    return translations[lang][key] ?? translations.ko[key] ?? key;
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}
