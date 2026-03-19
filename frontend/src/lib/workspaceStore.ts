// Workspace 데이터 localStorage 영속화 헬퍼
// 각 페이지가 고유 key로 데이터를 저장/로드

export function loadWs<T>(key: string, defaults: T[]): T[] {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(`umai_ws_${key}`);
    if (!raw) return defaults;
    return JSON.parse(raw) as T[];
  } catch { return defaults; }
}

export function saveWs<T>(key: string, data: T[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(`umai_ws_${key}`, JSON.stringify(data));
}
