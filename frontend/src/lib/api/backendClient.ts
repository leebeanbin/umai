/**
 * Typed fetch wrappers for the Umai FastAPI backend.
 * Base URL comes from NEXT_PUBLIC_API_URL (default: http://localhost:8000).
 *
 * All functions throw on non-2xx responses.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

export type UserOut = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: string;
  oauth_provider: string | null;
  is_onboarded: boolean;
  notification_email: string | null;
};

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

export type ChatOut = {
  id: string;
  title: string;
  folder_id: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  model: string | null;
  created_at: string;
  updated_at: string;
};

export type FolderOut = {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  is_open: boolean;
  created_at: string;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function getTokens() {
  return {
    access:  localStorage.getItem("umai_access_token")  ?? "",
    refresh: localStorage.getItem("umai_refresh_token") ?? "",
  };
}

function saveTokens(tokens: TokenResponse) {
  localStorage.setItem("umai_access_token",  tokens.access_token);
  localStorage.setItem("umai_refresh_token", tokens.refresh_token);
  // Cookie for Next.js middleware (7 day max-age, SameSite=Lax)
  const maxAge = 60 * 60 * 24 * 7;
  document.cookie = `umai_access_token=${tokens.access_token};path=/;max-age=${maxAge};SameSite=Lax`;
  window.dispatchEvent(new Event("umai:auth-change"));
}

function clearTokens() {
  localStorage.removeItem("umai_access_token");
  localStorage.removeItem("umai_refresh_token");
  document.cookie = "umai_access_token=;path=/;max-age=0";
  window.dispatchEvent(new Event("umai:auth-change"));
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const { access } = getTokens();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  // Token expired → try to refresh once
  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch<T>(path, init, false);
    clearTokens();
    window.dispatchEvent(new Event("umai:logout"));
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  const { refresh } = getTokens();
  if (!refresh) return false;
  try {
    const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const tokens: TokenResponse = await res.json();
    saveTokens(tokens);
    return true;
  } catch {
    return false;
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function fetchMe(): Promise<UserOut> {
  return apiFetch<UserOut>("/api/v1/auth/me");
}

export async function apiLogin(email: string, password: string): Promise<TokenResponse> {
  const tokens = await apiFetch<TokenResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }, false);
  saveTokens(tokens);
  return tokens;
}

export async function apiRegister(email: string, name: string, password: string): Promise<TokenResponse> {
  const tokens = await apiFetch<TokenResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, name, password }),
  }, false);
  saveTokens(tokens);
  return tokens;
}

export async function apiLogout(): Promise<void> {
  const { refresh } = getTokens();
  if (refresh) {
    await apiFetch<void>("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refresh }),
    }).catch(() => {/* best-effort */});
  }
  clearTokens();
}

// ── Chats ─────────────────────────────────────────────────────────────────────

export async function apiListChats(page = 1, limit = 50): Promise<ChatOut[]> {
  return apiFetch<ChatOut[]>(`/api/v1/chats?page=${page}&limit=${limit}`);
}

export async function apiCreateChat(title: string, model?: string, folderId?: string): Promise<ChatOut> {
  return apiFetch<ChatOut>("/api/v1/chats", {
    method: "POST",
    body: JSON.stringify({ title, model: model ?? null, folder_id: folderId ?? null }),
  });
}

export async function apiUpdateChat(
  chatId: string,
  patch: { title?: string; is_pinned?: boolean; is_archived?: boolean; folder_id?: string | null },
): Promise<ChatOut> {
  return apiFetch<ChatOut>(`/api/v1/chats/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function apiDeleteChat(chatId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/chats/${chatId}`, { method: "DELETE" });
}

// ── Folders ───────────────────────────────────────────────────────────────────

export async function apiListFolders(): Promise<FolderOut[]> {
  return apiFetch<FolderOut[]>("/api/v1/folders");
}

export async function apiCreateFolder(name: string, description?: string, systemPrompt?: string): Promise<FolderOut> {
  return apiFetch<FolderOut>("/api/v1/folders", {
    method: "POST",
    body: JSON.stringify({ name, description: description ?? null, system_prompt: systemPrompt ?? null }),
  });
}

export async function apiUpdateFolder(
  folderId: string,
  patch: { name?: string; description?: string; system_prompt?: string; is_open?: boolean },
): Promise<FolderOut> {
  return apiFetch<FolderOut>(`/api/v1/folders/${folderId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function apiDeleteFolder(folderId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/folders/${folderId}`, { method: "DELETE" });
}

// ── Auth extras ───────────────────────────────────────────────────────────────

export async function apiChangePassword(currentPassword: string, newPassword: string): Promise<void> {
  return apiFetch<void>("/api/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export type AdminUserOut = UserOut & {
  is_active: boolean;
  created_at: string;
  last_seen_at: string | null;
};

export type AdminStatsOut = {
  total_users: number;
  active_users: number;
  total_chats: number;
};

export async function apiAdminStats(): Promise<AdminStatsOut> {
  return apiFetch<AdminStatsOut>("/api/v1/admin/stats");
}

export async function apiAdminListUsers(skip = 0, limit = 50): Promise<AdminUserOut[]> {
  return apiFetch<AdminUserOut[]>(`/api/v1/admin/users?skip=${skip}&limit=${limit}`);
}

export async function apiAdminUpdateUser(
  userId: string,
  patch: { role?: string; is_active?: boolean; name?: string },
): Promise<AdminUserOut> {
  return apiFetch<AdminUserOut>(`/api/v1/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function apiAdminDeleteUser(userId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/admin/users/${userId}`, { method: "DELETE" });
}

export async function apiAdminOllamaModels(): Promise<{ models: { name: string; size: number }[] }> {
  return apiFetch<{ models: { name: string; size: number }[] }>("/api/v1/admin/ollama/models");
}
