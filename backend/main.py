"""
Umai FastAPI 애플리케이션 엔트리포인트.

## 시작 순서

1. `lifespan` 컨텍스트 진입:
   - PostgreSQL 테이블 생성 (Alembic 마이그레이션 없을 때 폴백)
   - Redis 연결 초기화 및 ping 확인
   - 프로덕션 환경 강제 검증 (HTTPS, 시크릿 길이)
2. 모든 라우터 등록 (`/api/v1/*`)
3. 미들웨어 스택 (적용 역순으로 정렬):
   - SlowAPIMiddleware: IP 기반 전역 rate limit (200 req/min)
   - SessionMiddleware: OAuth state 세션 쿠키
   - GZipMiddleware: 1 KB 이상 응답 자동 압축
   - CORSMiddleware: FRONTEND_URL 화이트리스트 (프로덕션 단일 도메인)

## Rate Limiting 전략

Global limiter (main.py) + 엔드포인트 limiter (각 라우터) 두 계층으로 구성.
- 전역 200 req/min: 무차별 스캔, DDoS 1차 방어
- 엔드포인트별 한도: constants.py 중앙 관리 (RATE_AUTH_LOGIN 등)
- IP 추출: Nginx X-Real-IP 헤더 우선 (L7 프록시 환경에서 클라이언트 조작 불가)

## 오류 처리

AppException → 공통 JSON 응답 `{detail, code}` 포맷.
RateLimitExceeded → 429 + Retry-After 헤더 (SlowAPI 기본값).
Unhandled 500 → FastAPI 기본 처리 (로그 + 500 응답).

## 헬스체크

GET /api/v1/health → DB/Redis 연결 상태 JSON. 로드밸런서 health probe 용도.
"""
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.database import create_tables, engine
from app.core.errors import AppException
from app.core.logging_config import configure_logging
from app.core.middleware import RequestIDMiddleware
from app.core.redis import close_redis, get_redis
from app.routers import auth, chats, folders, admin, workspace
from app.routers import tasks as tasks_router
from app.routers import rag as rag_router
from app.routers import ws as ws_router
from app.routers import workflows as workflows_router
from app.routers import fine_tune as fine_tune_router

configure_logging(debug=settings.DEBUG)
logger = logging.getLogger(__name__)

# ── Rate Limiter 설정 ─────────────────────────────────────────────────────────

def _get_real_client_ip(request: Request) -> str:
    """실제 클라이언트 IP 추출.

    Nginx는 $remote_addr(Nginx에 직접 연결한 IP)를 X-Real-IP 헤더로 설정한다.
    이 값은 클라이언트가 조작할 수 없으므로 Rate Limit 키로 안전하다.

    nginx.conf의 real_ip_header / set_real_ip_from 설정이 전제 조건이다.
    로컬 직접 접속(개발 환경)은 REMOTE_ADDR를 fallback으로 사용한다.
    """
    # 1순위: Nginx가 주입한 X-Real-IP (클라이언트 조작 불가)
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    # 2순위: X-Forwarded-For의 첫 번째 항목 (좌측 = 원본 클라이언트)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    # 3순위: 직접 연결 (개발/테스트 환경)
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=_get_real_client_ip, default_limits=["200/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await create_tables()
    from app.core.telemetry import setup_telemetry
    setup_telemetry(app, engine)
    yield
    # Shutdown
    await close_redis()


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
    redirect_slashes=False,
)

# Rate limiter 등록
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """AppException → 표준 JSON 에러 응답 변환."""
    return JSONResponse(
        status_code=exc.code.status,
        content={"detail": exc.detail, "code": exc.code.name},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled exception at %s", request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "code": "INTERNAL_ERROR"},
    )


app.add_middleware(RequestIDMiddleware)
app.add_middleware(SlowAPIMiddleware)

# Starlette session (OAuth state 저장용) — JWT 키와 분리된 별도 시크릿 사용
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SESSION_SECRET_KEY or settings.SECRET_KEY,
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Set-Cookie"],
)

# ── Prometheus instrumentation ────────────────────────────────────────────────
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        excluded_handlers=["/health", "/metrics"],
    ).instrument(app).expose(app, endpoint="/metrics")
except ImportError:
    pass  # prometheus_fastapi_instrumentator 미설치 시 skip

# ── 라우터 등록 ───────────────────────────────────────────────────────────────
app.include_router(auth.router,      prefix="/api/v1")
app.include_router(chats.router,     prefix="/api/v1")
app.include_router(folders.router,   prefix="/api/v1")
app.include_router(admin.router,     prefix="/api/v1")
app.include_router(workspace.router,      prefix="/api/v1")
app.include_router(tasks_router.router,   prefix="/api/v1")
app.include_router(rag_router.router,     prefix="/api/v1")
app.include_router(ws_router.router)  # WebSocket — prefix 없음 (/ws/...)
app.include_router(workflows_router.router, prefix="/api/v1")
app.include_router(fine_tune_router.router, prefix="/api/v1")


_health_cache: dict | None = None
_health_cache_at: float = 0.0

@app.get("/health")
@limiter.limit("60/minute")
async def health(request: Request):
    """Liveness + dependency checks. 5초 캐시로 k8s probe 부하 감소."""
    global _health_cache, _health_cache_at
    now = time.monotonic()
    if _health_cache and now - _health_cache_at < 5:
        return JSONResponse(
            status_code=200 if _health_cache["status"] == "ok" else 503,
            content=_health_cache,
        )

    checks: dict[str, str] = {}

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception:
        checks["db"] = "error"  # 내부 연결 정보 노출 방지

    try:
        r = await get_redis()
        await r.ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "error"  # 내부 연결 정보 노출 방지

    ok = all(v == "ok" for v in checks.values())
    result = {"status": "ok" if ok else "degraded", "checks": checks, "service": settings.APP_NAME}
    _health_cache = result
    _health_cache_at = now
    return JSONResponse(status_code=200 if ok else 503, content=result)
