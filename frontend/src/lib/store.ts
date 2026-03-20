"use client";

// 앱 전체 상태 타입 정의 (추후 zustand/jotai로 교체 가능)
import { apiCreateChat, apiUpdateChat, apiDeleteChat } from "@/lib/api/backendClient";

export type SessionType = "chat" | "editor";

export type Session = {
  id: string;
  title: string;
  type: SessionType;
  folderId: string | null;
  modelId?: string;
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

// UUID v4 pattern — filters out mock IDs like "s1", "f1" etc.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Folders ──────────────────────────────────────────────────────────────────
export function loadFolders(): Folder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as Folder[];
    return all.filter((f) => UUID_RE.test(f.id));
  } catch { return []; }
}

export function saveFolders(folders: Folder[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

// ── Sessions ─────────────────────────────────────────────────────────────────
export function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Array<Session & { updatedAt: string }>)
      .filter((s) => UUID_RE.test(s.id))  // drop mock IDs like "s1", "s2"
      .map((s) => ({ ...s, updatedAt: new Date(s.updatedAt) }));
  } catch { return []; }
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

/** 세션에 사용된 모델 ID 저장 (per-chat model memory) */
export function updateSessionModel(id: string, modelId: string) {
  if (typeof window === "undefined") return;
  const sessions = loadSessions().map((s) =>
    s.id === id ? { ...s, modelId } : s
  );
  saveSessions(sessions);
}

/** 세션 제목 업데이트
 * @param sync  false = localStorage만 업데이트 (스트리밍 중 호출), true(기본) = 백엔드도 동기화
 */
export function updateSessionTitle(id: string, title: string, sync = true) {
  if (typeof window === "undefined") return;
  const sessions = loadSessions().map((s) =>
    s.id === id ? { ...s, title, updatedAt: new Date() } : s
  );
  saveSessions(sessions);
  window.dispatchEvent(new Event("umai:sessions-change"));
  if (sync && localStorage.getItem("umai_access_token")) {
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

