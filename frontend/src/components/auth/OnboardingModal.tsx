"use client";

import { useState } from "react";
import { UserOut, apiOnboard } from "@/lib/api/backendClient";
import { getPastelColor, getInitials } from "@/lib/utils/avatar";

interface Props {
  user: UserOut;
  onComplete: (updated: UserOut) => void;
}

export default function OnboardingModal({ user, onComplete }: Props) {
  const [name,  setName]  = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  const pastel = getPastelColor(user.id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("이름을 입력해주세요."); return; }
    if (!email.trim()) { setError("이메일을 입력해주세요."); return; }

    setLoading(true);
    setError("");
    try {
      const updated = await apiOnboard(name.trim(), email.trim());
      onComplete(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/70 backdrop-blur-xl px-4">
      <div className="relative w-full max-w-sm bg-surface border border-border rounded-2xl shadow-2xl shadow-black/20 p-8 animate-modal">
        {/* Avatar preview */}
        <div className="flex flex-col items-center mb-6">
          <div
            className="size-16 rounded-full flex items-center justify-center text-2xl font-bold mb-3 select-none"
            style={{ background: pastel.bg, color: pastel.text }}
          >
            {getInitials(name || user.name)}
          </div>
          <h1 className="text-base font-semibold text-text-primary">프로필 설정</h1>
          <p className="text-xs text-text-muted mt-1">
            {user.oauth_provider === "google" ? "Google" : "GitHub"} 계정으로 로그인되었습니다
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Nickname */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">닉네임</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="표시될 이름"
              maxLength={50}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Notification email */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              알림 받을 이메일
              <span className="ml-1.5 text-text-muted font-normal">서비스 알림 수신용</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
            />
            {email !== user.email && (
              <p className="text-[11px] text-text-muted">
                로그인 계정({user.email})과 다른 이메일로 알림을 받을 수 있어요.
              </p>
            )}
          </div>

          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors mt-1"
          >
            {loading ? "저장 중..." : "시작하기"}
          </button>
        </form>
      </div>
    </div>
  );
}
