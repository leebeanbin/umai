"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import {
  X, Check, Info,
  Monitor, Volume2, User, Database, HelpCircle, LogOut, Download, Trash2,
  Settings2,
} from "lucide-react";
import {
  loadSettings, saveSettings,
  loadModels,
  FALLBACK_MODELS,
  type LangOverride,
  type DynamicModel,
} from "@/lib/appStore";
import { loadSessions, saveSessions, saveFolders } from "@/lib/store";
import { applyTheme } from "@/components/providers/ThemeProvider";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { apiUpdateProfile } from "@/lib/api/backendClient";
import { type TranslationKey } from "@/lib/i18n";

type Tab = "general" | "interface" | "audio" | "data" | "account" | "about";
type Props = { open: boolean; onClose: () => void };

type Params = {
  temperature:  number | null;
  maxTokens:    number | null;
  systemPrompt: string;
};

const PARAM_DEFAULTS = { temperature: 0.8, maxTokens: 1280 };

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border-subtle last:border-0">
      <div className="flex-1 mr-4">
        <p className="text-sm text-text-primary">{label}</p>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
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

export default function SettingsModal({ open, onClose }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, open);
  const [tab, setTab]     = useState<Tab>("general");
  const [saved, setSaved] = useState(false);
  const [inputLang, setInputLang]   = useState<LangOverride>("auto");
  const [outputLang, setOutputLang] = useState<LangOverride>("auto");

  const [models, setModels]       = useState<DynamicModel[]>([]);
  const [selectedModel, setModel] = useState("gpt-4o");

  const [params, setParams] = useState<Params>({
    temperature: null, maxTokens: null, systemPrompt: "",
  });

  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const { lang, setLang, t } = useLanguage();
  const { user, logout } = useAuth();

  // Interface toggles
  const [chatBubble, setChatBubble]           = useState(false);
  const [widescreenMode, setWidescreenMode]   = useState(false);
  const [streamResponse, setStreamResponse]   = useState(true);
  const [collapseCode, setCollapseCode]       = useState(false);
  const [tempChatDefault, setTempChatDefault] = useState(false);

  // Audio
  const [sttEngine, setSttEngine] = useState<"none" | "whisper">("none");
  const [sttLang, setSttLang]     = useState("auto");
  const [ttsEngine, setTtsEngine] = useState<"none" | "openai">("none");
  const [ttsVoice, setTtsVoice]   = useState("alloy");
  const [ttsSpeed, setTtsSpeed]   = useState(1.0);
  const [autoSend, setAutoSend]   = useState(false);

  // Data
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Account profile edit
  const [editName, setEditName]   = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError]   = useState("");

  const displayModels = useMemo(
    () => (models.length > 0 ? models : FALLBACK_MODELS),
    [models],
  );

  const modelsByProvider = useMemo(
    () => displayModels.reduce<Record<string, DynamicModel[]>>((acc, m) => {
      (acc[m.provider] ??= []).push(m);
      return acc;
    }, {}),
    [displayModels],
  );

  useEffect(() => {
    if (!open) return;
    const s = loadSettings();
    setModel(s.selectedModel);
    setParams({ temperature: s.temperature, maxTokens: s.maxTokens, systemPrompt: s.systemPrompt });
    setTheme(s.theme);
    setInputLang(s.inputLang ?? "auto");
    setOutputLang(s.outputLang ?? "auto");
    setModels(loadModels());
    setDeleteConfirm(false);
    // Sync profile fields from current user
    if (user) {
      setEditName(user.name ?? "");
      setEditEmail(user.notification_email ?? user.email ?? "");
    }
    setProfileError("");
  }, [open, user]);

  if (!open) return null;

  function handleSave() {
    saveSettings({
      selectedModel, temperature: params.temperature, maxTokens: params.maxTokens,
      systemPrompt: params.systemPrompt, theme,
      inputLang, outputLang,
    });
    applyTheme(theme);
    window.dispatchEvent(new Event("umai:theme-change"));
    window.dispatchEvent(new Event("umai:settings-change"));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleExport() {
    const sessions = loadSessions();
    const messages: Record<string, unknown[]> = {};
    sessions.forEach((s) => {
      const raw = localStorage.getItem(`umai_msgs_${s.id}`);
      if (raw) { try { messages[s.id] = JSON.parse(raw); } catch { /* ignore */ } }
    });
    const data = { exportedAt: new Date().toISOString(), sessions, messages };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `umai-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleProfileSave() {
    if (!editName.trim()) { setProfileError(lang === "ko" ? "이름은 비울 수 없습니다." : "Name cannot be empty."); return; }
    setProfileSaving(true);
    setProfileError("");
    try {
      await apiUpdateProfile({ name: editName.trim(), notification_email: editEmail.trim() || undefined });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setProfileError(lang === "ko" ? "저장에 실패했습니다." : "Failed to save profile.");
    } finally {
      setProfileSaving(false);
    }
  }

  function handleDeleteAll() {
    const sessions = loadSessions();
    sessions.forEach((s) => localStorage.removeItem(`umai_msgs_${s.id}`));
    saveSessions([]);
    saveFolders([]);
    window.dispatchEvent(new Event("umai:sessions-change"));
    setDeleteConfirm(false);
    onClose();
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "general",   label: lang === "ko" ? "일반"       : "General",   icon: <Settings2 size={14} /> },
    { id: "interface", label: lang === "ko" ? "인터페이스" : "Interface", icon: <Monitor size={14} /> },
    { id: "audio",     label: lang === "ko" ? "오디오"     : "Audio",     icon: <Volume2 size={14} /> },
    { id: "data",      label: t("settings.tab.data"),                      icon: <Database size={14} /> },
    { id: "account",   label: t("settings.tab.account"),                   icon: <User size={14} /> },
    { id: "about",     label: t("settings.tab.about"),                     icon: <HelpCircle size={14} /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={modalRef} className="w-full max-w-2xl bg-elevated/98 backdrop-blur-sm border border-border rounded-3xl shadow-2xl flex flex-col max-h-[88vh] animate-modal">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-text-primary">{t("settings.title")}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:bg-hover transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Sidebar */}
          <div className="w-44 shrink-0 border-r border-border py-3 px-2 flex flex-col gap-0.5 overflow-y-auto scrollbar-none">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                  tab === t.id
                    ? "bg-accent/10 text-accent font-medium"
                    : "text-text-secondary hover:bg-hover hover:text-text-primary"
                }`}
              >
                <span className={tab === t.id ? "text-accent" : "text-text-muted"}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">

            {/* ── General ── */}
            {tab === "general" && (
              <div className="flex flex-col gap-6">
                <Section title={lang === "ko" ? "기본 모델" : "Default Model"}>
                  <div className="flex flex-col gap-2">
                    {Object.entries(modelsByProvider).map(([providerName, providerModels]) => (
                      <div key={providerName}>
                        <p className="text-xs font-medium text-text-muted mb-1.5 px-0.5">{providerName}</p>
                        <div className="flex flex-col gap-1 mb-2">
                          {providerModels.map((m) => (
                            <label key={m.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${
                              selectedModel === m.id ? "border-accent/50 bg-accent/5" : "border-border hover:border-accent/30"
                            }`}>
                              <input type="radio" name="defaultModel" value={m.id} checked={selectedModel === m.id} onChange={() => setModel(m.id)} className="accent-accent" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-text-primary font-medium truncate">{m.name}</div>
                                <div className="text-xs text-text-muted font-mono">{m.id}</div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title={lang === "ko" ? "시스템 프롬프트" : "System Prompt"}>
                  <p className="text-xs text-text-muted mb-2">{lang === "ko" ? "모든 대화에 기본으로 적용되는 지시사항입니다." : "Instructions applied to all conversations by default."}</p>
                  <textarea
                    value={params.systemPrompt}
                    onChange={(e) => setParams((p) => ({ ...p, systemPrompt: e.target.value }))}
                    rows={4}
                    placeholder={lang === "ko" ? "예: 항상 한국어로 답변해주세요." : "e.g. Always respond concisely and in bullet points."}
                    className="w-full resize-vertical px-3 py-2.5 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors leading-relaxed"
                  />
                </Section>

                <Section title={lang === "ko" ? "파라미터" : "Parameters"}>
                  <ParamRow
                    label="Temperature"
                    tooltip="Creativity / randomness (0 = deterministic, 2 = creative)"
                    value={params.temperature}
                    defaultVal={PARAM_DEFAULTS.temperature}
                    min={0} max={2} step={0.05}
                    onChange={(v) => setParams((p) => ({ ...p, temperature: v }))}
                  />
                  <ParamRow
                    label="Max Tokens"
                    tooltip="Maximum response length"
                    value={params.maxTokens}
                    defaultVal={PARAM_DEFAULTS.maxTokens}
                    min={64} max={16384} step={64}
                    onChange={(v) => setParams((p) => ({ ...p, maxTokens: v }))}
                    integer
                  />
                </Section>
              </div>
            )}

            {/* ── Interface ── */}
            {tab === "interface" && (
              <div className="flex flex-col gap-6">
                <Section title={t("settings.theme")}>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { val: "dark"   as const, label: t("settings.theme.dark"),   preview: "bg-gray-900" },
                      { val: "light"  as const, label: t("settings.theme.light"),  preview: "bg-gray-100" },
                      { val: "system" as const, label: t("settings.theme.system"), preview: "bg-gradient-to-r from-gray-900 to-gray-100" },
                    ]).map((item) => (
                      <button
                        key={item.val}
                        onClick={() => { setTheme(item.val); applyTheme(item.val); }}
                        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-colors ${
                          theme === item.val ? "border-accent/50 bg-accent/5" : "border-border hover:border-accent/30"
                        }`}
                      >
                        <div className={`w-full h-8 rounded-lg ${item.preview} border border-border`} />
                        <span className={`text-xs font-medium ${theme === item.val ? "text-accent" : "text-text-secondary"}`}>{item.label}</span>
                        {theme === item.val && <Check size={12} className="text-accent -mt-1" />}
                      </button>
                    ))}
                  </div>
                </Section>

                <Section title={t("settings.language")}>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {([{ val: "ko" as const, label: "한국어" }, { val: "en" as const, label: "English" }]).map((l) => (
                      <button
                        key={l.val}
                        onClick={() => setLang(l.val)}
                        className={`px-4 py-2.5 rounded-xl text-sm border transition-colors ${
                          lang === l.val ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs font-medium text-text-secondary mb-1">{t("settings.inputLang")}</p>
                  <p className="text-xs text-text-muted mb-2">{t("settings.inputLangNote")}</p>
                  <LangSelect value={inputLang} onChange={setInputLang} t={t} />
                  <p className="text-xs font-medium text-text-secondary mb-1 mt-4">{t("settings.outputLang")}</p>
                  <p className="text-xs text-text-muted mb-2">{t("settings.outputLangNote")}</p>
                  <LangSelect value={outputLang} onChange={setOutputLang} t={t} />
                </Section>

                <Section title={lang === "ko" ? "채팅 UI" : "Chat UI"}>
                  <Toggle checked={chatBubble}      onChange={setChatBubble}      label={lang === "ko" ? "채팅 말풍선 UI"     : "Chat Bubble UI"}        description={lang === "ko" ? "메시지를 말풍선 스타일로 표시합니다."         : "Show messages in bubble style."} />
                  <Toggle checked={widescreenMode}  onChange={setWidescreenMode}  label={lang === "ko" ? "와이드스크린 모드"   : "Widescreen Mode"}       description={lang === "ko" ? "채팅 영역을 전체 너비로 확장합니다."          : "Expand chat area to full width."} />
                  <Toggle checked={streamResponse}  onChange={setStreamResponse}  label={lang === "ko" ? "스트림 응답"         : "Stream Response"}       description={lang === "ko" ? "응답을 실시간으로 표시합니다."                : "Display responses as they stream in."} />
                  <Toggle checked={collapseCode}    onChange={setCollapseCode}    label={lang === "ko" ? "코드 블록 기본 접기" : "Collapse Code Blocks"}  description={lang === "ko" ? "코드 블록을 기본적으로 접어서 표시합니다."     : "Collapse code blocks by default."} />
                  <Toggle checked={tempChatDefault} onChange={setTempChatDefault} label={lang === "ko" ? "임시 채팅 기본값"    : "Temp Chat by Default"}  description={lang === "ko" ? "새 채팅을 기본적으로 임시 대화로 시작합니다." : "Start new chats as temporary by default."} />
                </Section>
              </div>
            )}

            {/* ── Audio ── */}
            {tab === "audio" && (
              <div className="flex flex-col gap-6">
                <p className="text-xs text-text-muted">
                  {lang === "ko"
                    ? "음성 입력(STT) 및 음성 출력(TTS) 설정입니다. 관리자가 활성화한 엔진만 사용할 수 있습니다."
                    : "Configure speech-to-text and text-to-speech. Only engines enabled by your admin are available."}
                </p>

                <Section title={lang === "ko" ? "음성 입력 (STT)" : "Speech to Text (STT)"}>
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">{lang === "ko" ? "엔진" : "Engine"}</label>
                    <div className="flex gap-2">
                      {([
                        { val: "none"    as const, label: lang === "ko" ? "비활성화" : "Disabled" },
                        { val: "whisper" as const, label: "Whisper (OpenAI)" },
                      ]).map((e) => (
                        <button key={e.val} onClick={() => setSttEngine(e.val)}
                          className={`px-3 py-1.5 rounded-xl text-xs border transition-colors ${
                            sttEngine === e.val ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                          }`}
                        >
                          {e.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {sttEngine !== "none" && (
                    <div className="mb-3">
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">{lang === "ko" ? "언어" : "Language"}</label>
                      <div className="flex gap-2">
                        {([
                          { val: "auto", label: lang === "ko" ? "자동 감지" : "Auto detect" },
                          { val: "ko",   label: "한국어" },
                          { val: "en",   label: "English" },
                        ]).map((l) => (
                          <button key={l.val} onClick={() => setSttLang(l.val)}
                            className={`px-3 py-1.5 rounded-xl text-xs border transition-colors ${
                              sttLang === l.val ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                            }`}
                          >
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <Toggle checked={autoSend} onChange={setAutoSend}
                    label={lang === "ko" ? "음성 인식 후 자동 전송" : "Auto-send after recognition"}
                    description={lang === "ko" ? "음성 인식이 완료되면 자동으로 메시지를 전송합니다." : "Automatically send the message after voice recognition completes."}
                  />
                </Section>

                <Section title={lang === "ko" ? "음성 출력 (TTS)" : "Text to Speech (TTS)"}>
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">{lang === "ko" ? "엔진" : "Engine"}</label>
                    <div className="flex gap-2">
                      {([
                        { val: "none"   as const, label: lang === "ko" ? "비활성화" : "Disabled" },
                        { val: "openai" as const, label: "OpenAI TTS" },
                      ]).map((e) => (
                        <button key={e.val} onClick={() => setTtsEngine(e.val)}
                          className={`px-3 py-1.5 rounded-xl text-xs border transition-colors ${
                            ttsEngine === e.val ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                          }`}
                        >
                          {e.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {ttsEngine !== "none" && (
                    <>
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">{lang === "ko" ? "음성" : "Voice"}</label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).map((v) => (
                            <button key={v} onClick={() => setTtsVoice(v)}
                              className={`px-2 py-1.5 rounded-xl text-xs border transition-colors capitalize ${
                                ttsVoice === v ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                              }`}
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-medium text-text-secondary">{lang === "ko" ? "속도" : "Speed"}</label>
                          <span className="text-xs font-mono text-text-primary">{ttsSpeed.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range" min={0.25} max={4} step={0.25} value={ttsSpeed}
                          onChange={(e) => setTtsSpeed(Number(e.target.value))}
                          className="w-full h-1.5 rounded-full cursor-pointer accent-accent"
                        />
                        <div className="flex justify-between text-[10px] text-text-muted mt-1">
                          <span>0.25x</span><span>4.0x</span>
                        </div>
                      </div>
                    </>
                  )}
                </Section>
              </div>
            )}

            {/* ── Data ── */}
            {tab === "data" && (
              <div className="flex flex-col gap-4">
                <p className="text-xs text-text-muted">{lang === "ko" ? "대화 데이터를 관리합니다." : "Manage your conversation data."}</p>

                <div className="p-4 bg-surface rounded-xl border border-border">
                  <p className="text-sm font-medium text-text-primary mb-1">{lang === "ko" ? "대화 내보내기" : "Export Chats"}</p>
                  <p className="text-xs text-text-muted mb-3">{lang === "ko" ? "모든 대화와 메시지를 JSON 파일로 내보냅니다." : "Download all chats and messages as a JSON file."}</p>
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover transition-colors"
                  >
                    <Download size={14} />
                    {lang === "ko" ? "JSON으로 내보내기" : "Export as JSON"}
                  </button>
                </div>

                <div className="p-4 bg-surface rounded-xl border border-danger/20">
                  <p className="text-sm font-medium text-text-primary mb-1">{lang === "ko" ? "모든 대화 삭제" : "Delete All Chats"}</p>
                  <p className="text-xs text-text-muted mb-3">{lang === "ko" ? "모든 대화와 폴더가 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다." : "Permanently deletes all chats and folders. This cannot be undone."}</p>
                  {deleteConfirm ? (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-danger flex-1">{lang === "ko" ? "정말 삭제하시겠습니까?" : "Are you sure?"}</p>
                      <button onClick={() => setDeleteConfirm(false)} className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-hover transition-colors">
                        {lang === "ko" ? "취소" : "Cancel"}
                      </button>
                      <button onClick={handleDeleteAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-danger text-white hover:opacity-90 transition-opacity">
                        <Trash2 size={12} />
                        {lang === "ko" ? "삭제" : "Delete"}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteConfirm(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-danger/30 text-danger hover:bg-danger/10 transition-colors">
                      <Trash2 size={14} />
                      {lang === "ko" ? "모든 대화 삭제" : "Delete All Chats"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Account ── */}
            {tab === "account" && (
              <div className="flex flex-col gap-5">
                {user ? (
                  <>
                    <div className="flex items-center gap-4 p-4 bg-surface rounded-2xl border border-border">
                      <div className="size-12 rounded-full bg-accent/15 border border-accent/20 flex items-center justify-center text-lg font-bold text-accent shrink-0">
                        {user.avatar_url
                          ? <Image src={user.avatar_url} alt={user.name} width={48} height={48} className="size-12 rounded-full object-cover" />
                          : user.name.charAt(0).toUpperCase()
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate">{user.name}</p>
                        <p className="text-xs text-text-muted truncate">{user.email}</p>
                        {user.oauth_provider && (
                          <span className="inline-flex items-center gap-1 mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-hover border border-border text-text-muted capitalize">
                            {user.oauth_provider} 계정
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Profile edit form */}
                    <div className="flex flex-col gap-3 p-4 bg-surface rounded-2xl border border-border">
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                        {lang === "ko" ? "프로필 편집" : "Edit Profile"}
                      </p>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-text-muted">{lang === "ko" ? "이름" : "Name"}</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder={lang === "ko" ? "이름 입력" : "Enter name"}
                          className="w-full px-3 py-2 rounded-xl text-sm bg-elevated border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-text-muted">{lang === "ko" ? "알림 이메일" : "Notification email"}</label>
                        <input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          placeholder={user?.email ?? ""}
                          className="w-full px-3 py-2 rounded-xl text-sm bg-elevated border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                        />
                        <p className="text-[10px] text-text-muted px-0.5">{lang === "ko" ? "비워두면 로그인 이메일로 대체됩니다." : "Leave blank to use login email."}</p>
                      </div>
                      {profileError && <p className="text-xs text-danger">{profileError}</p>}
                      <button
                        onClick={handleProfileSave}
                        disabled={profileSaving}
                        className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-accent/10 border border-accent/20 text-accent hover:bg-accent/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {profileSaving
                          ? (lang === "ko" ? "저장 중…" : "Saving…")
                          : (lang === "ko" ? "프로필 저장" : "Save Profile")}
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => { onClose(); logout(); }}
                        className="flex items-center gap-2 w-full px-4 py-3 rounded-xl border border-danger/20 bg-danger/5 hover:bg-danger/10 text-danger text-sm font-medium transition-colors"
                      >
                        <LogOut size={14} />
                        {t("auth.logout")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <User size={32} className="text-text-muted mb-3" />
                    <p className="text-sm text-text-secondary">{lang === "ko" ? "로그인이 필요합니다." : "Please sign in to view account settings."}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── About ── */}
            {tab === "about" && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-4 p-4 bg-surface rounded-2xl border border-border">
                  <div className="size-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-xl font-bold text-accent shrink-0">
                    U
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Umai-bin</p>
                    <p className="text-xs text-text-muted">v0.1.0 · Chat-based AI image editor</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 text-xs text-text-muted">
                  <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                    <span className="text-text-secondary">{lang === "ko" ? "프론트엔드" : "Frontend"}</span>
                    <span>Next.js 16 · React 19 · Tailwind CSS v4</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                    <span className="text-text-secondary">{lang === "ko" ? "백엔드" : "Backend"}</span>
                    <span>FastAPI · PostgreSQL · Redis</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                    <span className="text-text-secondary">{lang === "ko" ? "AI 모델" : "AI Models"}</span>
                    <span>OpenAI · Anthropic · Google</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-text-secondary">{lang === "ko" ? "벤치마크" : "Inspired by"}</span>
                    <span>Open WebUI · Linear · Vercel</span>
                  </div>
                </div>
                <p className="text-xs text-text-muted text-center pt-2">
                  © {new Date().getFullYear()} Umai-bin. All rights reserved.
                </p>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-hover transition-colors">
            {t("settings.close")}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium text-white bg-accent hover:bg-accent-hover transition-colors"
          >
            {saved ? <><Check size={14} />{t("settings.saved")}</> : t("settings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  );
}

// ── Language select ───────────────────────────────────────────────────────────
function LangSelect({ value, onChange, t }: {
  value: LangOverride; onChange: (v: LangOverride) => void;
  t: (k: TranslationKey) => string;
}) {
  const opts: { val: LangOverride; label: string }[] = [
    { val: "auto", label: t("settings.lang.auto") },
    { val: "en",   label: t("settings.lang.en") },
    { val: "ko",   label: t("settings.lang.ko") },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {opts.map((o) => (
        <button key={o.val} onClick={() => onChange(o.val)}
          className={`px-3 py-2 rounded-xl text-xs border transition-colors ${
            value === o.val ? "bg-accent/10 border-accent/30 text-accent font-medium" : "border-border text-text-secondary hover:bg-hover"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Parameter row ─────────────────────────────────────────────────────────────
function ParamRow({ label, tooltip, value, defaultVal, min, max, step, onChange, integer }: {
  label: string; tooltip: string; value: number | null; defaultVal: number;
  min: number; max: number; step: number; onChange: (v: number | null) => void; integer?: boolean;
}) {
  const { t } = useLanguage();
  const isCustom = value !== null;
  const display  = isCustom ? value : defaultVal;

  return (
    <div className="py-1 w-full">
      <div className="flex w-full justify-between items-center">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-secondary">{label}</span>
          <span title={tooltip} className="text-text-muted cursor-help"><Info size={10} /></span>
        </div>
        <button
          type="button"
          onClick={() => onChange(isCustom ? null : defaultVal)}
          className={`px-2.5 py-0.5 rounded text-xs transition-colors outline-none shrink-0 ${
            isCustom ? "text-accent bg-accent/10 border border-accent/20" : "text-text-muted hover:text-text-secondary"
          }`}
        >
          {isCustom ? t("settings.custom") : t("settings.default")}
        </button>
      </div>
      {isCustom && (
        <div className="flex mt-1.5 gap-2 items-center">
          <div className="flex-1">
            <input
              type="range" min={min} max={max} step={step} value={display}
              onChange={(e) => onChange(Number(e.target.value))}
              className="w-full h-1.5 rounded-full cursor-pointer accent-accent"
              style={{ background: `linear-gradient(to right, var(--color-accent) ${((display - min) / (max - min)) * 100}%, var(--color-border) ${((display - min) / (max - min)) * 100}%)` }}
            />
          </div>
          <input
            type="number" min={min} max={max} step={step} value={display}
            onChange={(e) => {
              const v = integer ? parseInt(e.target.value) : parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
            }}
            className="bg-transparent text-center w-16 text-xs font-mono text-text-primary border border-border rounded-lg py-1 outline-none focus:border-accent transition-colors"
          />
        </div>
      )}
    </div>
  );
}

