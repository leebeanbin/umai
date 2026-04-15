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
    SESSION_SECRET_KEY: str = ""                      # 별도 세션 시크릿 (미설정 시 SECRET_KEY fallback)
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
    # 제목 생성 전용 경량 모델 (phi4-mini:3.8b — llama3.2:1b보다 품질 우수, 동급 속도)
    OLLAMA_TITLE_MODEL: str = "phi4-mini:3.8b"
    OLLAMA_TITLE_TIMEOUT: int = 10  # seconds
    # 임베딩 모델
    # qwen3-embedding:8b — 100+ 언어 지원, 2026년 다국어 SOTA
    # mxbai-embed-large  — English SOTA (MTEB), OpenAI 3-large 능가
    # bge-m3             — 다국어 + hybrid search (dense+sparse)
    OLLAMA_EMBED_MODEL: str = "qwen3-embedding:8b"
    OPENAI_EMBED_MODEL: str = "text-embedding-3-small"

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
    XAI_API_KEY: str = ""        # xAI Grok (https://console.x.ai)
    TAVILY_API_KEY: str = ""     # Tavily 웹 검색 (https://tavily.com)

    # ── CORS ─────────────────────────────────────────────────────────────────
    @property
    def CORS_ORIGINS(self) -> List[str]:
        origins = [self.FRONTEND_URL]
        if self.DEBUG:
            origins.append("http://localhost:3000")
        return origins

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

# SECRET_KEY 최소 길이 검증 (프로덕션)
if not settings.DEBUG and len(settings.SECRET_KEY) < 32:
    raise RuntimeError(
        "SECRET_KEY must be at least 32 characters in production. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )

# FRONTEND_URL HTTPS 강제 (프로덕션)
if not settings.DEBUG and not settings.FRONTEND_URL.startswith("https://"):
    raise RuntimeError(
        f"FRONTEND_URL must use HTTPS in production. Current: {settings.FRONTEND_URL}"
    )

# BACKEND_URL HTTPS 강제 (프로덕션) — OAuth 콜백 URI가 HTTP이면 토큰이 평문 전송됨
if not settings.DEBUG and not settings.BACKEND_URL.startswith("https://"):
    raise RuntimeError(
        f"BACKEND_URL must use HTTPS in production. Current: {settings.BACKEND_URL}"
    )

# SESSION_SECRET_KEY 미설정 경고 (프로덕션)
if not settings.SESSION_SECRET_KEY and not settings.DEBUG:
    raise RuntimeError(
        "SESSION_SECRET_KEY is not set. "
        "Set a dedicated SESSION_SECRET_KEY in production for key separation. "
        "Generate one: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
