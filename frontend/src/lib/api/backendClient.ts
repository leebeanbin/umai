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

/** 외부 API 응답 타입 — refresh_token은 HttpOnly 쿠키에 설정되므로 body에 없음 */
export type AccessTokenResponse = {
  access_token: string;
  token_type: string;
};

/** 하위 호환용 alias */
export type TokenResponse = AccessTokenResponse;

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

/**
 * Access token은 메모리(모듈 변수)에만 보관.
 * - XSS로 탈취 불가 (localStorage/cookie에 없음)
 * - 페이지 새로고침 시 소실 → 자동으로 refresh 엔드포인트 호출 (HttpOnly 쿠키 사용)
 * - refresh token은 HttpOnly 쿠키로 백엔드가 직접 설정 → JS에서 절대 접근 불가
 */
let _accessToken = "";

/** 현재 메모리에 유효한 access token이 있는지 확인 (인증 여부 판단용) */
export function isAuthenticated(): boolean {
  return !!_accessToken || IS_DEV;
}

/** 다른 모듈에서 Bearer token이 필요할 때 사용 (직접 fetch 할 때) */
export function getStoredToken(): string {
  return _accessToken || (IS_DEV ? "dev" : "");
}

function saveTokens(tokens: AccessTokenResponse) {
  _accessToken = tokens.access_token;
  window.dispatchEvent(new Event("umai:auth-change"));
}

function clearTokens() {
  _accessToken = "";
  window.dispatchEvent(new Event("umai:auth-change"));
}

// Shared promise so concurrent 401 responses share one refresh call.
let refreshPromise: Promise<boolean> | null = null;

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = _accessToken || (IS_DEV ? "dev" : "");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",   // HttpOnly refresh cookie를 자동 포함
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  try {
    // 요청 body 없음 — 브라우저가 HttpOnly 쿠키(umai_refresh)를 자동 포함
    const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return false;
    const tokens: AccessTokenResponse = await res.json();
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

export async function apiUpdateProfile(body: { name?: string; notification_email?: string }): Promise<UserOut> {
  return apiFetch<UserOut>("/api/v1/auth/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
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
  // refresh_token은 HttpOnly 쿠키 → body 불필요, 브라우저가 자동 포함
  await apiFetch<void>("/api/v1/auth/logout", { method: "POST" }).catch(() => {/* best-effort */});
  clearTokens();
  // 로그아웃 시 채팅 히스토리 localStorage 삭제 (공용 PC 개인정보 보호)
  if (typeof window !== "undefined") {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("umai_msgs_"))
      .forEach((k) => localStorage.removeItem(k));
  }
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

/**
 * Ollama 경량 모델로 대화 첫 교환에서 제목을 생성하고 백엔드 DB에 저장한다.
 * 응답으로 반환된 title을 바로 UI에 반영하면 된다.
 *
 * @throws {Error} Ollama 미실행(503), 모델 없음(503), 권한 없음(403), 채팅 없음(404)
 */
export async function apiGenerateChatTitle(
  chatId: string,
  userContent: string,
  assistantContent: string,
  language = "en",
): Promise<string> {
  const res = await apiFetch<{ title: string }>(`/api/v1/chats/${chatId}/title`, {
    method: "POST",
    body: JSON.stringify({ user_content: userContent, assistant_content: assistantContent, language }),
  });
  return res.title;
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
  daily_chats: number[];    // 최근 7일 채팅 수 (오래된 날 → 최근 날)
  daily_signups: number[];  // 최근 7일 가입자 수
};

export async function apiAdminStats(): Promise<AdminStatsOut> {
  return apiFetch<AdminStatsOut>("/api/v1/admin/stats");
}

export type RatingEntryOut = {
  message_id: string;
  chat_id: string;
  model: string | null;
  rating: "positive" | "negative";
  message_preview: string;
  user_email: string;
  created_at: string;
};

export async function apiRateMessage(
  chatId: string, messageId: string, rating: "positive" | "negative" | null,
): Promise<void> {
  await apiFetch(`/api/v1/chats/${chatId}/messages/${messageId}/rating`, {
    method: "PATCH",
    body: JSON.stringify({ rating }),
  });
}

export async function apiAdminRatings(
  rating?: "positive" | "negative", skip = 0, limit = 50,
): Promise<RatingEntryOut[]> {
  const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
  if (rating) params.set("rating", rating);
  return apiFetch<RatingEntryOut[]>(`/api/v1/admin/ratings?${params}`);
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
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api/v1/admin/ollama/pull`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api/v1/workspace/knowledge`, {
    method: "POST",
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api/v1/tasks/knowledge/process`, {
    method: "POST",
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  provider?: "openai" | "anthropic" | "google" | "xai" | "ollama";
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

export async function apiEnqueueImageAnalyze(
  source: string,
  prompt = "이 이미지를 자세히 설명해줘.",
  provider: "openai" | "ollama" = "ollama",
): Promise<TaskResponse> {
  return apiFetch<TaskResponse>("/api/v1/tasks/image/analyze", {
    method: "POST",
    body: JSON.stringify({ source, prompt, provider }),
  });
}

export async function apiEnqueueImageResize(
  source: string,
  maxSize = 1024,
  quality = 85,
): Promise<TaskResponse> {
  return apiFetch<TaskResponse>("/api/v1/tasks/image/resize", {
    method: "POST",
    body: JSON.stringify({ source, max_size: maxSize, quality }),
  });
}

export async function apiEnqueueRemoveBackground(
  source: string,
  model: "birefnet-general" | "birefnet-portrait" | "u2net" = "birefnet-general",
  alphMatting = true,
): Promise<TaskResponse> {
  return apiFetch<TaskResponse>("/api/v1/tasks/image/remove-background", {
    method: "POST",
    body: JSON.stringify({ source, model, alpha_matting: alphMatting }),
  });
}

export async function apiEnqueueComposeStudio(
  foregroundB64: string,
  backgroundPrompt: string,
  bgType: "solid" | "gradient" | "ai" = "ai",
  bgColor = "#ffffff",
  bgColor2 = "#e0e0e0",
  size = 1024,
): Promise<TaskResponse> {
  return apiFetch<TaskResponse>("/api/v1/tasks/image/compose-studio", {
    method: "POST",
    body: JSON.stringify({
      foreground_b64: foregroundB64,
      background_prompt: backgroundPrompt,
      bg_type: bgType,
      bg_color: bgColor,
      bg_color2: bgColor2,
      size,
    }),
  });
}

export async function apiEnqueueSegmentClick(
  source: string,
  x: number,
  y: number,
): Promise<TaskResponse> {
  return apiFetch<TaskResponse>("/api/v1/tasks/image/segment-click", {
    method: "POST",
    body: JSON.stringify({ source, x, y }),
  });
}

export async function apiEnqueueEditImage(
  source: string,
  mask: string,
  prompt: string,
  provider: "gpt-image-1" | "comfyui" = "gpt-image-1",
  size = "1024x1024",
): Promise<TaskResponse> {
  return apiFetch<TaskResponse>("/api/v1/tasks/image/edit", {
    method: "POST",
    body: JSON.stringify({ source, mask, prompt, provider, size }),
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
  xai_key: string;
  tavily_key: string;
  custom_name: string;
  custom_base_url: string;
  custom_key: string;
};

export type AdminSettingsModels = {
  openai_enabled: string[];
  anthropic_enabled: string[];
  google_enabled: string[];
  xai_enabled: string[];
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
