"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Check, Copy, Download, X, Globe, Lock } from "lucide-react";

interface Props {
  sessionId: string;
  sessionTitle: string;
  onClose: () => void;
}

const SHARE_KEY = (id: string) => `umai_share_${id}`;

function loadShareState(id: string): boolean {
  try { return JSON.parse(localStorage.getItem(SHARE_KEY(id)) ?? "false"); }
  catch { return false; }
}

function exportMessages(sessionId: string, sessionTitle: string, format: "md" | "json") {
  const raw = localStorage.getItem(`umai_msgs_${sessionId}`);
  const messages: { id: string; role: string; content: string; error?: boolean }[] =
    raw ? JSON.parse(raw) : [];

  let blob: Blob;
  let ext: string;

  if (format === "json") {
    const data = messages.filter((m) => m.id !== "greeting" && !m.error);
    blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    ext = "json";
  } else {
    const lines: string[] = [`# ${sessionTitle}\n`];
    messages.forEach((m) => {
      if (m.id === "greeting" || m.error) return;
      lines.push(`**${m.role === "user" ? "You" : "Umai"}**\n\n${m.content}\n`);
    });
    blob = new Blob([lines.join("\n---\n\n")], { type: "text/markdown" });
    ext = "md";
  }

  const safe = sessionTitle.replace(/[^a-z0-9가-힣\s-]/gi, "").trim().replace(/\s+/g, "-");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe || "chat"}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ChatShareModal({ sessionId, sessionTitle, onClose }: Props) {
  const [isPublic, setIsPublic] = useState(() => loadShareState(sessionId));
  const [copied, setCopied]     = useState(false);
  const copiedTimer             = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/chat/${sessionId}?shared=1`
    : "";

  useEffect(() => {
    localStorage.setItem(SHARE_KEY(sessionId), JSON.stringify(isPublic));
  }, [isPublic, sessionId]);

  function copyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); if (copiedTimer.current) clearTimeout(copiedTimer.current); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-surface border border-border rounded-2xl shadow-2xl p-5 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">공유 및 내보내기</h2>
            <p className="text-xs text-text-muted mt-0.5 truncate max-w-[220px]">{sessionTitle}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-hover transition-colors shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Share section */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">공유 링크</p>

          {/* Public toggle */}
          <div
            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              isPublic ? "border-accent/40 bg-accent/5" : "border-border bg-base"
            }`}
            onClick={() => setIsPublic((v) => !v)}
          >
            <div className={`p-1.5 rounded-lg ${isPublic ? "bg-accent/15" : "bg-hover"}`}>
              {isPublic ? <Globe size={14} className="text-accent" /> : <Lock size={14} className="text-text-muted" />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">
                {isPublic ? "공개 링크 활성화됨" : "링크 비공개"}
              </p>
              <p className="text-xs text-text-muted">
                {isPublic ? "링크를 가진 누구나 볼 수 있음" : "본인만 접근 가능"}
              </p>
            </div>
            <div className={`relative w-8 h-4.5 rounded-full transition-colors shrink-0 ${isPublic ? "bg-accent" : "bg-border"}`} style={{ height: "18px" }}>
              <span className={`absolute top-0.5 size-[14px] rounded-full bg-white shadow transition-transform ${isPublic ? "translate-x-[15px]" : "translate-x-0.5"}`} />
            </div>
          </div>

          {/* Permission badge */}
          {isPublic && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">권한:</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                보기 전용
              </span>
            </div>
          )}

          {/* Link row */}
          {isPublic && (
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-base border border-border overflow-hidden">
                <Link2 size={12} className="text-text-muted shrink-0" />
                <span className="text-xs text-text-muted truncate font-mono">{shareUrl}</span>
              </div>
              <button
                onClick={copyLink}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors shrink-0 ${
                  copied
                    ? "bg-accent/15 border-accent/30 text-accent"
                    : "bg-base border-border text-text-secondary hover:bg-hover"
                }`}
              >
                {copied ? <><Check size={12} />복사됨</> : <><Copy size={12} />복사</>}
              </button>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Export section */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">내보내기</p>
          <div className="flex gap-2">
            <button
              onClick={() => exportMessages(sessionId, sessionTitle, "md")}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border border-border text-text-secondary hover:bg-hover transition-colors"
            >
              <Download size={13} />
              Markdown
            </button>
            <button
              onClick={() => exportMessages(sessionId, sessionTitle, "json")}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border border-border text-text-secondary hover:bg-hover transition-colors"
            >
              <Download size={13} />
              JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
