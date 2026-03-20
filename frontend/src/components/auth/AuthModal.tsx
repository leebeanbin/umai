"use client";

import { useEffect, useState } from "react";
import { apiGetPublicSettings, type PublicSettings } from "@/lib/api/backendClient";

// OAuth links use relative paths — Next.js rewrites proxy them to the backend.
// This avoids exposing the backend URL in browser JS and eliminates CORS.
const BACKEND_URL = "";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 fill-current" aria-hidden>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
    </svg>
  );
}

const DEFAULT_PUBLIC: PublicSettings = {
  google_oauth_enabled: true,
  github_oauth_enabled: true,
  allow_signup: true,
};

export default function AuthModal() {
  const [publicSettings, setPublicSettings] = useState<PublicSettings>(DEFAULT_PUBLIC);

  useEffect(() => {
    apiGetPublicSettings()
      .then(setPublicSettings)
      .catch(() => { /* 실패 시 기본값 유지 */ });
  }, []);

  const showGoogle = publicSettings.google_oauth_enabled;
  const showGithub = publicSettings.github_oauth_enabled;
  const hasOAuth   = showGoogle || showGithub;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/70 backdrop-blur-xl px-4">
      {/* Radial glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-3xl" />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-xs bg-surface border border-border rounded-2xl shadow-2xl shadow-black/20 p-8 animate-modal">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 select-none">
          <div className="size-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-3">
            <span className="text-xl font-bold text-accent">U</span>
          </div>
          <h1 className="text-base font-semibold text-text-primary">Umai에 오신 것을 환영합니다</h1>
          <p className="text-xs text-text-muted mt-1">
            {hasOAuth ? "소셜 계정으로 빠르게 시작하세요" : "관리자에게 접근 권한을 요청하세요"}
          </p>
        </div>

        {/* Social buttons */}
        {hasOAuth && (
          <div className="flex flex-col gap-2.5">
            {showGoogle && (
              <a
                href={`${BACKEND_URL}/api/v1/auth/oauth/google`}
                className="flex items-center justify-center gap-2.5 w-full px-4 py-3 rounded-xl border border-border bg-surface hover:bg-hover text-text-secondary text-sm font-medium transition-colors"
              >
                <GoogleIcon />
                Google로 계속하기
              </a>
            )}
            {showGithub && (
              <a
                href={`${BACKEND_URL}/api/v1/auth/oauth/github`}
                className="flex items-center justify-center gap-2.5 w-full px-4 py-3 rounded-xl border border-border bg-surface hover:bg-hover text-text-secondary text-sm font-medium transition-colors"
              >
                <GitHubIcon />
                GitHub로 계속하기
              </a>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-[11px] text-text-muted leading-relaxed">
          계속 진행하면 Umai의{" "}
          <span className="text-text-secondary underline underline-offset-2 cursor-pointer">서비스 이용약관</span>
          {" "}및{" "}
          <span className="text-text-secondary underline underline-offset-2 cursor-pointer">개인정보처리방침</span>
          에 동의하는 것으로 간주됩니다.
        </p>
      </div>
    </div>
  );
}
