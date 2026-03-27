"""
중앙 집중식 상수 관리

모든 매직 넘버를 이 파일에서 정의한다.
- 값 변경 시 한 곳만 수정하면 전체에 반영
- 이름으로 의미를 명확히 전달
- config.py에 있는 환경변수 기반 설정과 다름 (이 파일은 고정값)
"""

# ── Redis 연결 풀 ──────────────────────────────────────────────────────────────
REDIS_MAX_CONNECTIONS        = 20   # 비동기 클라이언트 max_connections
REDIS_SOCKET_CONNECT_TIMEOUT = 5    # 초: Redis 연결 대기
REDIS_SOCKET_TIMEOUT         = 5    # 초: Redis 읽기/쓰기 대기
REDIS_TASK_POOL_MAX          = 5    # Celery 워커 내 동기 Redis 풀 크기

# ── 캐시 TTL (초) ─────────────────────────────────────────────────────────────
USER_CACHE_TTL          = 60 * 5    # 5분: 유저 객체 캐시 (계정 정지 반영 속도)
OAUTH_CODE_TTL          = 60 * 5    # 5분: OAuth one-time code
OAUTH_ORIGIN_TTL        = 60 * 10   # 10분: OAuth state → origin 매핑
TASK_OWNER_TTL          = 7200      # 2시간: task_owner:{id} (task_time_limit × 4)
COMPOSE_DALLE_CACHE_TTL = 7200      # 2시간: DALL-E 결과 캐시 (retry 이중 청구 방지)
WS_RATE_LIMIT_WINDOW    = 60        # 초: WS rate limit 슬라이딩 윈도우

# ── 세션 TTL ──────────────────────────────────────────────────────────────────
# config.py 의 ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS 참조
REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30일 (config 값과 동기화)
OAUTH_STATE_BYTES      = 16                  # bytes: secrets.token_urlsafe 길이

# ── Celery 태스크 타임아웃 (초) ───────────────────────────────────────────────
TASK_SOFT_TIME_LIMIT    = 1500   # 25분: graceful shutdown 신호
TASK_HARD_TIME_LIMIT    = 1800   # 30분: 강제 종료
TASK_VISIBILITY_TIMEOUT = 1800   # = TASK_HARD_TIME_LIMIT (이중 실행 방지)
TASK_RESULT_EXPIRE      = 3600   # 1시간: Celery 결과 보관 기간 (config 기본값과 동일)

# ── WebSocket ─────────────────────────────────────────────────────────────────
WS_MAX_CONN_PER_USER_PER_ROOM = 5       # 채팅방 채널 연결 수 제한
WS_MAX_CONN_TASK_CHANNEL      = 3       # 태스크 알림 채널 연결 수 제한
WS_MAX_MESSAGE_BYTES          = 10_240  # 10 KB: 메시지 크기 제한
WS_RATE_LIMIT_PER_MINUTE      = 60      # 분당 최대 메시지 수
WS_TOKEN_REVALIDATE_INTERVAL  = 300     # 5분: 토큰 재검증 주기

# ── Rate Limit 문자열 (slowapi) ───────────────────────────────────────────────
RATE_AUTH_REFRESH      = "30/minute"
RATE_AUTH_LOGOUT       = "20/minute"
RATE_AUTH_OAUTH        = "20/minute"
RATE_AUTH_ONBOARD      = "10/minute"
RATE_AUTH_TOKEN_EXCH   = "10/minute"
RATE_CHAT_CREATE       = "60/minute"
RATE_CHAT_MESSAGE      = "120/minute"
RATE_RAG_SEARCH        = "30/minute"
RATE_TASK_KNOWLEDGE    = "10/hour"
RATE_TASK_EXTRACT      = "20/minute"

# ── 페이지네이션 ──────────────────────────────────────────────────────────────
CHAT_LIST_DEFAULT_LIMIT = 30
CHAT_LIST_MAX_LIMIT     = 100

# ── 파일 & 컨텐츠 제한 ────────────────────────────────────────────────────────
MAX_FILE_SIZE_BYTES   = 10 * 1024 * 1024  # 10 MB
MAX_DOCUMENT_CHARS    = 200_000           # 문서 추출 최대 글자 수
MAX_DOCUMENT_PAGES    = 50                # PDF 첫 페이지 추출 제한

# ── RAG ───────────────────────────────────────────────────────────────────────
RAG_DEFAULT_TOP_K         = 5
RAG_MAX_TOP_K             = 20
RAG_MAX_QUERY_LENGTH      = 500
RAG_MAX_KNOWLEDGE_ITEMS   = 500   # OOM 방지: 한 번에 로드하는 최대 항목 수
RAG_CONTENT_CHUNK_STRIDE  = 400   # 키워드 fallback 청크 stride
RAG_CONTENT_CHUNK_SIZE    = 500   # 키워드 fallback 청크 크기

# ── 메시지 저장 재시도 ────────────────────────────────────────────────────────
MSG_SAVE_MAX_RETRIES = 3          # BackgroundTask 재시도 횟수

# ── 이미지 처리 ───────────────────────────────────────────────────────────────
IMAGE_DEFAULT_MAX_SIZE   = 2048   # 기본 리사이즈 최대 픽셀 (가로/세로)
IMAGE_MAX_SIZE_LIMIT     = 8192   # 허용 최대 픽셀 (안전 상한)
IMAGE_DEFAULT_JPEG_QUAL  = 85     # JPEG 품질 기본값 (0–100)
IMAGE_HTTP_TIMEOUT       = 30     # 초: 이미지 다운로드/API 요청 타임아웃
IMAGE_DOWNLOAD_TIMEOUT   = 60     # 초: ComfyUI 결과 이미지 다운로드 타임아웃

# ── ComfyUI 폴링 ──────────────────────────────────────────────────────────────
COMFYUI_POLL_INTERVAL = 5     # 초: /history 폴링 간격
COMFYUI_POLL_TIMEOUT  = 300   # 초: 폴링 최대 대기 시간 (5분)

# ── OpenAI 에러 재시도 ────────────────────────────────────────────────────────
OPENAI_RETRY_AFTER_MIN = 10   # 초: Retry-After 헤더 없을 때 최솟값
OPENAI_RETRY_AFTER_MAX = 60   # 초: Retry-After 최댓값 클램프

# ── AI 에이전트 ───────────────────────────────────────────────────────────────
AGENT_WEB_SEARCH_MAX   = 5    # DuckDuckGo 기본 결과 수
AGENT_WEB_TIMEOUT      = 15   # 초: 웹 검색 HTTP 타임아웃
AGENT_CODE_TIMEOUT     = 10   # 초: 파이썬 코드 실행 타임아웃
AGENT_STDOUT_MAX_CHARS = 4096
AGENT_STDERR_MAX_CHARS = 1024

# ── Knowledge 청킹 ────────────────────────────────────────────────────────────
KNOWLEDGE_DEFAULT_CHUNK_SIZE    = 1000  # 토큰 단위
KNOWLEDGE_DEFAULT_CHUNK_OVERLAP = 100   # 청크 간 겹침

# ── 지원 파일 형식 ─────────────────────────────────────────────────────────────
SUPPORTED_DOCUMENT_TYPES: frozenset[str] = frozenset({
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
})
