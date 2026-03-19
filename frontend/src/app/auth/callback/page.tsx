"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30일 (refresh token과 동일)

/**
 * OAuth 콜백 페이지
 * 백엔드가 /?code=<one-time-code> 로 리다이렉트 →
 * code를 /auth/token/exchange에 제출 → 토큰 획득 → 저장
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
        const res = await fetch(
          `${BASE}/api/v1/auth/token/exchange?code=${encodeURIComponent(code)}`,
          { method: "GET" }
        );
        if (!res.ok) throw new Error("code exchange failed");

        const { access_token, refresh_token } = await res.json();

        localStorage.setItem("umai_access_token",  access_token);
        localStorage.setItem("umai_refresh_token", refresh_token);
        // HttpOnly가 아닌 쿠키는 JS에서만 접근 — middleware 용도
        document.cookie = `umai_access_token=${access_token};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
        window.dispatchEvent(new Event("umai:auth-change"));
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
