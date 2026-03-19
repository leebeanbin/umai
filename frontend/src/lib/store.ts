"use client";

// 앱 전체 상태 타입 정의 (추후 zustand/jotai로 교체 가능)
import { apiCreateChat, apiUpdateChat, apiDeleteChat } from "@/lib/api/backendClient";

export type SessionType = "chat" | "editor";

export type Session = {
  id: string;
  title: string;
  type: SessionType;
  folderId: string | null;
  updatedAt: Date;
};

export type Folder = {
  id: string;
  name: string;
  open: boolean;
  systemPrompt?: string;
  bgImageUrl?: string;
  description?: string;
};

const SESSIONS_KEY = "umai_sessions";
const FOLDERS_KEY  = "umai_folders";

// ── 초기 목업 (localStorage에 데이터가 없을 때만 사용) ──────────────────────
const DEFAULT_FOLDERS: Folder[] = [
  { id: "f1", name: "상품 이미지", open: true },
  { id: "f2", name: "인물 편집", open: false },
];

const DEFAULT_SESSIONS: Session[] = [
  { id: "s1", title: "배경 교체 작업", type: "editor", folderId: "f1", updatedAt: new Date(Date.now() - 1000 * 60 * 10) },
  { id: "s2", title: "상품 누끼 작업", type: "editor", folderId: "f1", updatedAt: new Date(Date.now() - 1000 * 60 * 40) },
  { id: "s3", title: "인물 배경 제거", type: "editor", folderId: "f2", updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3) },
  { id: "s4", title: "프롬프트 실험",  type: "chat",   folderId: null, updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 25) },
  { id: "s5", title: "모델 응답 비교", type: "chat",   folderId: null, updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 50) },
];

// ── Folders ──────────────────────────────────────────────────────────────────
export function loadFolders(): Folder[] {
  if (typeof window === "undefined") return DEFAULT_FOLDERS;
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (!raw) return DEFAULT_FOLDERS;
    return JSON.parse(raw) as Folder[];
  } catch { return DEFAULT_FOLDERS; }
}

export function saveFolders(folders: Folder[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

// ── Sessions ─────────────────────────────────────────────────────────────────
export function loadSessions(): Session[] {
  if (typeof window === "undefined") return DEFAULT_SESSIONS;
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return DEFAULT_SESSIONS;
    return (JSON.parse(raw) as Array<Session & { updatedAt: string }>).map((s) => ({
      ...s,
      updatedAt: new Date(s.updatedAt),
    }));
  } catch { return DEFAULT_SESSIONS; }
}

export function saveSessions(sessions: Session[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

/** 새 chat 세션을 localStorage에 추가하고 사이드바에 이벤트 발송 */
export function createSession(id: string, title: string, type: SessionType = "chat") {
  if (typeof window === "undefined") return;
  const sessions = loadSessions().filter((s) => s.id !== id); // 중복 방지
  const newSession: Session = { id, title, type, folderId: null, updatedAt: new Date() };
  saveSessions([newSession, ...sessions]);
  window.dispatchEvent(new Event("umai:sessions-change"));
  // Sync to backend (fire-and-forget — local state is authoritative)
  if (localStorage.getItem("umai_access_token")) {
    apiCreateChat(title).catch(() => {/* ignore — offline / unauthenticated */});
  }
}

/** 세션 제목 업데이트 */
export function updateSessionTitle(id: string, title: string) {
  if (typeof window === "undefined") return;
  const sessions = loadSessions().map((s) =>
    s.id === id ? { ...s, title, updatedAt: new Date() } : s
  );
  saveSessions(sessions);
  window.dispatchEvent(new Event("umai:sessions-change"));
  // Sync to backend (fire-and-forget)
  if (localStorage.getItem("umai_access_token")) {
    apiUpdateChat(id, { title }).catch(() => {});
  }
}

/** 세션 삭제 (localStorage + messages + backend) */
export function deleteSession(id: string) {
  if (typeof window === "undefined") return;
  const sessions = loadSessions().filter((s) => s.id !== id);
  saveSessions(sessions);
  localStorage.removeItem(`umai_msgs_${id}`);
  window.dispatchEvent(new Event("umai:sessions-change"));
  // Sync to backend (fire-and-forget)
  if (localStorage.getItem("umai_access_token")) {
    apiDeleteChat(id).catch(() => {});
  }
}

// ── Time grouping ─────────────────────────────────────────────────────────────
export function groupByTime(sessions: Session[]) {
  const now = Date.now();
  const DAY = 1000 * 60 * 60 * 24;
  return {
    today:     sessions.filter((s) => now - s.updatedAt.getTime() < DAY),
    yesterday: sessions.filter((s) => now - s.updatedAt.getTime() >= DAY && now - s.updatedAt.getTime() < DAY * 2),
    older:     sessions.filter((s) => now - s.updatedAt.getTime() >= DAY * 2),
  };
}

// ── Legacy exports (backward compat) ─────────────────────────────────────────
export const INITIAL_FOLDERS  = DEFAULT_FOLDERS;
export const INITIAL_SESSIONS = DEFAULT_SESSIONS;
