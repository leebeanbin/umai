"use client";

import { useEffect, useState } from "react";
import { Search, Plus, X, Code2, Check, ToggleLeft, ToggleRight, Copy } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { type TranslationKey } from "@/lib/i18n";
import {
  loadWs,
  syncWorkspaceFromBackend,
  createWorkspaceItem,
  updateWorkspaceItem,
  deleteWorkspaceItem,
} from "@/lib/workspaceStore";
import { type WorkspaceItem } from "@/lib/api/backendClient";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch {
    return Promise.reject();
  }
}

type Skill = {
  id: string;
  name: string;
  description: string;
  language: "javascript" | "python";
  code: string;
  enabled: boolean;
  builtin: boolean;
  createdAt: string;
};

const INITIAL_SKILLS: Skill[] = [
  {
    id: "s1",
    name: "Image Resize",
    description: "자동으로 업로드 이미지를 최대 2048px로 리사이즈합니다",
    language: "javascript",
    code: `// Resize uploaded image to max 2048px
function resizeImage(imageDataUrl, maxSize = 2048) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = imageDataUrl;
  });
}`,
    enabled: true,
    builtin: true,
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
  {
    id: "s2",
    name: "Prompt Enhancer",
    description: "편집 지시문에 자동으로 기술적 세부사항을 추가합니다",
    language: "javascript",
    code: `// Auto-enhance edit prompts with technical details
function enhancePrompt(prompt) {
  const suffixes = [
    'photorealistic, high detail',
    'seamless blending, natural lighting',
    'preserve original composition',
  ];
  return prompt + '. ' + suffixes.join(', ');
}`,
    enabled: false,
    builtin: true,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
];

const LOCAL_KEY = "skills";

const LANG_COLORS: Record<string, string> = {
  javascript: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  python:     "text-blue-400 bg-blue-400/10 border-blue-400/20",
};

function toLocal(item: WorkspaceItem): Skill {
  const d = item.data as Record<string, unknown>;
  return {
    id: item.id,
    name: item.name,
    description: (d.description as string) ?? "",
    language: (d.language as Skill["language"]) ?? "javascript",
    code: (d.code as string) ?? "",
    enabled: item.is_enabled,
    builtin: (d.builtin as boolean) ?? false,
    createdAt: item.created_at,
  };
}

function applyPatch(skill: Skill, patch: { is_enabled?: boolean }): Skill {
  return { ...skill, enabled: patch.is_enabled ?? skill.enabled };
}

export default function SkillsPage() {
  const { t } = useLanguage();
  const [query, setQuery]           = useState("");
  const [skills, setSkills]         = useState<Skill[]>(() =>
    loadWs<Skill>(LOCAL_KEY, INITIAL_SKILLS)
  );
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId]     = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [form, setForm]             = useState({
    name: "", description: "", language: "javascript" as "javascript" | "python", code: "",
  });
  const [saving, setSaving]         = useState(false);

  const { user, loading: authLoading } = useAuth();
  useEffect(() => {
    if (authLoading || !user) return;
    syncWorkspaceFromBackend("skill", LOCAL_KEY, toLocal, INITIAL_SKILLS).then(setSkills);
  }, [user, authLoading]);

  const filtered = skills.filter((s) =>
    !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.description.toLowerCase().includes(query.toLowerCase())
  );

  async function toggleSkill(skill: Skill) {
    try {
      const updated = await updateWorkspaceItem(
        skill.id,
        { is_enabled: !skill.enabled },
        LOCAL_KEY,
        toLocal,
        skills,
        applyPatch,
      );
      setSkills(updated);
    } catch {
      setMutationError("스킬 상태 변경에 실패했습니다");
    }
  }

  async function handleCreate() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setMutationError(null);
    try {
      const updated = await createWorkspaceItem(
        "skill",
        form.name.trim(),
        { description: form.description, language: form.language, code: form.code, builtin: false },
        LOCAL_KEY,
        toLocal,
        skills,
      );
      setSkills(updated);
      setForm({ name: "", description: "", language: "javascript", code: "" });
      setShowCreate(false);
    } catch {
      setMutationError("스킬 생성에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    const prev = skills;
    try {
      const updated = await deleteWorkspaceItem(id, LOCAL_KEY, skills);
      setSkills(updated);
    } catch {
      setSkills(prev);
      setMutationError("스킬 삭제에 실패했습니다");
    }
  }

  function handleCopy(skill: Skill) {
    copyToClipboard(skill.code).then(() => {
      setCopiedId(skill.id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {});
  }

  const builtins = filtered.filter((s) => s.builtin);
  const custom   = filtered.filter((s) => !s.builtin);

  return (
    <div className="flex flex-col gap-1 mt-4">
      <ConfirmModal
        open={deleteTarget !== null}
        message="이 스킬을 삭제하시겠습니까?"
        confirmLabel="삭제"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      {mutationError && (
        <div className="mb-2 px-3 py-2 rounded-xl bg-danger/10 border border-danger/20 text-xs text-danger flex items-center justify-between">
          <span>{mutationError}</span>
          <button onClick={() => setMutationError(null)} className="ml-2 hover:opacity-70"><X size={12} /></button>
        </div>
      )}
      <div className="flex justify-between items-center mb-3 px-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">{t("workspace.skills")}</h2>
          <span className="text-base text-text-muted">{skills.length}</span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-2 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-medium flex items-center gap-1 transition"
        >
          <Plus size={13} strokeWidth={2.5} />
          <span className="hidden sm:block text-xs">{t("workspace.createNew")}</span>
        </button>
      </div>

      <div className="py-2 bg-surface rounded-3xl border border-border/30">
        <div className="px-3.5 flex items-center w-full gap-2 py-0.5 pb-2 border-b border-border-subtle">
          <Search size={13} className="text-text-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("workspace.search")}
            className="w-full text-sm py-1 outline-none bg-transparent text-text-primary placeholder:text-text-muted"
          />
          {query && (
            <button onClick={() => setQuery("")} className="p-0.5 rounded-full hover:bg-hover transition">
              <X size={12} className="text-text-muted" />
            </button>
          )}
        </div>

        <div className="px-3 mt-3">
          {/* Built-in */}
          {builtins.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest px-1 mb-2">
                {t("workspace.builtin")}
              </p>
              <div className="flex flex-col gap-1">
                {builtins.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    copiedId={copiedId}
                    onToggle={() => toggleSkill(skill)}
                    onCopy={() => handleCopy(skill)}
                    onDelete={() => setDeleteTarget(skill.id)}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom */}
          {custom.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest px-1 mb-2">
                {t("workspace.custom")}
              </p>
              <div className="flex flex-col gap-1">
                {custom.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    copiedId={copiedId}
                    onToggle={() => toggleSkill(skill)}
                    onCopy={() => handleCopy(skill)}
                    onDelete={() => setDeleteTarget(skill.id)}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}

          {filtered.length === 0 && (
            <p className="text-xs text-text-muted py-6 text-center">{t("workspace.noItems")}</p>
          )}
        </div>
      </div>

      {/* 생성 모달 */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}
        >
          <div className="w-full max-w-lg bg-elevated border border-border rounded-2xl shadow-2xl animate-modal">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">{t("workspace.newSkill")}</h3>
              <button onClick={() => setShowCreate(false)} className="p-1.5 rounded-lg text-text-muted hover:bg-hover transition">
                <X size={15} />
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    {t("common.name")} <span className="text-red-400">{t("common.required")}</span>
                  </label>
                  <input
                    autoFocus
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder={t("workspace.ph.skillName")}
                    className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("workspace.skillLang")}</label>
                  <select
                    value={form.language}
                    onChange={(e) => setForm((p) => ({ ...p, language: e.target.value as "javascript" | "python" }))}
                    className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary outline-none focus:border-accent transition-colors"
                  >
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("common.description")}</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder={t("workspace.ph.skillDesc")}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  {t("workspace.skillCode")}
                  <span className="ml-1.5 text-text-muted font-normal font-mono text-[10px]">
                    {form.language === "javascript" ? "function mySkill() { ... }" : "def my_skill(): ..."}
                  </span>
                </label>
                <textarea
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                  rows={8}
                  placeholder={t("workspace.ph.skillCode")}
                  className="w-full resize-none px-3 py-2.5 rounded-xl bg-base border border-border text-xs text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-accent transition-colors leading-relaxed"
                  spellCheck={false}
                />
              </div>
            </div>

            {mutationError && (
              <p className="px-5 pb-2 text-xs text-danger">{mutationError}</p>
            )}
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-hover transition">
                {t("common.cancel")}
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim() || saving}
                className="px-5 py-2 rounded-full text-sm font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-50 transition"
              >
                {t("common.create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill, copiedId, onToggle, onCopy, onDelete, t }: {
  skill: Skill;
  copiedId: string | null;
  onToggle: () => void;
  onCopy: () => void;
  onDelete: () => void;
  t: (key: TranslationKey) => string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`group flex flex-col gap-2 transition rounded-2xl w-full p-3 hover:bg-hover cursor-default ${skill.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className={`size-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${skill.enabled ? "bg-accent/10 border border-accent/20" : "bg-hover border border-border"}`}>
            <Code2 size={14} className={skill.enabled ? "text-accent" : "text-text-muted"} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-text-primary truncate">{skill.name}</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${LANG_COLORS[skill.language]}`}>
                {skill.language}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{skill.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={onCopy}
            title="Copy code"
            className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-secondary transition"
          >
            {copiedId === skill.id ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            title="View code"
            className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-secondary transition text-[10px] font-mono"
          >
            {"</>"}
          </button>
          <button
            onClick={onToggle}
            title={skill.enabled ? t("workspace.skillDisable") : t("workspace.skillEnable")}
            className="p-1 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-secondary transition"
          >
            {skill.enabled
              ? <ToggleRight size={18} className="text-accent" />
              : <ToggleLeft size={18} />}
          </button>
          {!skill.builtin && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-red-400 transition"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {expanded && skill.code && (
        <pre className="mt-1 p-3 rounded-xl bg-base border border-border text-[11px] font-mono text-text-secondary overflow-x-auto leading-relaxed whitespace-pre-wrap">
          {skill.code}
        </pre>
      )}
    </div>
  );
}
