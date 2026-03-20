import json
from datetime import datetime, timezone

from sqlalchemy import Integer, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


DEFAULT_SETTINGS: dict = {
    "general": {
        "instance_name": "Umai",
        "instance_url": "http://localhost:3000",
        "allow_signup": True,
        "default_role": "user",
        "show_admin_on_pending": True,
        "admin_email": "",
        "max_users": 0,
        "jwt_expiry": "7d",
    },
    "connections": {
        "ollama_url": "",
        "openai_key": "",
        "openai_base_url": "",
        "anthropic_key": "",
        "google_key": "",
        "custom_name": "",
        "custom_base_url": "",
        "custom_key": "",
    },
    "models": {
        "openai_enabled": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
        "anthropic_enabled": ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6"],
        "google_enabled": ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
        "ollama_enabled": [],
    },
    "oauth": {
        "google_enabled": False,
        "google_client_id": "",
        "google_client_secret": "",
        "github_enabled": False,
        "github_client_id": "",
        "github_client_secret": "",
    },
    "features": {
        "web_search": False,
        "file_upload": True,
        "temp_chats": True,
        "memories": False,
        "user_api_keys": False,
        "user_webhooks": False,
        "community_sharing": False,
        "message_rating": False,
    },
    "documents": {
        "embedding_engine": "openai",
        "embedding_model": "text-embedding-3-small",
        "chunk_size": 1500,
        "chunk_overlap": 100,
        "top_k": 5,
        "hybrid_search": False,
        "ocr_engine": "none",
    },
    "audio": {
        "stt_provider": "none",
        "stt_key": "",
        "stt_language": "auto",
        "vad_auto_send": False,
        "tts_provider": "none",
        "tts_key": "",
        "tts_voice": "alloy",
    },
    "images": {
        "engine": "disabled",
        "dalle_key": "",
        "dalle_model": "dall-e-3",
        "comfyui_url": "",
        "a1111_url": "",
    },
    "evaluations": {
        "arena_mode": False,
        "message_rating": False,
    },
}


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    data: Mapped[str] = mapped_column(
        Text, nullable=False,
        default=lambda: json.dumps(DEFAULT_SETTINGS),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
