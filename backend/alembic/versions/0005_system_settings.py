"""add system_settings table

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-19
"""
import json
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

DEFAULT_DATA = json.dumps({
    "general": {
        "instance_name": "Umai",
        "allow_signup": True,
        "default_role": "user",
        "max_users": 0,
        "jwt_expiry": "7d",
    },
    "connections": {
        "ollama_url": "",
        "openai_key": "",
        "openai_base_url": "",
        "anthropic_key": "",
        "google_key": "",
    },
    "models": {"enabled": []},
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
        "user_api_keys": False,
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
})


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("data", sa.Text, nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.execute(
        f"INSERT INTO system_settings (id, data, updated_at) "
        f"VALUES (1, '{DEFAULT_DATA.replace(chr(39), chr(39)+chr(39))}', NOW()) "
        f"ON CONFLICT (id) DO NOTHING"
    )


def downgrade() -> None:
    op.drop_table("system_settings")
