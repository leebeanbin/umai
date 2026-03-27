from datetime import datetime, timezone

from sqlalchemy import Integer, DateTime
from sqlalchemy.dialects.postgresql import JSONB
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
        "xai_key": "",              # xAI Grok API (https://console.x.ai)
        "tavily_key": "",           # Tavily 웹 검색 API (https://tavily.com)
        "custom_name": "",
        "custom_base_url": "",
        "custom_key": "",
    },
    "models": {
        # ── OpenAI ───────────────────────────────────────────────────────────
        # GPT-5.4 (released 2026-03-05): flagship unified model
        # API ID: gpt-5.4-pro / gpt-5.4  |  gpt-4o still active
        "openai_enabled": [
            "gpt-5.4-pro",          # highest capability, low-latency pro track
            "gpt-5.4",              # general GPT-5.4
            "gpt-4o",               # still widely used
            "gpt-4o-mini",          # cost-effective
            "o4-mini",              # fast reasoning
            "o3",                   # deep reasoning
            "gpt-oss-120b",         # OpenAI open-weight (via API or Ollama)
        ],
        # ── Anthropic ─────────────────────────────────────────────────────────
        # Claude Opus 4.6 (2026-02-05), Sonnet 4.6 (2026-02-17)
        "anthropic_enabled": [
            "claude-opus-4-6",
            "claude-sonnet-4-6",
            "claude-sonnet-4-5",
            "claude-haiku-4-5-20251001",
        ],
        # ── Google ────────────────────────────────────────────────────────────
        # Gemini 3.1 Pro leads LM Arena as of March 2026
        "google_enabled": [
            "gemini-3.1-pro-preview",   # LM Arena #1 (March 2026)
            "gemini-3-flash",           # fast & cost-effective
            "gemini-2.5-pro",           # previous flagship, still solid
            "gemini-2.0-flash",         # widely deployed
        ],
        # ── xAI / Grok ───────────────────────────────────────────────────────
        "xai_enabled": [
            "grok-4.20",            # Grok 4.20 (March 2026)
            "grok-4.1",
        ],
        # ── Ollama open-weight suggestions (admin curates final list) ─────────
        "ollama_suggested": [
            # ── Tier 1: Frontier open-weight ──────────────────────────────────
            # OpenAI gpt-oss: o4-mini급 성능, AIME·MMLU·TauBench 동급/상회
            "gpt-oss-120b",
            # Kimi K2.5 (Moonshot AI): native multimodal + agentic, thinking mode
            "kimi-k2.5",
            # MiniMax-M2.5: productivity + coding에 최적화
            "minimax-m2.5",
            # GLM-5 (Zhipu AI): 30B급 최강, OCR/문서 이해
            "glm-5",
            # DeepSeek-R1 0528: reasoning 특화, o3 수준 접근
            "deepseek-r1:70b",
            "deepseek-r1:32b",
            "deepseek-r1:14b",
            "deepseek-r1:8b",       # 8B-0528-qwen3 distill
            # ── Tier 2: General purpose ───────────────────────────────────────
            # Qwen3 (Alibaba) — dense + MoE, 235B ~ 0.6B, 40K context
            "qwen3:235b",           # flagship, cloud급
            "qwen3:32b",            # 고품질 로컬 추론
            "qwen3:14b",            # 균형 (8~12GB VRAM)
            "qwen3:8b",             # 5.2GB — daily driver
            "qwen3:4b",             # 2.5GB — 저사양
            "qwen3:1.7b",           # 1.4GB — 제목 생성 등 경량
            # Qwen3.5 — 최신 MoE 업데이트
            "qwen3.5:235b-a22b",
            # Qwen3-Coder: agentic coding 특화
            "qwen3-coder:32b",
            # Meta Llama 3.3
            "llama3.3:70b",
            "llama3.2:3b",
            "llama3.2:1b",
            # Microsoft Phi-4: 14B로 70B급 성능
            "phi4:14b",
            "phi4-mini:3.8b",
            # Google Gemma 3: multimodal, Vision 지원
            "gemma3:27b",
            "gemma3:12b",
            "gemma3:4b",
            "gemma3:1b",
            # Mistral
            "mistral-nemo:12b",
            "mistral:7b",
            "mixtral:8x22b",
            "mixtral:8x7b",
            # EXAONE 4.0 (LG AI) — 한국어 최강 오픈소스
            "exaone4.0:32b",
            "exaone4.0:7.8b",
            # ── Vision ────────────────────────────────────────────────────────
            # Qwen3-VL: Qwen3 기반 최신 멀티모달
            "qwen3-vl:7b",
            # Qwen2.5-VL: 7B가 Llama3.2 11B Vision 능가
            "qwen2.5vl:72b",
            "qwen2.5vl:7b",
            # Kimi K2.5: 네이티브 멀티모달 (vision + agentic)
            "kimi-k2.5",            # vision 포함
            # MiniCPM-V 2.6: 8B, 5.5GB — 경량 최강 VLM
            "minicpm-v:8b",
            # Moondream: 1.8B, CPU/모바일 동작
            "moondream2",
            "llava:13b",
            # ── Embedding ────────────────────────────────────────────────────
            # qwen3-embedding: 신규, 100+ 언어, 0.6B~8B
            "qwen3-embedding:8b",
            "qwen3-embedding:4b",
            "qwen3-embedding:0.6b",
            # mxbai-embed-large: MTEB English SOTA (OpenAI 3-large 능가)
            "mxbai-embed-large",
            # bge-m3: 다국어 + hybrid search (dense+sparse)
            "bge-m3",
            # nomic-embed-text: 검증된 경량 옵션
            "nomic-embed-text",
        ],
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
        "embedding_engine": "ollama",
        "embedding_model": "qwen3-embedding:8b",  # 100+ 언어, 2026 다국어 SOTA; fallback: mxbai-embed-large (English SOTA)
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
    data: Mapped[dict] = mapped_column(
        JSONB, nullable=False,
        default=lambda: DEFAULT_SETTINGS,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
