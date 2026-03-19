"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiTokenExchange } from "@/lib/api/backendClient";

/**
 * OAuth 콜백 페이지
 * 백엔드가 /?code=<one-time-code> 로 리다이렉트 →
 * apiTokenExchange(code) → 토큰 획득 → 저장 (backendClient 통해 처리)
 * (토큰이 URL history에 노출되지 않음)
 */
function AuthCallbackInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      router.replace("/chat");
      return;
    }

    (async () => {
      try {
        await apiTokenExchange(code);
        // saveTokens inside apiTokenExchange dispatches umai:auth-change
      } catch {
        // 코드 만료 / 재사용 등 → 다시 로그인
        window.dispatchEvent(new Event("umai:logout"));
      } finally {
        router.replace("/chat");
      }
    })();
  }, [searchParams, router]);

  return (
    <div className="h-full flex items-center justify-center text-text-muted text-sm">
      로그인 중...
    </div>
  );
}

export default function AuthCallback() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        로그인 중...
      </div>
    }>
      <AuthCallbackInner />
    </Suspense>
  );
}
