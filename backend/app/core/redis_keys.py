"""
Redis 키 빌더 — 모든 키 패턴을 한 곳에서 관리.

사용 목적:
  - 키 접두어 오타·불일치 방지
  - 키 변경 시 이 파일만 수정
  - 타입 힌트로 인자 실수 방지

규칙:
  - 함수 이름은 key_<domain>_<entity> 형식
  - 반환값은 항상 str (Redis 키)
"""


# ── 인증 ───────────────────────────────────────────────────────────────────────

def key_access(token: str) -> str:
    """단기 액세스 토큰 → user_id 매핑."""
    return f"access:{token}"


def key_session(token: str) -> str:
    """장기 리프레시 토큰 → user_id 매핑."""
    return f"session:{token}"


def key_user_cache(user_id: str) -> str:
    """유저 객체 캐시 (N+1 방지)."""
    return f"user:{user_id}"


# ── OAuth ──────────────────────────────────────────────────────────────────────

def key_oauth_code(code: str) -> str:
    """OAuth one-time 코드 → 토큰 페이로드."""
    return f"oauth_code:{code}"


def key_oauth_origin(state: str) -> str:
    """OAuth state → frontend origin 매핑."""
    return f"oauth_origin:{state}"


# ── Celery 태스크 ──────────────────────────────────────────────────────────────

def key_task_owner(task_id: str) -> str:
    """task_id → owner user_id (태스크 소유권 검증)."""
    return f"task_owner:{task_id}"


def key_task_notification(user_id: str) -> str:
    """태스크 완료 알림 pub/sub 채널 (사용자 전용)."""
    return f"task:{user_id}"


def key_task_dalle_cache(task_id: str) -> str:
    """DALL-E 결과 캐시 (retry 이중 과금 방지)."""
    return f"task_dalle:{task_id}"


# ── WebSocket ─────────────────────────────────────────────────────────────────

def key_ws_rate_limit(user_id: str) -> str:
    """WebSocket 메시지 rate limit 슬라이딩 윈도우."""
    return f"ws_rate:{user_id}"


def key_chat_channel(chat_id: str) -> str:
    """채팅방 이벤트 pub/sub 채널."""
    return f"chat:{chat_id}"


# ── 워크플로우 ─────────────────────────────────────────────────────────────────

def key_workflow_suspend(run_id: str) -> str:
    """워크플로우 HumanNode 일시정지 상태 (TTL: 24h)."""
    return f"wf_suspend:{run_id}"


# ── 임베딩 캐시 ───────────────────────────────────────────────────────────────

def key_embed_query(content_hash: str) -> str:
    """쿼리 임베딩 캐시 — content MD5 → 벡터 JSON (TTL: 24h)."""
    return f"emb_q:{content_hash}"


# ── HTTP Rate Limit (분산) ────────────────────────────────────────────────────

def key_http_rate_limit(user_id: str, endpoint: str) -> str:
    """HTTP 엔드포인트별 사용자 rate limit Sorted Set."""
    return f"http_rate:{endpoint}:{user_id}"


# ── DAU (Daily Active Users) ──────────────────────────────────────────────────

def key_dau(date_str: str) -> str:
    """날짜별 DAU HyperLogLog 키. date_str 형식: YYYY-MM-DD."""
    return f"dau:{date_str}"
