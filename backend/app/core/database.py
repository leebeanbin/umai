from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

# ── Async engine (FastAPI) ────────────────────────────────────────────────────
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_size=20,           # 기본 10 → 20 (100+ 동시 유저 대응)
    max_overflow=40,        # 최대 60 연결 (pool + overflow)
    pool_pre_ping=True,
    pool_recycle=3600,      # 1시간마다 연결 재활용 (stale connection 방지)
    connect_args={"timeout": 10},
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Sync engine (Celery workers) ─────────────────────────────────────────────
# asyncpg URL → psycopg2 URL 변환
_sync_url = settings.DATABASE_URL.replace("+asyncpg", "").replace("postgresql+asyncpg", "postgresql")
sync_engine = create_engine(_sync_url, pool_size=5, max_overflow=10, pool_pre_ping=True)
SyncSessionLocal = sessionmaker(sync_engine, expire_on_commit=False)


@contextmanager
def sync_session() -> Session:
    """Celery 태스크용 동기 DB 세션 컨텍스트 매니저"""
    db = SyncSessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def create_tables():
    """개발용: 테이블 자동 생성 (프로덕션은 Alembic 사용)"""
    async with engine.begin() as conn:
        from app.models import user, chat, workspace, settings  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
