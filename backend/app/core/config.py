import warnings
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

_INSECURE_DEFAULT = "change-me-in-production"


class Settings(BaseSettings):
    # ── App ──────────────────────────────────────────────────────────────────
    APP_NAME: str = "Umai-bin"
    DEBUG: bool = False
    BACKEND_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:3000"

    # ── Security ─────────────────────────────────────────────────────────────
    SECRET_KEY: str = _INSECURE_DEFAULT
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15             # 15분 (보안 표준)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30               # 30일 (리프레시)

    # ── File Upload ──────────────────────────────────────────────────────────
    MAX_UPLOAD_SIZE_MB: int = 10  # 10 MB hard limit

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
    # 제목 생성 전용 경량 모델 (llama3.2:1b 기본 — 빠르고 저렴)
    OLLAMA_TITLE_MODEL: str = "llama3.2:1b"
    OLLAMA_TITLE_TIMEOUT: int = 10  # seconds

    # ── 이미지 생성 백엔드 ────────────────────────────────────────────────────
    COMFYUI_URL: str = "http://localhost:8188"
    A1111_URL: str = "http://localhost:7860"

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

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)


settings = Settings()

# 프로덕션에서 기본 SECRET_KEY 사용 시 즉시 종료 (경고로는 부족함 — 무시될 수 있음)
if settings.SECRET_KEY == _INSECURE_DEFAULT:
    if settings.DEBUG:
        warnings.warn(
            "SECRET_KEY is set to the insecure default. "
            "This is acceptable only in DEBUG mode. "
            "Set a random SECRET_KEY before deploying to production.",
            stacklevel=1,
        )
    else:
        raise RuntimeError(
            "SECRET_KEY must be set to a secure random value in production. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
