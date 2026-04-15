/**
 * API 엔드포인트 경로 상수
 *
 * 모든 백엔드 API 경로를 한 곳에서 관리.
 * - backendClient.ts 가 이 파일을 임포트하여 사용
 * - 경로 변경 시 이 파일만 수정하면 전체 반영
 * - 동적 경로(파라미터 포함)는 함수 형태로 제공
 */

const V1 = "/api/v1";

export const API = {
  // ── Auth ───────────────────────────────────────────────────────────────────
  AUTH: {
    ME:             `${V1}/auth/me`,
    REFRESH:        `${V1}/auth/refresh`,
    LOGOUT:         `${V1}/auth/logout`,
    TOKEN_EXCHANGE: `${V1}/auth/token/exchange`,
    ONBOARD:        `${V1}/auth/onboard`,
  },

  // ── Chats ──────────────────────────────────────────────────────────────────
  CHATS: {
    LIST:   `${V1}/chats`,
    CREATE: `${V1}/chats`,
    GET:    (id: string) => `${V1}/chats/${id}`,
    PATCH:  (id: string) => `${V1}/chats/${id}`,
    DELETE: (id: string) => `${V1}/chats/${id}`,
    TITLE:  (id: string) => `${V1}/chats/${id}/title`,
    MESSAGES:       (id: string) => `${V1}/chats/${id}/messages`,
    MESSAGES_BATCH: (id: string) => `${V1}/chats/${id}/messages/batch`,
    MEMBERS:        (id: string) => `${V1}/chats/${id}/members`,
  },

  // ── Folders ────────────────────────────────────────────────────────────────
  FOLDERS: {
    LIST:   `${V1}/folders`,
    CREATE: `${V1}/folders`,
    GET:    (id: string) => `${V1}/folders/${id}`,
    PATCH:  (id: string) => `${V1}/folders/${id}`,
    DELETE: (id: string) => `${V1}/folders/${id}`,
  },

  // ── Workspace ──────────────────────────────────────────────────────────────
  WORKSPACE: {
    ITEMS:        `${V1}/workspace/items`,
    ITEM:         (id: string) => `${V1}/workspace/items/${id}`,
    KNOWLEDGE:    `${V1}/workspace/knowledge`,
    KNOWLEDGE_ITEM: (id: string) => `${V1}/workspace/knowledge/${id}`,
  },

  // ── Tasks ──────────────────────────────────────────────────────────────────
  TASKS: {
    GET: (id: string) => `${V1}/tasks/${id}`,

    IMAGE: {
      RESIZE:     `${V1}/tasks/image/resize`,
      ANALYZE:    `${V1}/tasks/image/analyze`,
      GENERATE:   `${V1}/tasks/image/generate`,
      REMOVE_BG:  `${V1}/tasks/image/remove-background`,
      COMPOSE:    `${V1}/tasks/image/compose-studio`,
      SEGMENT:    `${V1}/tasks/image/segment-click`,
      EDIT:       `${V1}/tasks/image/edit`,
    },

    AI: {
      AGENT:  `${V1}/tasks/ai/agent`,
      SEARCH: `${V1}/tasks/ai/search`,
    },

    KNOWLEDGE: {
      PROCESS: `${V1}/tasks/knowledge/process`,
      EXTRACT: `${V1}/tasks/knowledge/extract`,
    },
  },

  // ── Admin ──────────────────────────────────────────────────────────────────
  ADMIN: {
    STATS:          `${V1}/admin/stats`,
    USERS:          `${V1}/admin/users`,
    USER:           (id: string) => `${V1}/admin/users/${id}`,
    SETTINGS:       `${V1}/admin/settings`,
    SETTINGS_PUBLIC:`${V1}/admin/settings/public`,
    RATINGS:        `${V1}/admin/ratings`,
    OLLAMA_PULL:    `${V1}/admin/ollama/pull`,
  },

  // ── RAG ────────────────────────────────────────────────────────────────────
  RAG: {
    SEARCH: `${V1}/rag/search`,
  },

  // ── Workflow ───────────────────────────────────────────────────────────────
  WORKFLOW: {
    LIST:       `${V1}/workflow`,
    CREATE:     `${V1}/workflow`,
    GET:        (id: string) => `${V1}/workflow/${id}`,
    UPDATE:     (id: string) => `${V1}/workflow/${id}`,
    DELETE:     (id: string) => `${V1}/workflow/${id}`,
    RUN:        (id: string) => `${V1}/workflow/${id}/run`,
    RUNS_LIST:  (id: string, page = 1, limit = 20) =>
      `${V1}/workflow/${id}/runs?page=${page}&limit=${limit}`,
    STATS:      (id: string) => `${V1}/workflow/${id}/stats`,
    RUN_STATUS: (runId: string) => `${V1}/workflow/runs/${runId}`,
    RESUME:     (runId: string) => `${V1}/workflow/runs/${runId}/resume`,
    CANCEL:     (runId: string) => `${V1}/workflow/runs/${runId}/cancel`,
  },

  // ── WebSocket ──────────────────────────────────────────────────────────────
  // 토큰은 URL 쿼리 파라미터 대신 연결 후 첫 메시지로 전송 (로그 노출 방지)
  WS: {
    CHAT:  (chatId: string) => `/ws/chat/${chatId}`,
    TASKS: ()               => `/ws/tasks`,
  },
} as const;
