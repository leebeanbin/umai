import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.database import create_tables, engine
from app.core.errors import AppException
from app.core.redis import close_redis, get_redis
from app.routers import auth, chats, folders, admin, workspace
from app.routers import tasks as tasks_router
from app.routers import rag as rag_router
from app.routers import ws as ws_router
from app.routers import workflows as workflows_router

# ── Rate Limiter 설정 ─────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await create_tables()
    yield
    # Shutdown
    await close_redis()


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
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
app.add_middleware(SlowAPIMiddleware)

# Starlette session (OAuth state 저장용)
app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Set-Cookie"],
)

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


_health_cache: dict | None = None
_health_cache_at: float = 0.0

@app.get("/health")
async def health():
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
