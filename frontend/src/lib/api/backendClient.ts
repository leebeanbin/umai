/**
 * Typed fetch wrappers for the Umai FastAPI backend.
 *
 * All requests use relative paths (/api/v1/...) so they go through the
 * Next.js rewrite proxy → backend. No CORS issues, no hardcoded ports.
 * The backend URL is configured server-side via INTERNAL_API_URL in next.config.ts.
 *
 * All functions throw on non-2xx responses.
 */

const BASE = "";

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

const IS_DEV = process.env.NODE_ENV === "development";

function getTokens() {
  // In dev mode, use the bypass token if no real token is stored
  const access  = localStorage.getItem("umai_access_token")  || (IS_DEV ? "dev" : "");
  const refresh = localStorage.getItem("umai_refresh_token") || "";
  return { access, refresh };
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

// Shared promise so concurrent 401 responses share one refresh call.
let refreshPromise: Promise<boolean> | null = null;

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

  // Token expired → deduplicate concurrent refresh calls
  if (res.status === 401 && retry) {
    if (!refreshPromise) {
      refreshPromise = tryRefresh().finally(() => { refreshPromise = null; });
    }
    const refreshed = await refreshPromise;
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

/** Exchange a one-time OAuth code for access + refresh tokens. */
export async function apiTokenExchange(code: string): Promise<TokenResponse> {
  const tokens = await apiFetch<TokenResponse>(
    `/api/v1/auth/token/exchange?code=${encodeURIComponent(code)}`,
    { method: "GET" },
    false, // no retry — this IS the auth step
  );
  saveTokens(tokens);
  return tokens;
}

/** Complete onboarding (name + notification email) after OAuth sign-up. */
export async function apiOnboard(name: string, notificationEmail: string): Promise<UserOut> {
  return apiFetch<UserOut>("/api/v1/auth/onboard", {
    method: "POST",
    body: JSON.stringify({ name, notification_email: notificationEmail }),
  });
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
  new_this_week: number;
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

export type OllamaModelCapabilities = {
  name: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization: string;
  context_length: number;
  capabilities: string[]; // "vision" | "ocr" | "tools" | "code"
};

export async function apiAdminOllamaModelCapabilities(modelName: string): Promise<OllamaModelCapabilities> {
  return apiFetch<OllamaModelCapabilities>(
    `/api/v1/admin/ollama/models/${encodeURIComponent(modelName)}/capabilities`,
  );
}

/**
 * Pull an Ollama model. Returns a ReadableStream of NDJSON progress lines.
 * Each line: { status: string, completed?: number, total?: number, error?: string }
 */
export async function apiAdminOllamaPull(
  modelName: string,
  onProgress: (line: { status: string; completed?: number; total?: number; error?: string }) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { access } = getTokens();
  const res = await fetch(`${BASE}/api/v1/admin/ollama/pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
    body: JSON.stringify({ name: modelName }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Pull failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        try { onProgress(JSON.parse(line)); } catch { /* ignore */ }
      }
    }
  }
}

export async function apiAdminOllamaDelete(modelName: string): Promise<void> {
  return apiFetch<void>(`/api/v1/admin/ollama/models/${encodeURIComponent(modelName)}`, {
    method: "DELETE",
  });
}

// ── Workspace ─────────────────────────────────────────────────────────────────

export type WorkspaceItemType = "model" | "prompt" | "tool" | "skill";

export type WorkspaceItem = {
  id: string;
  item_type: WorkspaceItemType;
  name: string;
  data: Record<string, unknown>;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type KnowledgeItem = {
  id: string;
  name: string;
  content_type: string;
  file_size: number;
  created_at: string;
};

export async function apiListWorkspaceItems(type?: WorkspaceItemType): Promise<WorkspaceItem[]> {
  const qs = type ? `?item_type=${type}` : "";
  return apiFetch<WorkspaceItem[]>(`/api/v1/workspace/items${qs}`);
}

export async function apiCreateWorkspaceItem(
  item_type: WorkspaceItemType,
  name: string,
  data: Record<string, unknown> = {},
  is_enabled = true,
): Promise<WorkspaceItem> {
  return apiFetch<WorkspaceItem>("/api/v1/workspace/items", {
    method: "POST",
    body: JSON.stringify({ item_type, name, data, is_enabled }),
  });
}

export async function apiUpdateWorkspaceItem(
  id: string,
  patch: { name?: string; data?: Record<string, unknown>; is_enabled?: boolean },
): Promise<WorkspaceItem> {
  return apiFetch<WorkspaceItem>(`/api/v1/workspace/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function apiDeleteWorkspaceItem(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/workspace/items/${id}`, { method: "DELETE" });
}

export async function apiListKnowledge(): Promise<KnowledgeItem[]> {
  return apiFetch<KnowledgeItem[]>("/api/v1/workspace/knowledge");
}

export async function apiUploadKnowledge(file: File): Promise<KnowledgeItem> {
  const fd = new FormData();
  fd.append("file", file);
  const { access } = getTokens();
  const res = await fetch(`${BASE}/api/v1/workspace/knowledge`, {
    method: "POST",
    headers: access ? { Authorization: `Bearer ${access}` } : {},
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Upload failed ${res.status}: ${body}`);
  }
  return res.json() as Promise<KnowledgeItem>;
}

export async function apiDeleteKnowledge(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/workspace/knowledge/${id}`, { method: "DELETE" });
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export type TaskResponse = {
  task_id: string;
  status: "queued" | "pending" | "running" | "success" | "failed" | string;
  result: unknown;
  error: string | null;
};

export async function apiGetTask(taskId: string): Promise<TaskResponse> {
  return apiFetch<TaskResponse>(`/api/v1/tasks/${taskId}`);
}

export async function apiEnqueueKnowledgeProcess(
  knowledgeId: string,
  file: File,
  embeddingProvider: "openai" | "ollama" = "ollama",
  embeddingModel = "nomic-embed-text",
): Promise<TaskResponse> {
  const fd = new FormData();
  fd.append("knowledge_id", knowledgeId);
  fd.append("embedding_provider", embeddingProvider);
  fd.append("embedding_model", embeddingModel);
  fd.append("file", file);
  const { access } = getTokens();
  const res = await fetch(`${BASE}/api/v1/tasks/knowledge/process`, {
    method: "POST",
    headers: access ? { Authorization: `Bearer ${access}` } : {},
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Enqueue failed ${res.status}: ${body}`);
  }
  return res.json() as Promise<TaskResponse>;
}

export async function apiEnqueueAgentTask(body: {
  messages: { role: string; content: string }[];
  model: string;
  provider?: "openai" | "anthropic" | "ollama";
  enabled_tools?: string[];
  max_steps?: number;
  temperature?: number;
  chat_id?: string;
}): Promise<TaskResponse> {
  return apiFetch<TaskResponse>("/api/v1/tasks/ai/agent", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function apiEnqueueWebSearch(query: string, maxResults = 5): Promise<TaskResponse> {
  return apiFetch<TaskResponse>("/api/v1/tasks/ai/search", {
    method: "POST",
    body: JSON.stringify({ query, max_results: maxResults }),
  });
}

// ── Admin Settings ─────────────────────────────────────────────────────────────

export type AdminSettingsGeneral = {
  instance_name: string;
  instance_url: string;
  allow_signup: boolean;
  default_role: string;
  show_admin_on_pending: boolean;
  admin_email: string;
  max_users: number;
  jwt_expiry: string;
};

export type AdminSettingsConnections = {
  ollama_url: string;
  openai_key: string;
  openai_base_url: string;
  anthropic_key: string;
  google_key: string;
  custom_name: string;
  custom_base_url: string;
  custom_key: string;
};

export type AdminSettingsModels = {
  openai_enabled: string[];
  anthropic_enabled: string[];
  google_enabled: string[];
  ollama_enabled: string[];
};

export type AdminSettingsOAuth = {
  google_enabled: boolean;
  google_client_id: string;
  google_client_secret: string;
  github_enabled: boolean;
  github_client_id: string;
  github_client_secret: string;
};

export type AdminSettingsFeatures = {
  web_search: boolean;
  file_upload: boolean;
  temp_chats: boolean;
  memories: boolean;
  user_api_keys: boolean;
  user_webhooks: boolean;
  community_sharing: boolean;
  message_rating: boolean;
};

export type AdminSettingsDocuments = {
  embedding_engine: string;
  embedding_model: string;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  hybrid_search: boolean;
  ocr_engine: string;
};

export type AdminSettingsAudio = {
  stt_provider: string;
  stt_key: string;
  stt_language: string;
  vad_auto_send: boolean;
  tts_provider: string;
  tts_key: string;
  tts_voice: string;
};

export type AdminSettingsImages = {
  engine: string;
  dalle_key: string;
  dalle_model: string;
  comfyui_url: string;
  a1111_url: string;
};

export type AdminSettingsEvaluations = {
  arena_mode: boolean;
  message_rating: boolean;
};

export type AdminSettings = {
  general: AdminSettingsGeneral;
  connections: AdminSettingsConnections;
  models: AdminSettingsModels;
  oauth: AdminSettingsOAuth;
  features: AdminSettingsFeatures;
  documents: AdminSettingsDocuments;
  audio: AdminSettingsAudio;
  images: AdminSettingsImages;
  evaluations: AdminSettingsEvaluations;
};

export type PublicSettings = {
  google_oauth_enabled: boolean;
  github_oauth_enabled: boolean;
  allow_signup: boolean;
};

export async function apiGetAdminSettings(): Promise<AdminSettings> {
  return apiFetch<AdminSettings>("/api/v1/admin/settings");
}

export async function apiPatchAdminSettings(patch: Partial<AdminSettings>): Promise<AdminSettings> {
  return apiFetch<AdminSettings>("/api/v1/admin/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function apiGetPublicSettings(): Promise<PublicSettings> {
  const res = await fetch("/api/v1/admin/settings/public");
  if (!res.ok) {
    // Graceful fallback — if settings endpoint not available, assume defaults
    return { google_oauth_enabled: true, github_oauth_enabled: true, allow_signup: true };
  }
  return res.json() as Promise<PublicSettings>;
}
