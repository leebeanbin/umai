"use client";

import { useEffect } from "react";
import { loadSettings } from "@/lib/appStore";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // layout.tsx의 blocking script가 이미 초기 테마 적용 완료
    // 여기서는 이후 설정 변경 이벤트만 처리
    const settings = loadSettings();
    applyTheme(settings.theme);

    // system 테마일 때 OS 설정 변경 감지
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onSystemChange() {
      if (loadSettings().theme === "system") applyTheme("system");
    }
    mq.addEventListener("change", onSystemChange);

    // SettingsModal에서 테마 변경 시 즉시 반영
    function onThemeChange() { applyTheme(loadSettings().theme); }
    window.addEventListener("umai:theme-change", onThemeChange);

    return () => {
      mq.removeEventListener("change", onSystemChange);
      window.removeEventListener("umai:theme-change", onThemeChange);
    };
  }, []);

  return <>{children}</>;
}

export function applyTheme(theme: "dark" | "light" | "system") {
  const html = document.documentElement;
  if (theme === "dark") {
    html.classList.add("dark");
  } else if (theme === "light") {
    html.classList.remove("dark");
  } else {
    html.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
}
