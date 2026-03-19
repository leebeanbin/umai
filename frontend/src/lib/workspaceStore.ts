/**
 * Workspace persistence — local-first with background backend sync.
 *
 * Strategy:
 *   1. Read from localStorage immediately (instant render, no loading state)
 *   2. On mount, fetch from backend and merge (newer backend data wins)
 *   3. On write, update localStorage immediately + fire-and-forget backend sync
 *
 * Knowledge base uses backend only (files can't fit in localStorage).
 */

import {
  apiListWorkspaceItems,
  apiCreateWorkspaceItem,
  apiUpdateWorkspaceItem,
  apiDeleteWorkspaceItem,
  type WorkspaceItemType,
  type WorkspaceItem,
} from "@/lib/api/backendClient";

// ── localStorage helpers ──────────────────────────────────────────────────────

export function loadWs<T>(key: string, defaults: T[]): T[] {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(`umai_ws_${key}`);
    if (!raw) return defaults;
    return JSON.parse(raw) as T[];
  } catch {
    return defaults;
  }
}

export function saveWs<T>(key: string, data: T[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(`umai_ws_${key}`, JSON.stringify(data));
}

// ── Backend sync helpers ──────────────────────────────────────────────────────

/**
 * Fetch workspace items from backend and update localStorage cache.
 * Returns the backend list, or falls back to localStorage on error.
 */
export async function syncWorkspaceFromBackend<T extends { id: string }>(
  type: WorkspaceItemType,
  localKey: string,
  toLocal: (item: WorkspaceItem) => T,
  defaults: T[],
): Promise<T[]> {
  try {
    const items = await apiListWorkspaceItems(type);
    const converted = items.map(toLocal);
    saveWs(localKey, converted);
    return converted;
  } catch {
    // Backend unavailable — use cached local data
    return loadWs<T>(localKey, defaults);
  }
}

/**
 * Create a workspace item on the backend and update the local cache.
 */
export async function createWorkspaceItem<T extends { id: string }>(
  type: WorkspaceItemType,
  name: string,
  data: Record<string, unknown>,
  localKey: string,
  toLocal: (item: WorkspaceItem) => T,
  localList: T[],
): Promise<T[]> {
  try {
    const created = await apiCreateWorkspaceItem(type, name, data);
    const item = toLocal(created);
    const updated = [item, ...localList];
    saveWs(localKey, updated);
    return updated;
  } catch {
    // Optimistic local-only fallback
    const localItem = { id: crypto.randomUUID(), ...data, name } as unknown as T;
    const updated = [localItem, ...localList];
    saveWs(localKey, updated);
    return updated;
  }
}

/**
 * Update a workspace item on the backend.
 */
type WorkspaceItemPatch = { name?: string; data?: Record<string, unknown>; is_enabled?: boolean };

export async function updateWorkspaceItem<T extends { id: string }>(
  id: string,
  patch: WorkspaceItemPatch,
  localKey: string,
  toLocal: (item: WorkspaceItem) => T,
  localList: T[],
  applyPatch: (item: T, patch: WorkspaceItemPatch) => T,
): Promise<T[]> {
  // Optimistic update
  const updated = localList.map((item) =>
    item.id === id ? applyPatch(item, patch) : item,
  );
  saveWs(localKey, updated);

  // Background sync
  apiUpdateWorkspaceItem(id, patch).catch(() => {/* best-effort */});
  return updated;
}

/**
 * Delete a workspace item.
 */
export async function deleteWorkspaceItem<T extends { id: string }>(
  id: string,
  localKey: string,
  localList: T[],
): Promise<T[]> {
  const updated = localList.filter((item) => item.id !== id);
  saveWs(localKey, updated);
  apiDeleteWorkspaceItem(id).catch(() => {/* best-effort */});
  return updated;
}
