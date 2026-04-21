/**
 * 중앙 집중식 상수 관리
 *
 * 모든 매직 넘버를 이 파일에서 정의한다.
 * - 값 변경 시 한 곳만 수정하면 전체에 반영
 * - 이름으로 의미를 명확히 전달
 */

// ── WebSocket 재연결 ──────────────────────────────────────────────────────────
export const WS_MAX_RECONNECT_ATTEMPTS = 10;
export const WS_BACKOFF_BASE_MS        = 1_000;   // 지수 백오프 초기값
export const WS_BACKOFF_EXPONENT       = 2;        // 2^attempt
export const WS_BACKOFF_JITTER_MS      = 500;      // 랜덤 지터 (thundering herd 방지)
export const WS_BACKOFF_MAX_MS         = 30_000;   // 재연결 최대 대기 30초
export const WS_PING_INTERVAL_MS       = 30_000;   // keepalive ping 주기

// ── 태스크 폴링 ───────────────────────────────────────────────────────────────
export const POLL_DEFAULT_INTERVAL_MS = 2_000;   // 폴링 간격
export const POLL_DEFAULT_MAX_POLLS   = 60;      // 기본 최대 시도 (= 2분)
export const POLL_MAX_POLLS_SLOW      = 60;      // 느린 태스크용 (remove-bg, compose)
export const POLL_MAX_POLLS_FAST      = 30;      // 빠른 태스크용 (segment-click)

// ── 이미지 에디터 ─────────────────────────────────────────────────────────────
export const EDITOR_CANVAS_SIZE          = 1024;  // px: 편집 캔버스 정사각형 크기
export const EDITOR_MIN_INSTRUCTION_LEN  = 5;     // 지시어 최소 글자 수

// ── API 기본값 ────────────────────────────────────────────────────────────────
export const CHAT_LIST_DEFAULT_LIMIT        = 50;
export const IMAGE_RESIZE_DEFAULT_SIZE      = 1024;   // px
export const IMAGE_RESIZE_DEFAULT_QUALITY   = 85;     // JPEG 품질 (0–100)
export const COMPOSE_STUDIO_DEFAULT_SIZE    = "1024x1024";
export const IMAGE_EDIT_DEFAULT_SIZE        = "1024x1024";

// ── 웹 검색 ───────────────────────────────────────────────────────────────────
export const WEBSEARCH_MAX_QUERY_LEN = 500;
export const WEBSEARCH_MAX_RESULTS   = 6;
export const WEBSEARCH_TIMEOUT_MS    = 10_000;

// ── chat 보조 호출 타임아웃 ────────────────────────────────────────────────────
export const RAG_TIMEOUT_MS          = 10_000;  // RAG 검색 타임아웃
export const OCR_TIMEOUT_MS          = 30_000;  // OCR 타임아웃

// ── API 라우트 레이트 리밋 (Next.js proxy routes) ────────────────────────────
export const RL_WINDOW_MS            = 60_000;  // 1분 슬라이딩 윈도우
export const RL_CHAT_LIMIT           = 20;      // LLM 스트리밍: 분당 20회
export const RL_IMAGE_LIMIT          = 5;       // DALL-E 생성: 분당 5회
export const RL_IMAGE_EDIT_LIMIT     = 5;       // DALL-E 편집: 분당 5회
export const RL_OCR_LIMIT            = 10;      // OCR: 분당 10회
export const RL_WEBSEARCH_LIMIT      = 15;      // 웹 검색: 분당 15회
