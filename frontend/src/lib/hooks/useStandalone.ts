"use client";

import { useEffect, useState } from "react";

/**
 * PWA standalone mode 감지.
 * iOS: navigator.standalone === true
 * Android/Chrome: matchMedia("(display-mode: standalone)").matches
 *
 * standalone = true이면 브라우저 주소창·뒤로가기 버튼이 없으므로
 * UI에서 뒤로가기 수단을 직접 제공해야 한다.
 */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const iosStandalone =
      "standalone" in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true;

    setStandalone(mq.matches || iosStandalone); // eslint-disable-line react-hooks/set-state-in-effect

    const handler = (e: MediaQueryListEvent) => setStandalone(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return standalone;
}
