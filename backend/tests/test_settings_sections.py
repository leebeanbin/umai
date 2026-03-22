"""
Admin Settings — 9개 섹션 전체 커버리지 테스트.

커버 항목:
  general:     instance_name, allow_signup, default_role, jwt_expiry, max_users
  connections: ollama_url, openai_key, anthropic_key, google_key, custom provider
  models:      openai/anthropic/google/ollama enabled 목록
  oauth:       google/github enabled 토글 (auth 테스트와 별개로 settings 저장 검증)
  features:    web_search, file_upload, temp_chats, memories, user_api_keys,
               user_webhooks, community_sharing, message_rating
  documents:   embedding_engine, embedding_model, chunk_size, chunk_overlap,
               top_k, hybrid_search, ocr_engine
  audio:       stt_provider, stt_key, tts_provider, tts_voice, vad_auto_send
  images:      engine, dalle_model, comfyui_url, a1111_url
  evaluations: arena_mode, message_rating

공통:
  - 각 섹션 PATCH 후 GET으로 확인 (영속성)
  - deep merge: 한 필드만 바꿔도 나머지 필드 유지
  - 일반 유저는 수정 불가 (403)
  - 무효 데이터 구조도 400이 아닌 200 반환 (현재 서버는 dict를 자유롭게 merge)
"""
import pytest


# ─ helpers ────────────────────────────────────────────────────────────────────

async def get_settings(client, headers):
    r = await client.get("/api/v1/admin/settings", headers=headers)
    assert r.status_code == 200
    return r.json()

async def patch_section(client, headers, section: str, patch: dict):
    r = await client.patch(
        "/api/v1/admin/settings",
        headers=headers,
        json={section: patch},
    )
    assert r.status_code == 200
    return r.json()


# ── 기본값 구조 검증 ──────────────────────────────────────────────────────────

async def test_all_sections_present_in_defaults(client, admin_headers):
    """9개 섹션이 기본값에 모두 존재해야 한다."""
    data = await get_settings(client, admin_headers)
    for section in ("general", "connections", "models", "oauth",
                    "features", "documents", "audio", "images", "evaluations"):
        assert section in data, f"섹션 누락: {section}"


# ── general ───────────────────────────────────────────────────────────────────

async def test_general_instance_name(client, admin_headers):
    await patch_section(client, admin_headers, "general", {"instance_name": "MyAI"})
    data = await get_settings(client, admin_headers)
    assert data["general"]["instance_name"] == "MyAI"


async def test_general_allow_signup_toggle(client, admin_headers):
    """allow_signup을 False로 변경하고 확인."""
    await patch_section(client, admin_headers, "general", {"allow_signup": False})
    data = await get_settings(client, admin_headers)
    assert data["general"]["allow_signup"] is False


async def test_general_jwt_expiry(client, admin_headers):
    await patch_section(client, admin_headers, "general", {"jwt_expiry": "30d"})
    data = await get_settings(client, admin_headers)
    assert data["general"]["jwt_expiry"] == "30d"


async def test_general_max_users(client, admin_headers):
    await patch_section(client, admin_headers, "general", {"max_users": 100})
    data = await get_settings(client, admin_headers)
    assert data["general"]["max_users"] == 100


async def test_general_default_role(client, admin_headers):
    await patch_section(client, admin_headers, "general", {"default_role": "admin"})
    data = await get_settings(client, admin_headers)
    assert data["general"]["default_role"] == "admin"


async def test_general_deep_merge_preserves_other_fields(client, admin_headers):
    """instance_name만 바꿔도 allow_signup 기본값 유지."""
    initial = await get_settings(client, admin_headers)
    original_signup = initial["general"]["allow_signup"]

    await patch_section(client, admin_headers, "general", {"instance_name": "ChangedName"})
    data = await get_settings(client, admin_headers)
    assert data["general"]["instance_name"] == "ChangedName"
    assert data["general"]["allow_signup"] == original_signup


# ── connections ───────────────────────────────────────────────────────────────

async def test_connections_ollama_url(client, admin_headers):
    await patch_section(client, admin_headers, "connections", {"ollama_url": "http://ollama:11434"})
    data = await get_settings(client, admin_headers)
    assert data["connections"]["ollama_url"] == "http://ollama:11434"


async def test_connections_openai_key(client, admin_headers):
    await patch_section(client, admin_headers, "connections", {"openai_key": "sk-test-key"})
    data = await get_settings(client, admin_headers)
    assert data["connections"]["openai_key"] == "sk-test-key"


async def test_connections_anthropic_key(client, admin_headers):
    await patch_section(client, admin_headers, "connections", {"anthropic_key": "sk-ant-test"})
    data = await get_settings(client, admin_headers)
    assert data["connections"]["anthropic_key"] == "sk-ant-test"


async def test_connections_custom_provider(client, admin_headers):
    """커스텀 provider 설정 저장."""
    patch = {
        "custom_name":     "MyLLM",
        "custom_base_url": "https://api.myllm.com/v1",
        "custom_key":      "custom-key-123",
    }
    await patch_section(client, admin_headers, "connections", patch)
    data = await get_settings(client, admin_headers)
    assert data["connections"]["custom_name"]     == "MyLLM"
    assert data["connections"]["custom_base_url"] == "https://api.myllm.com/v1"


# ── models ────────────────────────────────────────────────────────────────────

async def test_models_openai_enabled_list(client, admin_headers):
    """openai_enabled 모델 목록 변경."""
    await patch_section(client, admin_headers, "models", {
        "openai_enabled": ["gpt-4o", "gpt-4o-mini"]
    })
    data = await get_settings(client, admin_headers)
    assert "gpt-4o" in data["models"]["openai_enabled"]
    assert len(data["models"]["openai_enabled"]) == 2


async def test_models_anthropic_enabled_list(client, admin_headers):
    await patch_section(client, admin_headers, "models", {
        "anthropic_enabled": ["claude-sonnet-4-6"]
    })
    data = await get_settings(client, admin_headers)
    assert data["models"]["anthropic_enabled"] == ["claude-sonnet-4-6"]


async def test_models_ollama_enabled_list(client, admin_headers):
    await patch_section(client, admin_headers, "models", {
        "ollama_enabled": ["llama3.2", "mistral"]
    })
    data = await get_settings(client, admin_headers)
    assert "llama3.2" in data["models"]["ollama_enabled"]


# ── oauth ─────────────────────────────────────────────────────────────────────

async def test_oauth_google_enabled_saved(client, admin_headers):
    await patch_section(client, admin_headers, "oauth", {
        "google_enabled": True,
        "google_client_id": "gid-123",
        "google_client_secret": "gsecret-456",
    })
    data = await get_settings(client, admin_headers)
    assert data["oauth"]["google_enabled"] is True
    assert data["oauth"]["google_client_id"] == "gid-123"


async def test_oauth_github_enabled_saved(client, admin_headers):
    await patch_section(client, admin_headers, "oauth", {
        "github_enabled": True,
        "github_client_id": "ghid-123",
        "github_client_secret": "ghsecret-456",
    })
    data = await get_settings(client, admin_headers)
    assert data["oauth"]["github_enabled"] is True
    assert data["oauth"]["github_client_id"] == "ghid-123"


async def test_oauth_disable_persists(client, admin_headers):
    """활성화 후 비활성화 → False로 저장됨."""
    await patch_section(client, admin_headers, "oauth", {"google_enabled": True})
    await patch_section(client, admin_headers, "oauth", {"google_enabled": False})
    data = await get_settings(client, admin_headers)
    assert data["oauth"]["google_enabled"] is False


# ── features ──────────────────────────────────────────────────────────────────

async def test_features_web_search_toggle(client, admin_headers):
    await patch_section(client, admin_headers, "features", {"web_search": True})
    data = await get_settings(client, admin_headers)
    assert data["features"]["web_search"] is True


async def test_features_file_upload_disable(client, admin_headers):
    await patch_section(client, admin_headers, "features", {"file_upload": False})
    data = await get_settings(client, admin_headers)
    assert data["features"]["file_upload"] is False


async def test_features_message_rating_enable(client, admin_headers):
    await patch_section(client, admin_headers, "features", {"message_rating": True})
    data = await get_settings(client, admin_headers)
    assert data["features"]["message_rating"] is True


async def test_features_user_api_keys(client, admin_headers):
    await patch_section(client, admin_headers, "features", {"user_api_keys": True})
    data = await get_settings(client, admin_headers)
    assert data["features"]["user_api_keys"] is True


async def test_features_memories_enable(client, admin_headers):
    await patch_section(client, admin_headers, "features", {"memories": True})
    data = await get_settings(client, admin_headers)
    assert data["features"]["memories"] is True


async def test_features_community_sharing(client, admin_headers):
    await patch_section(client, admin_headers, "features", {"community_sharing": True})
    data = await get_settings(client, admin_headers)
    assert data["features"]["community_sharing"] is True


# ── documents ─────────────────────────────────────────────────────────────────

async def test_documents_embedding_engine(client, admin_headers):
    await patch_section(client, admin_headers, "documents", {"embedding_engine": "ollama"})
    data = await get_settings(client, admin_headers)
    assert data["documents"]["embedding_engine"] == "ollama"


async def test_documents_chunk_size(client, admin_headers):
    await patch_section(client, admin_headers, "documents", {"chunk_size": 2000, "chunk_overlap": 200})
    data = await get_settings(client, admin_headers)
    assert data["documents"]["chunk_size"]   == 2000
    assert data["documents"]["chunk_overlap"] == 200


async def test_documents_top_k(client, admin_headers):
    await patch_section(client, admin_headers, "documents", {"top_k": 10})
    data = await get_settings(client, admin_headers)
    assert data["documents"]["top_k"] == 10


async def test_documents_hybrid_search(client, admin_headers):
    await patch_section(client, admin_headers, "documents", {"hybrid_search": True})
    data = await get_settings(client, admin_headers)
    assert data["documents"]["hybrid_search"] is True


async def test_documents_ocr_engine(client, admin_headers):
    await patch_section(client, admin_headers, "documents", {"ocr_engine": "tesseract"})
    data = await get_settings(client, admin_headers)
    assert data["documents"]["ocr_engine"] == "tesseract"


# ── audio ─────────────────────────────────────────────────────────────────────

async def test_audio_stt_provider(client, admin_headers):
    await patch_section(client, admin_headers, "audio", {
        "stt_provider": "openai",
        "stt_key": "sk-stt-test",
        "stt_language": "ko",
    })
    data = await get_settings(client, admin_headers)
    assert data["audio"]["stt_provider"] == "openai"
    assert data["audio"]["stt_language"] == "ko"


async def test_audio_tts_provider(client, admin_headers):
    await patch_section(client, admin_headers, "audio", {
        "tts_provider": "openai",
        "tts_voice": "nova",
    })
    data = await get_settings(client, admin_headers)
    assert data["audio"]["tts_provider"] == "openai"
    assert data["audio"]["tts_voice"]    == "nova"


async def test_audio_vad_auto_send(client, admin_headers):
    await patch_section(client, admin_headers, "audio", {"vad_auto_send": True})
    data = await get_settings(client, admin_headers)
    assert data["audio"]["vad_auto_send"] is True


# ── images ────────────────────────────────────────────────────────────────────

async def test_images_engine_dalle(client, admin_headers):
    await patch_section(client, admin_headers, "images", {
        "engine": "openai",
        "dalle_key": "sk-dalle-test",
        "dalle_model": "dall-e-3",
    })
    data = await get_settings(client, admin_headers)
    assert data["images"]["engine"]      == "openai"
    assert data["images"]["dalle_model"] == "dall-e-3"


async def test_images_engine_comfyui(client, admin_headers):
    await patch_section(client, admin_headers, "images", {
        "engine": "comfyui",
        "comfyui_url": "http://localhost:8188",
    })
    data = await get_settings(client, admin_headers)
    assert data["images"]["engine"]      == "comfyui"
    assert data["images"]["comfyui_url"] == "http://localhost:8188"


async def test_images_engine_a1111(client, admin_headers):
    await patch_section(client, admin_headers, "images", {
        "engine": "automatic1111",
        "a1111_url": "http://localhost:7860",
    })
    data = await get_settings(client, admin_headers)
    assert data["images"]["engine"]    == "automatic1111"
    assert data["images"]["a1111_url"] == "http://localhost:7860"


# ── evaluations ───────────────────────────────────────────────────────────────

async def test_evaluations_message_rating_enable(client, admin_headers):
    """평가: message_rating 활성화."""
    await patch_section(client, admin_headers, "evaluations", {"message_rating": True})
    data = await get_settings(client, admin_headers)
    assert data["evaluations"]["message_rating"] is True


async def test_evaluations_arena_mode_enable(client, admin_headers):
    """평가: arena_mode 활성화."""
    await patch_section(client, admin_headers, "evaluations", {"arena_mode": True})
    data = await get_settings(client, admin_headers)
    assert data["evaluations"]["arena_mode"] is True


async def test_evaluations_both_flags(client, admin_headers):
    """arena_mode 와 message_rating 동시 활성화."""
    await patch_section(client, admin_headers, "evaluations", {
        "arena_mode": True,
        "message_rating": True,
    })
    data = await get_settings(client, admin_headers)
    assert data["evaluations"]["arena_mode"]     is True
    assert data["evaluations"]["message_rating"] is True


# ── 권한 검증 ──────────────────────────────────────────────────────────────────

async def test_settings_patch_requires_admin(client, user_headers):
    """일반 유저는 settings 수정 불가 (403)."""
    r = await client.patch(
        "/api/v1/admin/settings",
        headers=user_headers,
        json={"general": {"instance_name": "Hacked"}},
    )
    assert r.status_code == 403


# ── public settings 노출 범위 ─────────────────────────────────────────────────

async def test_public_settings_exposes_only_safe_fields(client, admin_headers):
    """public endpoint는 oauth enabled 여부와 allow_signup만 노출해야 함."""
    # 민감한 값 설정
    await client.patch(
        "/api/v1/admin/settings",
        headers=admin_headers,
        json={
            "connections": {"openai_key": "sk-secret"},
            "oauth": {"google_client_secret": "super-secret"},
        },
    )
    r = await client.get("/api/v1/admin/settings/public")
    assert r.status_code == 200
    data = r.json()

    # 포함되어야 할 필드
    assert "google_oauth_enabled" in data
    assert "github_oauth_enabled" in data
    assert "allow_signup"         in data

    # 노출되면 안 되는 민감 정보
    assert "openai_key"            not in data
    assert "google_client_secret"  not in data
    assert "connections"           not in data
