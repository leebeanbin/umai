from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # ── App ──────────────────────────────────────────────────────────────────
    APP_NAME: str = "Umai-bin"
    DEBUG: bool = False
    BACKEND_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:3000"

    # ── Security ─────────────────────────────────────────────────────────────
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15             # 15분 (보안 표준)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30               # 30일 (리프레시)

    # ── Database (PostgreSQL) ─────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://umai:umai@localhost:5432/umai"

    # ── Redis (session cache + Celery broker) ─────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Celery ────────────────────────────────────────────────────────────────
    # broker = Redis db 1, result backend = Redis db 2 (분리)
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"
    CELERY_TASK_RESULT_EXPIRES: int = 3600  # 결과 1시간 보관

    # ── Ollama ────────────────────────────────────────────────────────────────
    OLLAMA_URL: str = "http://localhost:11434"

    # ── OAuth ─────────────────────────────────────────────────────────────────
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""

    # ── LLM (서버사이드 키) ───────────────────────────────────────────────────
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    GOOGLE_API_KEY: str = ""

    # ── CORS ─────────────────────────────────────────────────────────────────
    @property
    def CORS_ORIGINS(self) -> List[str]:
        return [self.FRONTEND_URL, "http://localhost:3000"]

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
