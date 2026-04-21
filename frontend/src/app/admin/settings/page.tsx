"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Settings, Globe, Zap, ImageIcon, Database,
  Cpu, Check, Eye, EyeOff, Info, AlertCircle, Download,
  Upload, ChevronRight, Link2, CheckCircle2, FlaskConical,
  Server, BookOpen, Volume2, BarChart2, RefreshCw, Trash2,
} from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  apiAdminOllamaModels, apiAdminOllamaModelCapabilities,
  apiAdminOllamaPull, apiAdminOllamaDelete,
  apiGetAdminSettings, apiPatchAdminSettings,
} from "@/lib/api/backendClient";

type AdminSettingsTab =
  | "general"
  | "connections"
  | "models"
  | "oauth"
  | "features"
  | "documents"
  | "audio"
  | "images"
  | "evaluations"
  | "database";

// ── Toggle ─────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-border-subtle last:border-0 gap-4">
      <div className="flex-1">
        <p className="text-sm text-text-primary">{label}</p>
        {description && <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
          checked ? "bg-accent" : "bg-hover border border-border"
        }`}
      >
        <span className={`inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4.5" : "translate-x-0.5"
        }`} />
      </button>
    </div>
  );
}

// ── Field ──────────────────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = "text", hint, monospace }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; hint?: string; monospace?: boolean;
}) {
  const [show, setShow] = useState(false);
  const inputType = type === "password" ? (show ? "text" : "password") : type;
  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full px-3 py-2.5 pr-${type === "password" ? "10" : "3"} rounded-xl bg-base border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/10 transition ${monospace ? "font-mono text-xs" : ""}`}
        />
        {type === "password" && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
function Section({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
      <div className="bg-surface rounded-2xl border border-border p-4">
        {children}
      </div>
    </div>
  );
}

// ── Slider ────────────────────────────────────────────────────────────────────
function Slider({ label, value, onChange, min, max, step, hint }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; hint?: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-text-secondary">{label}</label>
        <span className="text-xs font-mono text-text-primary bg-base px-2 py-0.5 rounded-lg border border-border">{value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full cursor-pointer accent-accent"
      />
      <div className="flex justify-between text-[10px] text-text-muted mt-1">
        <span>{min}</span><span>{max}</span>
      </div>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

// ── SaveBar ───────────────────────────────────────────────────────────────────
function SaveBar({ onSave, saved, error }: { onSave: () => void; saved: boolean; error?: string | null }) {
  return (
    <div className="sticky bottom-0 left-0 right-0 flex items-center justify-end gap-3 pt-4 pb-2 bg-gradient-to-t from-base to-transparent pointer-events-none">
      {error && (
        <span className="pointer-events-auto text-xs text-danger bg-danger/10 border border-danger/20 px-3 py-1.5 rounded-full">
          {error}
        </span>
      )}
      <button
        onClick={onSave}
        className="pointer-events-auto flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium text-white bg-accent hover:bg-accent-hover transition-colors shadow-lg"
      >
        {saved ? <><Check size={14} />Saved!</> : "Save Changes"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminSettingsPage() {
  const { lang } = useLanguage();
  const [tab, setTab] = useState<AdminSettingsTab>("general");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // General
  const [instanceName, setInstanceName] = useState("Umai-bin");
  const [instanceUrl, setInstanceUrl]   = useState("http://localhost:3000");
  const [allowSignups, setAllowSignups] = useState(true);
  const [defaultRole, setDefaultRole]   = useState<"user" | "pending">("pending");
  const [jwtExpiry, setJwtExpiry]       = useState("7d");
  const [maxUsers, setMaxUsers]         = useState("0");
  const [showAdminOnPending, setShowAdminOnPending] = useState(true);
  const [adminEmail, setAdminEmail]     = useState("");

  // Connections
  const [ollamaUrl, setOllamaUrl]         = useState("http://localhost:11434");
  const [ollamaStatus, setOllamaStatus]   = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [ollamaModelNames, setOllamaModelNames] = useState<string[]>([]);
  const [openaiKey, setOpenaiKey]         = useState("");
  const [openaiBase, setOpenaiBase]       = useState("https://api.openai.com/v1");
  const [anthropicKey, setAnthropicKey]   = useState("");
  const [googleAiKey, setGoogleAiKey]     = useState("");
  const [xaiKey, setXaiKey]              = useState("");
  const [tavilyKey, setTavilyKey]        = useState("");
  const [customName, setCustomName]       = useState("");
  const [customBase, setCustomBase]       = useState("");
  const [customKey, setCustomKey]         = useState("");

  // OAuth
  const [googleEnabled, setGoogleEnabled]           = useState(false);
  const [googleClientId, setGoogleClientId]         = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [githubEnabled, setGithubEnabled]           = useState(false);
  const [githubClientId, setGithubClientId]         = useState("");
  const [githubClientSecret, setGithubClientSecret] = useState("");

  // Features
  const [webSearch, setWebSearch]             = useState(true);
  const [fileUpload, setFileUpload]           = useState(true);
  const [tempChat, setTempChat]               = useState(true);
  const [memories, setMemories]               = useState(false);
  const [userApiKeys, setUserApiKeys]         = useState(true);
  const [communitySharing, setCommunitySharing] = useState(false);
  const [messageRating, setMessageRating]     = useState(false);
  const [userWebhooks, setUserWebhooks]       = useState(false);

  // Models — editable per-provider lists
  const [openaiModels, setOpenaiModels]       = useState<string[]>(["gpt-5.4-pro", "gpt-5.4", "gpt-4o", "gpt-4o-mini", "o4-mini", "o3", "gpt-oss-120b"]);
  const [anthropicModels, setAnthropicModels] = useState<string[]>(["claude-opus-4-6", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5-20251001"]);
  const [googleModels, setGoogleModels]       = useState<string[]>(["gemini-3.1-pro-preview", "gemini-3-flash", "gemini-2.5-pro", "gemini-2.0-flash"]);
  const [xaiModels, setXaiModels]             = useState<string[]>(["grok-4.20", "grok-4.1"]);
  const [openaiInput, setOpenaiInput]         = useState("");
  const [anthropicInput, setAnthropicInput]   = useState("");
  const [googleInput, setGoogleInput]         = useState("");
  const [xaiInput, setXaiInput]               = useState("");
  const [ollamaEnabledModels, setOllamaEnabledModels] = useState<string[]>([]);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);
  const [ollamaModelsFetched, setOllamaModelsFetched] = useState(false);
  const [ollamaCapabilities, setOllamaCapabilities] = useState<Record<string, string[]>>({});
  const [ollamaPullInput, setOllamaPullInput]       = useState("");
  const [ollamaPulling, setOllamaPulling]           = useState(false);
  const [ollamaPullProgress, setOllamaPullProgress] = useState<{ status: string; pct?: number } | null>(null);
  const [ollamaDeleting, setOllamaDeleting]         = useState<string | null>(null);
  const [ollamaDeleteTarget, setOllamaDeleteTarget] = useState<string | null>(null);
  const [isDirty, setIsDirty]                       = useState(false);

  // Documents (RAG)
  const [embeddingEngine, setEmbeddingEngine] = useState<"ollama" | "openai">("ollama");
  const [embeddingModel, setEmbeddingModel]   = useState("qwen3-embedding:8b");
  const [chunkSize, setChunkSize]             = useState(1000);
  const [chunkOverlap, setChunkOverlap]       = useState(100);
  const [topK, setTopK]                       = useState(5);
  const [hybridSearch, setHybridSearch]       = useState(false);
  const [ocrEngine, setOcrEngine]             = useState<"none" | "tesseract">("none");
  const [vectorDbResetConfirm, setVectorDbResetConfirm] = useState(false);

  // Admin Audio — engine + API keys only; voice/speed/language are user-level preferences
  const [sttProvider, setSttProvider] = useState<"none" | "openai">("none");
  const [sttApiKey, setSttApiKey]     = useState("");
  const [ttsProvider, setTtsProvider] = useState<"none" | "openai">("none");
  const [ttsApiKey, setTtsApiKey]     = useState("");

  // Images
  const [imageEngine, setImageEngine] = useState<"openai" | "comfyui" | "a1111" | "none">("none");
  const [dalleApiKey, setDalleApiKey] = useState("");
  const [dalleModel, setDalleModel]   = useState("dall-e-3");
  const [comfyuiUrl, setComfyuiUrl]   = useState("http://127.0.0.1:8188");
  const [a1111Url, setA1111Url]       = useState("http://127.0.0.1:7860");

  // Evaluations
  const [arenaMode, setArenaMode]             = useState(false);
  const [evalMessageRating, setEvalMessageRating] = useState(false);

  const toggleOllamaModel = (id: string) => setOllamaEnabledModels((prev) =>
    prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
  );

  const testOllamaConnection = useCallback(async () => {
    setOllamaStatus("testing");
    try {
      const data = await apiAdminOllamaModels();
      setOllamaModelNames(data.models.map((m) => m.name));
      setOllamaStatus("ok");
    } catch {
      setOllamaStatus("error");
    }
  }, []);

  const fetchOllamaModels = useCallback(async () => {
    setOllamaModelsLoading(true);
    try {
      const data = await apiAdminOllamaModels();
      const names = data.models.map((m) => m.name);
      setOllamaModelNames(names);
      setOllamaEnabledModels(names);
      setOllamaModelsFetched(true);

      // Fetch capabilities for each model in parallel (best-effort)
      const capEntries = await Promise.all(
        names.map(async (name) => {
          try {
            const c = await apiAdminOllamaModelCapabilities(name);
            return [name, c.capabilities] as [string, string[]];
          } catch {
            return [name, []] as [string, string[]];
          }
        })
      );
      setOllamaCapabilities(Object.fromEntries(capEntries));
    } catch {
      // silently fail
    } finally {
      setOllamaModelsLoading(false);
    }
  }, []);

  const pullOllamaModel = useCallback(async () => {
    const name = ollamaPullInput.trim();
    if (!name || ollamaPulling) return;
    setOllamaPulling(true);
    setOllamaPullProgress({ status: "Starting…" });
    try {
      await apiAdminOllamaPull(name, (line) => {
        const pct = (line.completed && line.total)
          ? Math.round((line.completed / line.total) * 100)
          : undefined;
        setOllamaPullProgress({ status: line.error ?? line.status ?? "Pulling…", pct });
      });
      setOllamaPullInput("");
      setOllamaPullProgress({ status: "Done!" });
      // Refresh model list
      await fetchOllamaModels();
    } catch (e: unknown) {
      setOllamaPullProgress({ status: `Error: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setOllamaPulling(false);
    }
  }, [ollamaPullInput, ollamaPulling, fetchOllamaModels]);

  const deleteOllamaModel = useCallback(async (name: string) => {
    if (ollamaDeleting) return;
    setOllamaDeleteTarget(name);
  }, [ollamaDeleting]);

  const confirmDeleteOllamaModel = useCallback(async () => {
    const name = ollamaDeleteTarget;
    setOllamaDeleteTarget(null);
    if (!name) return;
    setOllamaDeleting(name);
    try {
      await apiAdminOllamaDelete(name);
      setOllamaModelNames((prev) => prev.filter((n) => n !== name));
      setOllamaEnabledModels((prev) => prev.filter((n) => n !== name));
    } catch {
      // silently fail — Ollama may have already removed the model
    } finally {
      setOllamaDeleting(null);
    }
  }, [ollamaDeleteTarget]);

  // Derive which capabilities are available in the currently-enabled Ollama models
  const enabledOllamaCaps = ollamaEnabledModels.flatMap((name) => ollamaCapabilities[name] ?? []);
  const hasVisionCapability = enabledOllamaCaps.includes("vision");
  const hasOcrCapability    = enabledOllamaCaps.includes("ocr");
  const hasToolsCapability  = enabledOllamaCaps.includes("tools");

  // ── 초기 설정 로드 ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    apiGetAdminSettings()
      .then((s) => {
        if (cancelled) return;
        // General
        if (s.general) {
          setInstanceName(s.general.instance_name ?? "Umai");
          setInstanceUrl(s.general.instance_url || "http://localhost:3000");
          setAllowSignups(s.general.allow_signup ?? true);
          setDefaultRole((s.general.default_role as "user" | "pending") ?? "pending");
          setShowAdminOnPending(s.general.show_admin_on_pending ?? true);
          setAdminEmail(s.general.admin_email || "");
          setJwtExpiry(s.general.jwt_expiry ?? "7d");
          setMaxUsers(String(s.general.max_users ?? 0));
        }
        // Connections
        if (s.connections) {
          setOllamaUrl(s.connections.ollama_url || "http://localhost:11434");
          setOpenaiKey(s.connections.openai_key || "");
          setOpenaiBase(s.connections.openai_base_url || "https://api.openai.com/v1");
          setAnthropicKey(s.connections.anthropic_key || "");
          setGoogleAiKey(s.connections.google_key || "");
          setXaiKey(s.connections.xai_key || "");
          setTavilyKey(s.connections.tavily_key || "");
          setCustomName(s.connections.custom_name || "");
          setCustomBase(s.connections.custom_base_url || "");
          setCustomKey(s.connections.custom_key || "");
        }
        // Models
        if (s.models) {
          if (s.models.openai_enabled?.length)    setOpenaiModels(s.models.openai_enabled);
          if (s.models.anthropic_enabled?.length) setAnthropicModels(s.models.anthropic_enabled);
          if (s.models.google_enabled?.length)    setGoogleModels(s.models.google_enabled);
          if (s.models.xai_enabled?.length)       setXaiModels(s.models.xai_enabled);
          setOllamaEnabledModels(s.models.ollama_enabled ?? []);
        }
        // OAuth
        if (s.oauth) {
          setGoogleEnabled(s.oauth.google_enabled ?? false);
          setGoogleClientId(s.oauth.google_client_id || "");
          setGoogleClientSecret(s.oauth.google_client_secret || "");
          setGithubEnabled(s.oauth.github_enabled ?? false);
          setGithubClientId(s.oauth.github_client_id || "");
          setGithubClientSecret(s.oauth.github_client_secret || "");
        }
        // Features
        if (s.features) {
          setWebSearch(s.features.web_search ?? false);
          setFileUpload(s.features.file_upload ?? true);
          setTempChat(s.features.temp_chats ?? true);
          setMemories(s.features.memories ?? false);
          setUserApiKeys(s.features.user_api_keys ?? false);
          setUserWebhooks(s.features.user_webhooks ?? false);
          setCommunitySharing(s.features.community_sharing ?? false);
          setMessageRating(s.features.message_rating ?? false);
        }
        // Documents
        if (s.documents) {
          setEmbeddingEngine((s.documents.embedding_engine as "ollama" | "openai") ?? "openai");
          setEmbeddingModel(s.documents.embedding_model || "text-embedding-3-small");
          setChunkSize(s.documents.chunk_size ?? 1500);
          setChunkOverlap(s.documents.chunk_overlap ?? 100);
          setTopK(s.documents.top_k ?? 5);
          setHybridSearch(s.documents.hybrid_search ?? false);
          setOcrEngine((s.documents.ocr_engine as "none" | "tesseract") ?? "none");
        }
        // Audio
        if (s.audio) {
          setSttProvider((s.audio.stt_provider as "none" | "openai") ?? "none");
          setSttApiKey(s.audio.stt_key || "");
          setTtsProvider((s.audio.tts_provider as "none" | "openai") ?? "none");
          setTtsApiKey(s.audio.tts_key || "");
        }
        // Images
        if (s.images) {
          setImageEngine((s.images.engine as "openai" | "comfyui" | "a1111" | "none") ?? "none");
          setDalleApiKey(s.images.dalle_key || "");
          setDalleModel(s.images.dalle_model || "dall-e-3");
          setComfyuiUrl(s.images.comfyui_url || "http://127.0.0.1:8188");
          setA1111Url(s.images.a1111_url || "http://127.0.0.1:7860");
        }
        // Evaluations
        if (s.evaluations) {
          setArenaMode(s.evaluations.arena_mode ?? false);
          setEvalMessageRating(s.evaluations.message_rating ?? false);
        }
      })
      .catch(() => { /* 로드 실패 시 초기값 유지 */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── 현재 탭 데이터 수집 ──────────────────────────────────────────────────────
  function getCurrentTabPatch() {
    switch (tab) {
      case "general":
        return {
          general: {
            instance_name: instanceName,
            instance_url: instanceUrl,
            allow_signup: allowSignups,
            default_role: defaultRole,
            show_admin_on_pending: showAdminOnPending,
            admin_email: adminEmail,
            max_users: parseInt(maxUsers, 10) || 0,
            jwt_expiry: jwtExpiry,
          },
        };
      case "connections":
        return {
          connections: {
            ollama_url: ollamaUrl,
            openai_key: openaiKey,
            openai_base_url: openaiBase,
            anthropic_key: anthropicKey,
            google_key: googleAiKey,
            xai_key: xaiKey,
            tavily_key: tavilyKey,
            custom_name: customName,
            custom_base_url: customBase,
            custom_key: customKey,
          },
        };
      case "models":
        return {
          models: {
            openai_enabled: openaiModels,
            anthropic_enabled: anthropicModels,
            google_enabled: googleModels,
            xai_enabled: xaiModels,
            ollama_enabled: ollamaEnabledModels,
          },
        };
      case "oauth":
        return {
          oauth: {
            google_enabled: googleEnabled,
            google_client_id: googleClientId,
            google_client_secret: googleClientSecret,
            github_enabled: githubEnabled,
            github_client_id: githubClientId,
            github_client_secret: githubClientSecret,
          },
        };
      case "features":
        return {
          features: {
            web_search: webSearch,
            file_upload: fileUpload,
            temp_chats: tempChat,
            memories,
            user_api_keys: userApiKeys,
            user_webhooks: userWebhooks,
            community_sharing: communitySharing,
            message_rating: messageRating,
          },
        };
      case "documents":
        return {
          documents: {
            embedding_engine: embeddingEngine,
            embedding_model: embeddingModel,
            chunk_size: chunkSize,
            chunk_overlap: chunkOverlap,
            top_k: topK,
            hybrid_search: hybridSearch,
            ocr_engine: ocrEngine,
          },
        };
      case "audio":
        return {
          audio: {
            stt_provider: sttProvider,
            stt_key: sttApiKey,
            tts_provider: ttsProvider,
            tts_key: ttsApiKey,
          },
        };
      case "images":
        return {
          images: {
            engine: imageEngine,
            dalle_key: dalleApiKey,
            dalle_model: dalleModel,
            comfyui_url: comfyuiUrl,
            a1111_url: a1111Url,
          },
        };
      case "evaluations":
        return {
          evaluations: {
            arena_mode: arenaMode,
            message_rating: evalMessageRating,
          },
        };
      default:
        return {};
    }
  }

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  async function handleSave() {
    setSaveError(null);
    const patch = getCurrentTabPatch();
    if (Object.keys(patch).length === 0) {
      setSaved(true);
      setIsDirty(false);
      setTimeout(() => setSaved(false), 2500);
      return;
    }
    try {
      await apiPatchAdminSettings(patch);
      setSaved(true);
      setIsDirty(false);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    }
  }

  const TABS: { id: AdminSettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "general",     label: lang === "ko" ? "일반"         : "General",     icon: <Settings size={14} /> },
    { id: "connections", label: lang === "ko" ? "연결"         : "Connections", icon: <Link2 size={14} /> },
    { id: "models",      label: lang === "ko" ? "모델"         : "Models",      icon: <Cpu size={14} /> },
    { id: "oauth",       label: "OAuth",                                          icon: <Globe size={14} /> },
    { id: "features",    label: lang === "ko" ? "기능"         : "Features",    icon: <Zap size={14} /> },
    { id: "documents",   label: lang === "ko" ? "문서 (RAG)"   : "Documents",   icon: <BookOpen size={14} /> },
    { id: "audio",       label: lang === "ko" ? "오디오"       : "Audio",       icon: <Volume2 size={14} /> },
    { id: "images",      label: lang === "ko" ? "이미지 생성"  : "Images",      icon: <ImageIcon size={14} /> },
    { id: "evaluations", label: lang === "ko" ? "평가"         : "Evaluations", icon: <BarChart2 size={14} /> },
    { id: "database",    label: lang === "ko" ? "데이터베이스" : "Database",    icon: <Database size={14} /> },
  ];

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-base">
        <div className="flex flex-col items-center gap-3 text-text-muted">
          <RefreshCw size={20} className="animate-spin opacity-50" />
          <p className="text-xs">설정을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-base overflow-hidden">
      <ConfirmModal
        open={ollamaDeleteTarget !== null}
        message={`"${ollamaDeleteTarget}" 모델을 삭제하시겠습니까?`}
        confirmLabel="삭제"
        onConfirm={confirmDeleteOllamaModel}
        onCancel={() => setOllamaDeleteTarget(null)}
      />
      {/* Left sidebar */}
      <nav className="w-52 shrink-0 border-r border-border bg-surface flex flex-col pt-4 gap-0.5 px-2">
        <div className="px-3 mb-3">
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">Admin Settings</p>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              if (isDirty && tab !== t.id && !window.confirm("저장되지 않은 변경사항이 있습니다. 탭을 이동하시겠습니까?")) return;
              setTab(t.id);
              setIsDirty(false);
            }}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors text-left w-full ${
              tab === t.id
                ? "bg-accent/10 text-accent font-medium"
                : "text-text-secondary hover:bg-hover hover:text-text-primary"
            }`}
          >
            <span className={tab === t.id ? "text-accent" : "text-text-muted"}>{t.icon}</span>
            {t.label}
          </button>
        ))}
        <div className="mt-auto pb-4 px-1">
          <a
            href="/admin"
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
          >
            <ChevronRight size={12} className="rotate-180" />
            {lang === "ko" ? "유저 관리로 돌아가기" : "Back to Users"}
          </a>
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 relative">

        {/* ── General ── */}
        {tab === "general" && (
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-6">{lang === "ko" ? "일반 설정" : "General"}</h2>

            <Section title={lang === "ko" ? "인스턴스" : "Instance"} description={lang === "ko" ? "이 Umai-bin 인스턴스에 대한 기본 정보입니다." : "Basic information about this Umai-bin instance."}>
              <Field label={lang === "ko" ? "인스턴스 이름" : "Instance Name"} value={instanceName} onChange={setInstanceName} placeholder="Umai-bin" />
              <Field label={lang === "ko" ? "인스턴스 URL" : "Instance URL"} value={instanceUrl} onChange={setInstanceUrl} placeholder="https://yourdomain.com" hint={lang === "ko" ? "OAuth 콜백 URL 생성에 사용됩니다." : "Used for generating OAuth callback URLs."} />
            </Section>

            <Section title={lang === "ko" ? "회원가입" : "Registration"} description={lang === "ko" ? "새 유저 등록을 관리합니다." : "Control how new users register."}>
              <Toggle checked={allowSignups} onChange={setAllowSignups} label={lang === "ko" ? "새 회원가입 허용" : "Allow New Sign Ups"} description={lang === "ko" ? "비활성화하면 새 계정을 만들 수 없습니다." : "When disabled, no new accounts can be created."} />
              <div className="pt-3 pb-1">
                <label className="block text-xs font-medium text-text-secondary mb-2">{lang === "ko" ? "신규 유저 기본 역할" : "Default Role for New Users"}</label>
                <div className="flex gap-2">
                  {([
                    { val: "pending" as const, label: lang === "ko" ? "대기" : "Pending", desc: lang === "ko" ? "관리자 승인 필요" : "Requires admin approval" },
                    { val: "user"    as const, label: lang === "ko" ? "유저" : "User",    desc: lang === "ko" ? "즉시 접근 허용" : "Immediate access" },
                  ]).map((r) => (
                    <button key={r.val} onClick={() => setDefaultRole(r.val)}
                      className={`flex-1 flex flex-col items-start px-3 py-2 rounded-xl text-xs border transition-colors ${
                        defaultRole === r.val ? "bg-accent/10 border-accent/40 text-accent" : "border-border text-text-secondary hover:border-accent/30"
                      }`}
                    >
                      <span className="font-medium">{r.label}</span>
                      <span className="text-[10px] opacity-70 mt-0.5">{r.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              {showAdminOnPending && (
                <div className="mt-3">
                  <Field label={lang === "ko" ? "관리자 연락 이메일" : "Admin Contact Email"} value={adminEmail} onChange={setAdminEmail} placeholder="admin@example.com" type="email" hint={lang === "ko" ? "대기 중 화면에 표시됩니다." : "Shown on the pending approval screen."} />
                </div>
              )}
              <Toggle checked={showAdminOnPending} onChange={setShowAdminOnPending} label={lang === "ko" ? "대기 화면에 관리자 정보 표시" : "Show Admin Info on Pending Screen"} />
            </Section>

            <Section title={lang === "ko" ? "보안" : "Security"} description={lang === "ko" ? "인증 토큰 설정입니다." : "Authentication token configuration."}>
              <Field label="JWT Expiration" value={jwtExpiry} onChange={setJwtExpiry} placeholder="7d" hint={lang === "ko" ? "예: 30m, 12h, 7d, 30d. -1 = 만료 없음 (권장하지 않음)" : "Examples: 30m, 12h, 7d, 30d. Use -1 for no expiry (not recommended)."} />
              {jwtExpiry === "-1" && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-warning/10 border border-warning/20 text-xs text-warning mb-3">
                  <AlertCircle size={13} className="shrink-0" />
                  {lang === "ko" ? "JWT 만료 없음은 보안 위험이 있습니다." : "No JWT expiration is a security risk."}
                </div>
              )}
              <Field label={lang === "ko" ? "최대 유저 수" : "Max Users"} value={maxUsers} onChange={setMaxUsers} placeholder="0" hint={lang === "ko" ? "0 = 무제한" : "0 = unlimited"} type="number" />
            </Section>

            <SaveBar onSave={handleSave} saved={saved} error={saveError} />
          </div>
        )}

        {/* ── Connections ── */}
        {tab === "connections" && (
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-2">
              {lang === "ko" ? "LLM 연결 설정" : "LLM Connections"}
            </h2>
            <p className="text-xs text-text-muted mb-6">
              {lang === "ko"
                ? "서버사이드 API 키를 설정합니다. 유저가 개인 키를 설정하지 않은 경우 이 키가 사용됩니다."
                : "Configure server-side API keys. These are used when users have not set their own keys."}
            </p>

            {/* Ollama */}
            <Section title="Ollama" description={lang === "ko" ? "로컬 Ollama 서버에 연결하여 오픈소스 모델을 사용합니다." : "Connect to a local Ollama server to run open-source models."}>
              <div className="flex gap-2 mb-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Base URL</label>
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => { setOllamaUrl(e.target.value); setOllamaStatus("idle"); }}
                    placeholder="http://localhost:11434"
                    className="w-full px-3 py-2.5 rounded-xl bg-base border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/60 transition"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={testOllamaConnection}
                    disabled={ollamaStatus === "testing"}
                    className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-hover transition-colors disabled:opacity-50"
                  >
                    {ollamaStatus === "testing"
                      ? <><RefreshCw size={11} className="animate-spin" />{lang === "ko" ? "테스트 중..." : "Testing..."}</>
                      : <><FlaskConical size={11} />{lang === "ko" ? "연결 테스트" : "Test Connection"}</>
                    }
                  </button>
                </div>
              </div>
              {ollamaStatus === "ok" && (
                <div className="flex items-center gap-1.5 text-xs text-accent mb-2">
                  <CheckCircle2 size={12} />
                  {lang === "ko"
                    ? `연결 성공 · ${ollamaModelNames.length}개 모델 감지됨: ${ollamaModelNames.slice(0, 3).join(", ")}${ollamaModelNames.length > 3 ? ` 외 ${ollamaModelNames.length - 3}개` : ""}`
                    : `Connected · ${ollamaModelNames.length} models: ${ollamaModelNames.slice(0, 3).join(", ")}${ollamaModelNames.length > 3 ? ` +${ollamaModelNames.length - 3} more` : ""}`
                  }
                </div>
              )}
              {ollamaStatus === "error" && (
                <div className="flex items-center gap-1.5 text-xs text-danger mb-2">
                  <AlertCircle size={12} />
                  {lang === "ko" ? "Ollama에 연결할 수 없습니다. URL을 확인하거나 서버가 실행 중인지 확인하세요." : "Cannot reach Ollama. Check the URL or ensure the server is running."}
                </div>
              )}
              <div className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                <Info size={10} className="shrink-0" />
                <span>{lang === "ko" ? "OLLAMA_URL 환경 변수로도 설정할 수 있습니다." : "Can also be set via the OLLAMA_URL environment variable."}</span>
              </div>
            </Section>

            <Section title="OpenAI" description={lang === "ko" ? "GPT-4o, GPT-4o-mini 등 OpenAI 모델에 연결합니다." : "Connect to OpenAI models like GPT-4o."}>
              <Field label="API Key" value={openaiKey} onChange={setOpenaiKey} type="password" placeholder="sk-..." hint="platform.openai.com/api-keys" />
              <Field label="Base URL" value={openaiBase} onChange={setOpenaiBase} placeholder="https://api.openai.com/v1" hint={lang === "ko" ? "프록시 또는 호환 엔드포인트 사용 시 변경하세요." : "Change for proxy or compatible endpoints."} />
              <div className="flex items-center gap-2 mt-1">
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-hover transition-colors">
                  <FlaskConical size={11} />
                  {lang === "ko" ? "연결 테스트" : "Test Connection"}
                </button>
                {openaiKey && <span className="flex items-center gap-1 text-xs text-accent"><CheckCircle2 size={11} />설정됨</span>}
              </div>
            </Section>

            <Section title="Anthropic (Claude)" description={lang === "ko" ? "Claude Sonnet, Opus 등 Anthropic 모델에 연결합니다." : "Connect to Anthropic Claude models."}>
              <Field label="API Key" value={anthropicKey} onChange={setAnthropicKey} type="password" placeholder="sk-ant-..." hint="console.anthropic.com" />
              <div className="flex items-center gap-2 mt-1">
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-hover transition-colors">
                  <FlaskConical size={11} />
                  {lang === "ko" ? "연결 테스트" : "Test Connection"}
                </button>
                {anthropicKey && <span className="flex items-center gap-1 text-xs text-accent"><CheckCircle2 size={11} />설정됨</span>}
              </div>
            </Section>

            <Section title="Google AI (Gemini)" description={lang === "ko" ? "Gemini 3.1 Pro, Flash 등 Google AI 모델에 연결합니다." : "Connect to Google AI Gemini models (Gemini 3.1 Pro, Flash)."}>
              <Field label="API Key" value={googleAiKey} onChange={setGoogleAiKey} type="password" placeholder="AIza..." hint="aistudio.google.com/app/apikey" />
              <div className="flex items-center gap-2 mt-1">
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-hover transition-colors">
                  <FlaskConical size={11} />
                  {lang === "ko" ? "연결 테스트" : "Test Connection"}
                </button>
                {googleAiKey && <span className="flex items-center gap-1 text-xs text-accent"><CheckCircle2 size={11} />설정됨</span>}
              </div>
            </Section>

            <Section title="xAI (Grok)" description={lang === "ko" ? "Grok 4.20, Grok 4.1 등 xAI 모델에 연결합니다." : "Connect to xAI Grok models (Grok 4.20, Grok 4.1)."}>
              <Field label="API Key" value={xaiKey} onChange={setXaiKey} type="password" placeholder="xai-..." hint="console.x.ai" />
              <div className="flex items-center gap-2 mt-1">
                {xaiKey && <span className="flex items-center gap-1 text-xs text-accent"><CheckCircle2 size={11} />설정됨</span>}
              </div>
            </Section>

            <Section
              title={lang === "ko" ? "웹 검색 (Tavily)" : "Web Search (Tavily)"}
              description={lang === "ko" ? "채팅 중 실시간 웹 검색에 사용합니다. tavily.com에서 무료로 발급 가능합니다." : "Used for real-time web search during chat. Free tier available at tavily.com."}
            >
              <Field label="API Key" value={tavilyKey} onChange={setTavilyKey} type="password" placeholder="tvly-..." hint="app.tavily.com/home" />
              <div className="flex items-center gap-2 mt-1">
                <div className="flex items-center gap-1 text-xs text-text-muted">
                  <Info size={10} className="shrink-0" />
                  <span>{lang === "ko" ? "TAVILY_API_KEY 환경 변수로도 설정할 수 있습니다." : "Can also be set via TAVILY_API_KEY environment variable."}</span>
                </div>
                {tavilyKey && <span className="flex items-center gap-1 text-xs text-accent ml-auto"><CheckCircle2 size={11} />설정됨</span>}
              </div>
            </Section>

            <Section
              title={lang === "ko" ? "OpenAI 호환 (커스텀)" : "OpenAI-Compatible (Custom)"}
              description={lang === "ko" ? "LM Studio, Together AI, Groq 등 OpenAI API 호환 엔드포인트를 추가합니다." : "Add any OpenAI-compatible endpoint: LM Studio, Together AI, Groq, etc."}
            >
              <Field label={lang === "ko" ? "이름" : "Name"} value={customName} onChange={setCustomName} placeholder="e.g. Local LM Studio" />
              <Field label="Base URL" value={customBase} onChange={setCustomBase} placeholder="http://localhost:1234/v1" />
              <Field label="API Key" value={customKey} onChange={setCustomKey} type="password" placeholder={lang === "ko" ? "없으면 빈칸" : "Leave blank if not required"} />
              <div className="flex items-center gap-2 mt-1">
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-hover transition-colors">
                  <FlaskConical size={11} />
                  {lang === "ko" ? "연결 테스트" : "Test Connection"}
                </button>
              </div>
            </Section>

            <SaveBar onSave={handleSave} saved={saved} error={saveError} />
          </div>
        )}

        {/* ── Models ── */}
        {tab === "models" && (
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-2">{lang === "ko" ? "모델 허용 목록" : "Allowed Models"}</h2>
            <p className="text-xs text-text-muted mb-6">{lang === "ko" ? "체크된 모델만 유저가 선택할 수 있습니다." : "Only checked models are available for users to select."}</p>

            {/* Ollama */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                    <Server size={14} className="text-text-muted" /> Ollama
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">{lang === "ko" ? "로컬 Ollama 서버에서 실행 중인 모델" : "Models running on your local Ollama server"}</p>
                </div>
                <button
                  onClick={fetchOllamaModels}
                  disabled={ollamaModelsLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-hover transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={11} className={ollamaModelsLoading ? "animate-spin" : ""} />
                  {lang === "ko" ? "목록 새로고침" : "Refresh"}
                </button>
              </div>
              {ollamaModelsFetched && ollamaModelNames.length > 0 ? (
                <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                  {ollamaModelNames.map((name, i) => {
                    const caps = ollamaCapabilities[name] ?? [];
                    const CAP_STYLE: Record<string, string> = {
                      vision: "bg-accent/10 text-accent border-accent/20",
                      ocr:    "bg-blue-400/10 text-blue-400 border-blue-400/20",
                      tools:  "bg-yellow-400/10 text-yellow-400 border-yellow-400/20",
                      code:   "bg-green-400/10 text-green-400 border-green-400/20",
                    };
                    return (
                      <label
                        key={name}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-hover transition-colors ${i < ollamaModelNames.length - 1 ? "border-b border-border-subtle" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={ollamaEnabledModels.includes(name)}
                          onChange={() => toggleOllamaModel(name)}
                          className="accent-accent size-4 rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text-primary font-mono truncate">{name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span className="text-[10px] text-text-muted">Ollama · local</span>
                            {caps.map((cap) => (
                              <span key={cap} className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${CAP_STYLE[cap] ?? "bg-surface text-text-muted border-border"}`}>
                                {cap}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {ollamaEnabledModels.includes(name)
                            ? <span className="text-xs text-accent">Enabled</span>
                            : <span className="text-xs text-text-muted">Disabled</span>
                          }
                          <button
                            type="button"
                            onClick={() => deleteOllamaModel(name)}
                            disabled={ollamaDeleting === name}
                            className="p-1 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-40"
                            aria-label={`Delete ${name}`}
                          >
                            <Trash2 size={12} className={ollamaDeleting === name ? "animate-pulse" : ""} />
                          </button>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-4 bg-surface rounded-2xl border border-border text-xs text-text-muted">
                  <Info size={12} className="shrink-0" />
                  {lang === "ko"
                    ? "Refresh를 클릭하면 Ollama에서 모델 목록을 가져옵니다. Connections 탭에서 Ollama URL을 먼저 설정하세요."
                    : "Click Refresh to load models from Ollama. Configure the Ollama URL in the Connections tab first."}
                </div>
              )}

              {/* Pull a new model */}
              <div className="mt-4">
                <p className="text-xs font-medium text-text-secondary mb-2">
                  {lang === "ko" ? "모델 다운로드 (Pull)" : "Download Model (Pull)"}
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ollamaPullInput}
                    onChange={(e) => setOllamaPullInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") pullOllamaModel(); }}
                    placeholder="llama3.2, mistral, phi3…"
                    disabled={ollamaPulling}
                    className="flex-1 px-3 py-1.5 rounded-xl bg-base border border-border text-xs font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/10 transition disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={pullOllamaModel}
                    disabled={!ollamaPullInput.trim() || ollamaPulling}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors disabled:opacity-40"
                  >
                    <Download size={11} className={ollamaPulling ? "animate-bounce" : ""} />
                    {ollamaPulling ? (lang === "ko" ? "다운로드 중…" : "Pulling…") : (lang === "ko" ? "Pull" : "Pull")}
                  </button>
                </div>
                {ollamaPullProgress && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                      {ollamaPullProgress.pct != null && (
                        <div
                          className="h-full bg-accent transition-all duration-300 rounded-full"
                          style={{ width: `${ollamaPullProgress.pct}%` }}
                        />
                      )}
                    </div>
                    <span className="text-[10px] text-text-muted font-mono shrink-0 w-52 truncate">
                      {ollamaPullProgress.status}
                      {ollamaPullProgress.pct != null ? ` (${ollamaPullProgress.pct}%)` : ""}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Per-provider editable chip lists */}
            {([
              { name: "OpenAI",     providerModels: openaiModels,    setModels: setOpenaiModels,    input: openaiInput,    setInput: setOpenaiInput,    placeholder: "e.g. gpt-5.4-pro" },
              { name: "Anthropic",  providerModels: anthropicModels, setModels: setAnthropicModels, input: anthropicInput, setInput: setAnthropicInput, placeholder: "e.g. claude-opus-4-6" },
              { name: "Google AI",  providerModels: googleModels,    setModels: setGoogleModels,    input: googleInput,    setInput: setGoogleInput,    placeholder: "e.g. gemini-3.1-pro-preview" },
              { name: "xAI (Grok)", providerModels: xaiModels,       setModels: setXaiModels,       input: xaiInput,       setInput: setXaiInput,       placeholder: "e.g. grok-4.20" },
            ]).map(({ name, providerModels, setModels, input, setInput, placeholder }) => (
              <div key={name} className="mb-6">
                <h3 className="text-sm font-semibold text-text-primary mb-3">{name}</h3>
                <div className="bg-surface rounded-2xl border border-border p-4">
                  {/* Chip list */}
                  <div className="flex flex-wrap gap-2 mb-3 min-h-[32px]">
                    {providerModels.length === 0 && (
                      <span className="text-xs text-text-muted italic">{lang === "ko" ? "활성화된 모델 없음" : "No models enabled"}</span>
                    )}
                    {providerModels.map((id) => (
                      <span key={id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 border border-accent/20 text-xs font-mono text-accent">
                        {id}
                        <button
                          type="button"
                          onClick={() => setModels((prev) => prev.filter((m) => m !== id))}
                          className="hover:text-danger transition-colors leading-none"
                          aria-label={`Remove ${id}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  {/* Add new model ID */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && input.trim()) {
                          const id = input.trim();
                          if (!providerModels.includes(id)) setModels((prev) => [...prev, id]);
                          setInput("");
                          e.preventDefault();
                        }
                      }}
                      placeholder={placeholder}
                      className="flex-1 px-3 py-1.5 rounded-xl bg-base border border-border text-xs font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/10 transition"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const id = input.trim();
                        if (id && !providerModels.includes(id)) {
                          setModels((prev) => [...prev, id]);
                          setInput("");
                        }
                      }}
                      disabled={!input.trim()}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors disabled:opacity-40"
                    >
                      {lang === "ko" ? "추가" : "Add"}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <SaveBar onSave={handleSave} saved={saved} error={saveError} />
          </div>
        )}

        {/* ── OAuth ── */}
        {tab === "oauth" && (
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-2">{lang === "ko" ? "OAuth 설정" : "OAuth Configuration"}</h2>
            <div className="flex flex-col gap-2 p-3 rounded-xl bg-surface border border-border text-xs text-text-muted mb-6">
              <div className="flex items-center gap-2">
                <Info size={12} className="shrink-0" />
                <span className="font-medium">{lang === "ko" ? "OAuth 콜백 URL (백엔드에 등록)" : "OAuth Callback URLs (register in each provider)"}</span>
              </div>
              <div className="flex flex-col gap-1 pl-4">
                <div className="flex items-center gap-2">
                  <span className="text-text-muted w-16">Google:</span>
                  <code className="font-mono text-text-secondary bg-base px-2 py-0.5 rounded-lg">{instanceUrl}/api/v1/auth/oauth/google/callback</code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-text-muted w-16">GitHub:</span>
                  <code className="font-mono text-text-secondary bg-base px-2 py-0.5 rounded-lg">{instanceUrl}/api/v1/auth/oauth/github/callback</code>
                </div>
              </div>
            </div>

            <Section title="Google OAuth" description={lang === "ko" ? "Google 계정으로 로그인을 허용합니다." : "Allow sign in with Google accounts."}>
              <Toggle checked={googleEnabled} onChange={setGoogleEnabled} label={lang === "ko" ? "Google OAuth 활성화" : "Enable Google OAuth"} />
              {googleEnabled && (
                <div className="mt-3">
                  <Field label="Client ID" value={googleClientId} onChange={setGoogleClientId} placeholder="*.apps.googleusercontent.com" hint="Google Cloud Console → APIs & Services → Credentials" />
                  <Field label="Client Secret" value={googleClientSecret} onChange={setGoogleClientSecret} placeholder="GOCSPX-..." type="password" />
                </div>
              )}
            </Section>

            <Section title="GitHub OAuth" description={lang === "ko" ? "GitHub 계정으로 로그인을 허용합니다." : "Allow sign in with GitHub accounts."}>
              <Toggle checked={githubEnabled} onChange={setGithubEnabled} label={lang === "ko" ? "GitHub OAuth 활성화" : "Enable GitHub OAuth"} />
              {githubEnabled && (
                <div className="mt-3">
                  <Field label="Client ID" value={githubClientId} onChange={setGithubClientId} placeholder="Ov23li..." hint="GitHub → Settings → Developer settings → OAuth Apps" />
                  <Field label="Client Secret" value={githubClientSecret} onChange={setGithubClientSecret} placeholder="..." type="password" />
                </div>
              )}
            </Section>

            <SaveBar onSave={handleSave} saved={saved} error={saveError} />
          </div>
        )}

        {/* ── Features ── */}
        {tab === "features" && (
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-4">{lang === "ko" ? "기능 설정" : "Features"}</h2>

            {hasToolsCapability && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-yellow-400/5 border border-yellow-400/20 text-xs text-yellow-300 mb-6">
                <Info size={12} className="shrink-0 mt-0.5" />
                <span>
                  {lang === "ko"
                    ? `활성화된 Ollama 모델 중 Function Calling(도구 사용)을 지원하는 모델이 있습니다: ${ollamaEnabledModels.filter((n) => (ollamaCapabilities[n] ?? []).includes("tools")).join(", ")}. 웹 검색 기능을 활성화하면 해당 모델이 자동으로 도구를 호출합니다.`
                    : `Tool-use (function calling) capable Ollama models are enabled: ${ollamaEnabledModels.filter((n) => (ollamaCapabilities[n] ?? []).includes("tools")).join(", ")}. Enable Web Search to let these models call tools automatically.`
                  }
                </span>
              </div>
            )}

            <Section title={lang === "ko" ? "채팅" : "Chat"}>
              <Toggle checked={webSearch}  onChange={setWebSearch}  label={lang === "ko" ? "웹 검색"         : "Web Search"}        description={lang === "ko" ? "채팅에서 실시간 웹 검색을 허용합니다."              : "Allow real-time web search from chat."} />
              <Toggle checked={fileUpload} onChange={setFileUpload} label={lang === "ko" ? "파일 업로드"     : "File Upload"}       description={lang === "ko" ? "이미지 및 파일 첨부를 허용합니다."                : "Allow image and file attachments."} />
              <Toggle checked={tempChat}   onChange={setTempChat}   label={lang === "ko" ? "임시 채팅"       : "Temporary Chats"}   description={lang === "ko" ? "유저가 저장되지 않는 임시 채팅을 시작할 수 있습니다." : "Allow users to start temporary chats that aren't saved."} />
              <Toggle checked={memories}   onChange={setMemories}   label={lang === "ko" ? "메모리 (Beta)"   : "Memories (Beta)"}   description={lang === "ko" ? "LLM이 대화에서 기억할 사항을 저장합니다."        : "Allow the LLM to remember facts across conversations."} />
            </Section>

            <Section title={lang === "ko" ? "계정" : "Account"}>
              <Toggle checked={userApiKeys}  onChange={setUserApiKeys}  label={lang === "ko" ? "유저 API 키 허용" : "User API Keys"}  description={lang === "ko" ? "유저가 자신의 LLM API 키를 설정할 수 있습니다." : "Allow users to configure their own LLM API keys."} />
              <Toggle checked={userWebhooks} onChange={setUserWebhooks} label={lang === "ko" ? "유저 웹훅"       : "User Webhooks"}  description={lang === "ko" ? "유저가 알림 웹훅 URL을 설정할 수 있습니다."   : "Allow users to configure notification webhook URLs."} />
            </Section>

            <Section title={lang === "ko" ? "커뮤니티" : "Community"}>
              <Toggle checked={communitySharing} onChange={setCommunitySharing} label={lang === "ko" ? "대화 공유"  : "Community Sharing"} description={lang === "ko" ? "유저가 대화를 공개 링크로 공유할 수 있습니다." : "Allow users to share conversations via public link."} />
              <Toggle checked={messageRating}    onChange={setMessageRating}    label={lang === "ko" ? "메시지 평가" : "Message Rating"}    description={lang === "ko" ? "유저가 AI 응답에 좋아요/싫어요를 누를 수 있습니다." : "Allow users to rate AI responses."} />
            </Section>

            <SaveBar onSave={handleSave} saved={saved} error={saveError} />
          </div>
        )}

        {/* ── Documents (RAG) ── */}
        {tab === "documents" && (
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-2">{lang === "ko" ? "문서 / RAG 설정" : "Documents (RAG)"}</h2>
            <p className="text-xs text-text-muted mb-6">{lang === "ko" ? "문서 검색 증강 생성(RAG) 파이프라인을 설정합니다." : "Configure the Retrieval-Augmented Generation (RAG) pipeline."}</p>

            <Section title={lang === "ko" ? "임베딩" : "Embedding"} description={lang === "ko" ? "텍스트를 벡터로 변환하는 모델을 설정합니다." : "Configure the model used to convert text to vectors."}>
              <div className="mb-4">
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{lang === "ko" ? "임베딩 엔진" : "Embedding Engine"}</label>
                <div className="flex gap-2">
                  {([
                    { val: "openai" as const, label: "OpenAI" },
                    { val: "ollama" as const, label: "Ollama" },
                  ]).map((e) => (
                    <button key={e.val} onClick={() => setEmbeddingEngine(e.val)}
                      className={`px-4 py-2 rounded-xl text-sm border transition-colors ${
                        embeddingEngine === e.val ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
              <Field
                label={lang === "ko" ? "임베딩 모델" : "Embedding Model"}
                value={embeddingModel}
                onChange={setEmbeddingModel}
                placeholder={embeddingEngine === "openai" ? "text-embedding-3-small" : "nomic-embed-text"}
                hint={embeddingEngine === "openai" ? "text-embedding-3-small · text-embedding-3-large · text-embedding-ada-002" : "nomic-embed-text · mxbai-embed-large"}
              />
            </Section>

            <Section title={lang === "ko" ? "청크 설정" : "Chunking"} description={lang === "ko" ? "문서를 나누는 크기와 중첩을 설정합니다." : "Configure how documents are split into chunks."}>
              <Slider label={lang === "ko" ? "청크 크기" : "Chunk Size"} value={chunkSize} onChange={setChunkSize} min={500} max={4000} step={100} hint={lang === "ko" ? "각 청크의 최대 문자 수입니다." : "Maximum characters per chunk."} />
              <Slider label={lang === "ko" ? "오버랩" : "Chunk Overlap"} value={chunkOverlap} onChange={setChunkOverlap} min={0} max={500} step={50} hint={lang === "ko" ? "청크 간 중첩 문자 수입니다." : "Overlapping characters between chunks."} />
              <Slider label={lang === "ko" ? "Top-K (반환 청크 수)" : "Top-K"} value={topK} onChange={setTopK} min={1} max={20} step={1} hint={lang === "ko" ? "쿼리당 반환할 청크 수입니다." : "Number of chunks to retrieve per query."} />
            </Section>

            <Section title={lang === "ko" ? "고급 검색" : "Advanced Search"}>
              <Toggle checked={hybridSearch} onChange={setHybridSearch} label={lang === "ko" ? "하이브리드 검색" : "Hybrid Search"} description={lang === "ko" ? "벡터 검색과 키워드 검색(BM25)을 결합합니다." : "Combine vector search with keyword search (BM25)."} />
              <div className="pt-3">
                <label className="block text-xs font-medium text-text-secondary mb-2">OCR {lang === "ko" ? "엔진" : "Engine"}</label>
                {(hasVisionCapability || hasOcrCapability) && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-accent/5 border border-accent/20 text-xs text-accent mb-2">
                    <Info size={12} className="shrink-0 mt-0.5" />
                    <span>
                      {lang === "ko"
                        ? `활성화된 Ollama 모델 중 이미지 인식(vision/ocr) 모델이 있습니다: ${ollamaEnabledModels.filter((n) => (ollamaCapabilities[n] ?? []).some((c) => c === "vision" || c === "ocr")).join(", ")}. 해당 모델로 이미지 내 텍스트를 직접 추출할 수 있습니다.`
                        : `Vision-capable Ollama models are enabled: ${ollamaEnabledModels.filter((n) => (ollamaCapabilities[n] ?? []).some((c) => c === "vision" || c === "ocr")).join(", ")}. These models can extract text from images directly.`
                      }
                    </span>
                  </div>
                )}
                <div className="flex gap-2">
                  {([
                    { val: "none"      as const, label: lang === "ko" ? "없음" : "None" },
                    { val: "tesseract" as const, label: "Tesseract" },
                  ]).map((e) => (
                    <button key={e.val} onClick={() => setOcrEngine(e.val)}
                      className={`px-3 py-1.5 rounded-xl text-xs border transition-colors ${
                        ocrEngine === e.val ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            <Section title={lang === "ko" ? "위험 영역" : "Danger Zone"} description={lang === "ko" ? "벡터 DB를 초기화하면 모든 임베딩이 삭제됩니다." : "Resetting the vector DB removes all embeddings."}>
              {vectorDbResetConfirm ? (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-danger flex-1">{lang === "ko" ? "정말 초기화하시겠습니까? 되돌릴 수 없습니다." : "Are you sure? This cannot be undone."}</p>
                  <button onClick={() => setVectorDbResetConfirm(false)} className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-hover">
                    {lang === "ko" ? "취소" : "Cancel"}
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-danger text-white hover:opacity-90">
                    <Trash2 size={12} />{lang === "ko" ? "초기화" : "Reset"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setVectorDbResetConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-danger/30 text-danger hover:bg-danger/10 transition-colors"
                >
                  <AlertCircle size={14} />
                  {lang === "ko" ? "벡터 DB 초기화" : "Reset Vector DB"}
                </button>
              )}
            </Section>

            <SaveBar onSave={handleSave} saved={saved} error={saveError} />
          </div>
        )}

        {/* ── Audio ── */}
        {tab === "audio" && (
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-2">{lang === "ko" ? "오디오 설정" : "Audio"}</h2>
            <p className="text-xs text-text-muted mb-6">
              {lang === "ko"
                ? "서버사이드 STT/TTS 엔진과 API 키를 설정합니다. 음성 선택·속도·언어 등 개인 설정은 각 사용자의 설정 모달에서 관리합니다."
                : "Configure server-side STT/TTS engines and API keys. Voice, speed, and language preferences are managed per user in the user Settings modal."}
            </p>

            <Section title={lang === "ko" ? "음성 입력 (STT)" : "Speech to Text (STT)"} description={lang === "ko" ? "서버에서 사용할 STT 엔진을 선택합니다." : "Select the STT engine available to all users."}>
              <div className="mb-4">
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{lang === "ko" ? "STT 공급자" : "STT Provider"}</label>
                <div className="flex gap-2">
                  {([
                    { val: "none"   as const, label: lang === "ko" ? "비활성화" : "Disabled" },
                    { val: "openai" as const, label: "OpenAI Whisper" },
                  ]).map((e) => (
                    <button key={e.val} onClick={() => setSttProvider(e.val)}
                      className={`px-3 py-2 rounded-xl text-sm border transition-colors ${
                        sttProvider === e.val ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
              {sttProvider !== "none" && (
                <Field label="API Key" value={sttApiKey} onChange={setSttApiKey} type="password" placeholder="sk-..." hint={lang === "ko" ? "Connections의 OpenAI 키를 공유 사용하려면 빈칸으로 둡니다." : "Leave blank to reuse the OpenAI key from Connections."} />
              )}
            </Section>

            <Section title={lang === "ko" ? "음성 출력 (TTS)" : "Text to Speech (TTS)"} description={lang === "ko" ? "서버에서 사용할 TTS 엔진을 선택합니다." : "Select the TTS engine available to all users."}>
              <div className="mb-4">
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{lang === "ko" ? "TTS 공급자" : "TTS Provider"}</label>
                <div className="flex gap-2">
                  {([
                    { val: "none"   as const, label: lang === "ko" ? "비활성화" : "Disabled" },
                    { val: "openai" as const, label: "OpenAI TTS" },
                  ]).map((e) => (
                    <button key={e.val} onClick={() => setTtsProvider(e.val)}
                      className={`px-3 py-2 rounded-xl text-sm border transition-colors ${
                        ttsProvider === e.val ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
              {ttsProvider !== "none" && (
                <Field label="API Key" value={ttsApiKey} onChange={setTtsApiKey} type="password" placeholder="sk-..." hint={lang === "ko" ? "Connections의 OpenAI 키를 공유 사용하려면 빈칸으로 둡니다." : "Leave blank to reuse the OpenAI key from Connections."} />
              )}
            </Section>

            <SaveBar onSave={handleSave} saved={saved} error={saveError} />
          </div>
        )}

        {/* ── Images ── */}
        {tab === "images" && (
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-2">{lang === "ko" ? "이미지 생성 및 편집" : "Image Generation & Editing"}</h2>
            <p className="text-xs text-text-muted mb-6">
              {lang === "ko"
                ? "Umai 편집기의 이미지 생성(텍스트→이미지) 및 인페인팅·편집 엔진을 설정합니다."
                : "Configure image generation (text-to-image) and inpainting/editing engines for the Umai editor."}
            </p>

            <Section title={lang === "ko" ? "이미지 엔진" : "Engine"} description={lang === "ko" ? "생성과 편집 모두에 사용되는 엔진입니다." : "Used for both generation and editing operations."}>
              <div className="grid grid-cols-2 gap-2 mb-1">
                {([
                  { val: "none"    as const, label: lang === "ko" ? "비활성화" : "Disabled",   badge: "", edit: false },
                  { val: "openai"  as const, label: "DALL·E (OpenAI)",                           badge: "Cloud", edit: true },
                  { val: "comfyui" as const, label: "ComfyUI",                                   badge: "Local", edit: true },
                  { val: "a1111"   as const, label: "Automatic1111",                             badge: "Local", edit: true },
                ]).map((e) => (
                  <button key={e.val} onClick={() => setImageEngine(e.val)}
                    className={`flex flex-col items-start px-3 py-2.5 rounded-xl text-xs border transition-colors ${
                      imageEngine === e.val ? "border-accent/50 bg-accent/5 text-accent" : "border-border text-text-secondary hover:border-accent/30"
                    }`}
                  >
                    <span className="font-medium">{e.label}</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {e.badge && <span className={`text-[10px] ${imageEngine === e.val ? "text-accent/70" : "text-text-muted"}`}>{e.badge}</span>}
                      {e.edit && <span className={`text-[10px] px-1 rounded ${imageEngine === e.val ? "text-accent/70 bg-accent/10" : "text-text-muted bg-hover"}`}>{lang === "ko" ? "편집 지원" : "Edit ✓"}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </Section>

            {imageEngine === "openai" && (
              <Section title="DALL·E (OpenAI)" description={lang === "ko" ? "OpenAI의 DALL·E API를 사용한 이미지 생성 및 편집입니다." : "Image generation and editing using OpenAI's DALL·E API."}>
                <Field label="OpenAI API Key" value={dalleApiKey} onChange={setDalleApiKey} placeholder="sk-..." type="password" hint={lang === "ko" ? "Connections의 OpenAI 키를 공유하려면 빈칸으로 둡니다." : "Leave blank to reuse the OpenAI key from Connections."} />
                <div className="mb-4">
                  <label className="block text-xs font-medium text-text-secondary mb-2">{lang === "ko" ? "생성 모델" : "Generation Model"}</label>
                  <div className="flex gap-2">
                    {(["dall-e-2", "dall-e-3"]).map((m) => (
                      <button key={m} onClick={() => setDalleModel(m)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                          dalleModel === m ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-accent/5 border border-accent/15 text-xs text-text-secondary">
                  <p className="font-medium text-text-primary mb-1">{lang === "ko" ? "편집 기능" : "Editing Capabilities"}</p>
                  <ul className="space-y-0.5 text-text-muted">
                    <li>• {lang === "ko" ? "인페인팅 (DALL·E 2): 마스크 영역을 프롬프트로 채우기" : "Inpainting (DALL·E 2): Fill masked areas with a prompt"}</li>
                    <li>• {lang === "ko" ? "이미지 변형 (DALL·E 2): 기존 이미지의 변형 생성" : "Variations (DALL·E 2): Generate variations of an existing image"}</li>
                    <li>• {lang === "ko" ? "DALL·E 3는 생성 전용입니다." : "DALL·E 3 is generation-only."}</li>
                  </ul>
                </div>
              </Section>
            )}

            {imageEngine === "comfyui" && (
              <Section title="ComfyUI" description={lang === "ko" ? "로컬 ComfyUI 서버에 연결합니다. 생성 및 img2img 인페인팅을 지원합니다." : "Connect to a local ComfyUI server. Supports generation and img2img inpainting."}>
                <Field label="ComfyUI Base URL" value={comfyuiUrl} onChange={setComfyuiUrl} placeholder="http://127.0.0.1:8188" hint={lang === "ko" ? "ComfyUI 서버가 실행 중이어야 합니다." : "ComfyUI server must be running."} />
                <div className="p-3 rounded-xl bg-accent/5 border border-accent/15 text-xs text-text-secondary">
                  <p className="font-medium text-text-primary mb-1">{lang === "ko" ? "편집 기능" : "Editing Capabilities"}</p>
                  <ul className="space-y-0.5 text-text-muted">
                    <li>• {lang === "ko" ? "txt2img: 텍스트 프롬프트로 이미지 생성" : "txt2img: Generate images from text prompts"}</li>
                    <li>• {lang === "ko" ? "img2img: 기존 이미지를 프롬프트로 변형" : "img2img: Transform existing images with prompts"}</li>
                    <li>• {lang === "ko" ? "인페인팅: 마스크 영역을 AI로 채우기" : "Inpainting: Fill masked areas with AI"}</li>
                    <li>• {lang === "ko" ? "업스케일: 이미지 해상도 향상" : "Upscaling: Enhance image resolution"}</li>
                  </ul>
                </div>
              </Section>
            )}

            {imageEngine === "a1111" && (
              <Section title="Automatic1111" description={lang === "ko" ? "로컬 A1111 Stable Diffusion WebUI에 연결합니다. 생성 및 인페인팅을 지원합니다." : "Connect to a local A1111 WebUI. Supports generation and inpainting."}>
                <Field label="A1111 Base URL" value={a1111Url} onChange={setA1111Url} placeholder="http://127.0.0.1:7860" hint={lang === "ko" ? "--api 플래그로 실행해야 합니다." : "Must be running with the --api flag."} />
                <div className="p-3 rounded-xl bg-accent/5 border border-accent/15 text-xs text-text-secondary">
                  <p className="font-medium text-text-primary mb-1">{lang === "ko" ? "편집 기능" : "Editing Capabilities"}</p>
                  <ul className="space-y-0.5 text-text-muted">
                    <li>• {lang === "ko" ? "txt2img: 텍스트 프롬프트로 이미지 생성" : "txt2img: Generate images from text prompts"}</li>
                    <li>• {lang === "ko" ? "img2img: 기존 이미지를 프롬프트로 변형" : "img2img: Transform existing images with prompts"}</li>
                    <li>• {lang === "ko" ? "인페인팅: 마스크로 영역 편집" : "Inpainting: Edit regions using a mask"}</li>
                    <li>• {lang === "ko" ? "아웃페인팅: 이미지 캔버스 확장" : "Outpainting: Extend the image canvas"}</li>
                  </ul>
                </div>
              </Section>
            )}

            <SaveBar onSave={handleSave} saved={saved} error={saveError} />
          </div>
        )}

        {/* ── Evaluations ── */}
        {tab === "evaluations" && (
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-2">{lang === "ko" ? "평가 설정" : "Evaluations"}</h2>
            <p className="text-xs text-text-muted mb-6">{lang === "ko" ? "AI 응답 품질 평가 및 피드백 수집 설정입니다." : "Configure AI response quality evaluation and feedback collection."}</p>

            <Section title={lang === "ko" ? "평점 수집" : "Rating Collection"}>
              <Toggle checked={evalMessageRating} onChange={setEvalMessageRating} label={lang === "ko" ? "메시지 평점 활성화" : "Enable Message Rating"} description={lang === "ko" ? "유저가 각 AI 응답에 👍/👎 평점을 남길 수 있습니다." : "Allow users to rate AI responses with thumbs up/down."} />
              <Toggle checked={arenaMode} onChange={setArenaMode} label={lang === "ko" ? "Arena 모드" : "Arena Mode"} description={lang === "ko" ? "같은 질문에 대한 두 모델의 응답을 A/B로 비교합니다. 유저가 선호하는 응답을 선택합니다." : "Compare responses from two models side-by-side. Users vote for the better response."} />
            </Section>

            <Section title={lang === "ko" ? "데이터 내보내기" : "Data Export"} description={lang === "ko" ? "수집된 평가 데이터를 내보냅니다." : "Export collected evaluation data."}>
              <div className="flex flex-col gap-2">
                <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover transition-colors w-fit">
                  <Download size={14} />
                  {lang === "ko" ? "평점 데이터 내보내기 (CSV)" : "Export Ratings (CSV)"}
                </button>
                {arenaMode && (
                  <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover transition-colors w-fit">
                    <Download size={14} />
                    {lang === "ko" ? "Arena 결과 내보내기 (CSV)" : "Export Arena Results (CSV)"}
                  </button>
                )}
              </div>
            </Section>

            {evalMessageRating && (
              <Section title={lang === "ko" ? "요약 통계" : "Summary Statistics"} description={lang === "ko" ? "수집된 평점 요약입니다." : "Summary of collected ratings."}>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { label: lang === "ko" ? "총 평점" : "Total Ratings",   value: "—" },
                    { label: lang === "ko" ? "긍정 비율" : "Positive Rate",  value: "—" },
                    { label: lang === "ko" ? "참여 유저" : "Users Rated",    value: "—" },
                  ]).map((stat) => (
                    <div key={stat.label} className="bg-base rounded-xl border border-border p-3 text-center">
                      <p className="text-lg font-bold text-text-primary">{stat.value}</p>
                      <p className="text-xs text-text-muted mt-0.5">{stat.label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-text-muted mt-3 flex items-center gap-1.5">
                  <Info size={10} />
                  {lang === "ko" ? "통계는 백엔드 API 연결 후 표시됩니다." : "Statistics will display once connected to the backend API."}
                </p>
              </Section>
            )}

            <SaveBar onSave={handleSave} saved={saved} error={saveError} />
          </div>
        )}

        {/* ── Database ── */}
        {tab === "database" && (
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-6">{lang === "ko" ? "데이터베이스" : "Database"}</h2>

            <Section title={lang === "ko" ? "내보내기" : "Export"} description={lang === "ko" ? "데이터를 백업합니다." : "Back up your data."}>
              <div className="flex flex-col gap-2">
                <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover transition-colors w-fit">
                  <Download size={14} />
                  {lang === "ko" ? "모든 유저 채팅 내보내기 (JSON)" : "Export All Chats (JSON)"}
                </button>
                <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover transition-colors w-fit">
                  <Download size={14} />
                  {lang === "ko" ? "유저 목록 내보내기 (CSV)" : "Export Users (CSV)"}
                </button>
                <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover transition-colors w-fit">
                  <Download size={14} />
                  {lang === "ko" ? "설정 내보내기 (JSON)" : "Export Config (JSON)"}
                </button>
              </div>
            </Section>

            <Section title={lang === "ko" ? "가져오기" : "Import"} description={lang === "ko" ? "이전에 내보낸 데이터를 가져옵니다." : "Restore from a previous export."}>
              <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover transition-colors w-fit cursor-pointer">
                <Upload size={14} />
                {lang === "ko" ? "설정 가져오기 (.json)" : "Import Config (.json)"}
                <input type="file" accept=".json" className="hidden" />
              </label>
            </Section>

            <Section title={lang === "ko" ? "유지 관리" : "Maintenance"} description={lang === "ko" ? "데이터베이스 정리 작업입니다." : "Database cleanup operations."}>
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover transition-colors w-fit">
                <RefreshCw size={14} />
                {lang === "ko" ? "고아 세션 정리" : "Clean Orphaned Sessions"}
              </button>
            </Section>

            <Section title={lang === "ko" ? "위험 영역" : "Danger Zone"} description={lang === "ko" ? "되돌릴 수 없는 작업입니다." : "These actions cannot be undone."}>
              <div className="flex flex-col gap-2">
                <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-danger/30 text-danger hover:bg-danger/10 transition-colors w-fit">
                  <AlertCircle size={14} />
                  {lang === "ko" ? "모든 채팅 아카이브" : "Archive All Chats"}
                </button>
                <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-danger/30 text-danger hover:bg-danger/10 transition-colors w-fit">
                  <AlertCircle size={14} />
                  {lang === "ko" ? "모든 채팅 삭제" : "Delete All Chats (All Users)"}
                </button>
              </div>
            </Section>
          </div>
        )}

      </div>
    </div>
  );
}
