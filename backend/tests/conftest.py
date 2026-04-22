"""
공통 pytest fixtures.

전략:
- 테이블 생성: 동기 psycopg2로 session 1회
- async 엔진: session-scoped (단일 loop에 바인딩 → "attached to different loop" 방지)
- 각 테스트: 엔진에서 새 Session + 테스트 후 TRUNCATE
- FastAPI app: SlowAPI/Session 미들웨어 제거로 루프 충돌 방지
"""
import os
import sys
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from httpx import AsyncClient, ASGITransport

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.core.redis import access_set
from app.models import user, chat, workspace   # noqa: F401
from app.models import settings as _           # noqa: F401
from app.models import workflow, fine_tune     # noqa: F401

_ASYNC_URL = (
    os.getenv("TEST_DATABASE_URL")
    or os.getenv("DATABASE_URL")
    or "postgresql+asyncpg://umai:umai@localhost:5434/umai_test"
)
_SYNC_URL = _ASYNC_URL.replace("+asyncpg", "")

# 삭제 순서 (외래키 의존 역순)
_TRUNCATE_TABLES = [
    "chat_members", "messages", "chats", "folders",
    "knowledge_items", "workspace_items", "system_settings",
    "workflow_run_steps", "workflow_runs", "workflows",
    "fine_tune_jobs", "training_datasets",
    "users",
]


# ── 테이블 생성 (동기, session 1회) ───────────────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def _create_tables():
    eng = create_engine(_SYNC_URL)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield
    Base.metadata.drop_all(eng)
    eng.dispose()


# ── session-scoped async engine (단일 loop에 바인딩) ──────────────────────────

@pytest.fixture(scope="session")
async def async_engine(_create_tables):
    eng = create_async_engine(_ASYNC_URL, echo=False, pool_size=5, max_overflow=0)
    yield eng
    await eng.dispose()


# ── 테스트 전용 FastAPI 앱 (미들웨어 최소화) ──────────────────────────────────

@pytest.fixture(scope="session")
def test_app(_create_tables):
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    from starlette.middleware.sessions import SessionMiddleware
    from app.core.errors import AppException
    from app.routers import auth, chats, folders, admin, workspace as ws
    from app.routers import tasks as tasks_router
    from app.routers import rag as rag_router
    from app.routers import workflows as workflows_router
    from app.routers import fine_tune as fine_tune_router

    app = FastAPI()
    # SessionMiddleware는 필요 (OAuth state), SlowAPI는 제외 (loop 충돌)
    app.add_middleware(SessionMiddleware, secret_key="test-secret-key")

    @app.exception_handler(AppException)
    async def _app_exc_handler(request: Request, exc: AppException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.code.status,
            content={"detail": exc.detail, "code": exc.code.name},
        )

    app.include_router(auth.router,                prefix="/api/v1")
    app.include_router(chats.router,               prefix="/api/v1")
    app.include_router(folders.router,             prefix="/api/v1")
    app.include_router(admin.router,               prefix="/api/v1")
    app.include_router(ws.router,                  prefix="/api/v1")
    app.include_router(tasks_router.router,        prefix="/api/v1")
    app.include_router(rag_router.router,          prefix="/api/v1")
    app.include_router(workflows_router.router,    prefix="/api/v1")
    app.include_router(fine_tune_router.router,    prefix="/api/v1")
    return app


# ── 테스트 단위 DB 세션 (session-scoped 엔진 재사용) ──────────────────────────

@pytest.fixture
async def db(async_engine):
    """
    각 테스트마다 독립적인 AsyncSession 사용.
    테스트 종료 후 모든 데이터 DELETE.
    """
    maker = async_sessionmaker(async_engine, expire_on_commit=False, class_=AsyncSession)
    async with maker() as session:
        yield session
    # 데이터 정리
    async with async_engine.begin() as conn:
        for tbl in _TRUNCATE_TABLES:
            try:
                await conn.execute(text(f"DELETE FROM {tbl}"))
            except Exception:
                pass


# ── FastAPI 클라이언트 ────────────────────────────────────────────────────────

@pytest.fixture
async def client(db, test_app):
    async def _override():
        yield db

    test_app.dependency_overrides[get_db] = _override
    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as c:
        yield c
    test_app.dependency_overrides.clear()


# ── 유저 픽스처 ──────────────────────────────────────────────────────────────

@pytest.fixture
async def admin_user(db):
    from app.models.user import User
    u = User(email="admin@example.com", name="Test Admin",
             role="admin", is_active=True, is_onboarded=True)
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def regular_user(db):
    from app.models.user import User
    u = User(email="user@example.com", name="Test User",
             role="user", is_active=True, is_onboarded=True)
    db.add(u)
    await db.flush()
    return u


# ── 토큰 헤더 ────────────────────────────────────────────────────────────────
# access_set을 통해 Redis에도 등록 → deps.py의 Redis 검증 통과

@pytest.fixture
async def admin_headers(admin_user):
    token = create_access_token(str(admin_user.id))
    await access_set(token, str(admin_user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def user_headers(regular_user):
    token = create_access_token(str(regular_user.id))
    await access_set(token, str(regular_user.id))
    return {"Authorization": f"Bearer {token}"}
