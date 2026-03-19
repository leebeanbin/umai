"use client";

import { useEffect, useState } from "react";
import { Search, Plus, X, Globe, Code2, Zap, Wrench } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import {
  loadWs,
  syncWorkspaceFromBackend,
  createWorkspaceItem,
  updateWorkspaceItem,
  deleteWorkspaceItem,
} from "@/lib/workspaceStore";
import { type WorkspaceItem } from "@/lib/api/backendClient";

type Tool = {
  id: string;
  name: string;
  description: string;
  type: "builtin" | "custom";
  enabled: boolean;
  icon: "web" | "code" | "zap" | "wrench";
};

const INITIAL_TOOLS: Tool[] = [
  { id: "t1", name: "웹 검색",    description: "실시간 웹 검색으로 최신 정보 활용",   type: "builtin", enabled: true,  icon: "web" },
  { id: "t2", name: "코드 실행기", description: "Python 코드 실행 및 데이터 분석",     type: "builtin", enabled: false, icon: "code" },
  { id: "t3", name: "이미지 생성", description: "텍스트로 이미지 생성 (DALL-E 3)",     type: "builtin", enabled: false, icon: "zap" },
];

const LOCAL_KEY = "tools";

const ICON_MAP = {
  web:    <Globe   size={16} className="text-sky-400" />,
  code:   <Code2   size={16} className="text-green-400" />,
  zap:    <Zap     size={16} className="text-yellow-400" />,
  wrench: <Wrench  size={16} className="text-text-muted" />,
};

function toLocal(item: WorkspaceItem): Tool {
  const d = item.data as Record<string, string>;
  return {
    id: item.id,
    name: item.name,
    description: d.description ?? "",
    type: (d.type as Tool["type"]) ?? "custom",
    enabled: item.is_enabled,
    icon: (d.icon as Tool["icon"]) ?? "wrench",
  };
}

function applyPatch(tool: Tool, patch: { is_enabled?: boolean }): Tool {
  return { ...tool, enabled: patch.is_enabled ?? tool.enabled };
}

export default function ToolsPage() {
  const { t } = useLanguage();
  const [query, setQuery]           = useState("");
  const [tools, setTools]           = useState<Tool[]>(() =>
    loadWs<Tool>(LOCAL_KEY, INITIAL_TOOLS)
  );
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState({ name: "", description: "" });
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    syncWorkspaceFromBackend("tool", LOCAL_KEY, toLocal, INITIAL_TOOLS).then(setTools);
  }, []);

  const filtered = tools.filter((tool) =>
    !query || tool.name.toLowerCase().includes(query.toLowerCase())
  );

  async function toggleTool(tool: Tool) {
    const updated = await updateWorkspaceItem(
      tool.id,
      { is_enabled: !tool.enabled },
      LOCAL_KEY,
      toLocal,
      tools,
      applyPatch,
    );
    setTools(updated);
  }

  async function handleCreate() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    const updated = await createWorkspaceItem(
      "tool",
      form.name.trim(),
      { description: form.description, type: "custom", icon: "wrench" },
      LOCAL_KEY,
      toLocal,
      tools,
    );
    setTools(updated);
    setForm({ name: "", description: "" });
    setShowCreate(false);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const updated = await deleteWorkspaceItem(id, LOCAL_KEY, tools);
    setTools(updated);
  }

  return (
    <div className="flex flex-col gap-1 mt-4">
      <div className="flex justify-between items-center mb-3 px-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">{t("workspace.tools")}</h2>
          <span className="text-base text-text-muted">{tools.length}</span>
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

        <div className="px-3 mt-2 grid gap-1 sm:grid-cols-2">
          {filtered.map((tool) => (
            <div key={tool.id} className="group flex items-center gap-3 transition rounded-2xl w-full p-3 hover:bg-hover">
              <div className="size-9 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0">
                {ICON_MAP[tool.icon]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary truncate">{tool.name}</span>
                  {tool.type === "builtin" && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted">{t("workspace.builtin")}</span>
                  )}
                </div>
                <p className="text-xs text-text-muted line-clamp-1">{tool.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {tool.type === "custom" && (
                  <button
                    onClick={() => handleDelete(tool.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-red-400 transition"
                  >
                    <X size={13} />
                  </button>
                )}
                {/* 토글 스위치 */}
                <button
                  onClick={() => toggleTool(tool)}
                  title={tool.enabled ? t("workspace.toolDisable") : t("workspace.toolEnable")}
                  className={`flex items-center h-[1.125rem] min-h-[1.125rem] w-8 shrink-0 cursor-pointer rounded-full px-0.5 mx-px transition-colors outline outline-1 ${
                    tool.enabled ? "bg-accent outline-accent/50" : "bg-hover outline-border"
                  }`}
                >
                  <span className={`pointer-events-none block size-3 shrink-0 rounded-full bg-white transition-transform shadow-sm ${
                    tool.enabled ? "translate-x-3.5" : "translate-x-0"
                  }`} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 생성 모달 */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}
        >
          <div className="w-full max-w-md bg-elevated border border-border rounded-2xl shadow-2xl animate-modal">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">{t("workspace.newTool")}</h3>
              <button onClick={() => setShowCreate(false)} className="p-1.5 rounded-lg text-text-muted hover:bg-hover transition">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("common.name")} <span className="text-red-400">{t("common.required")}</span></label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder={t("workspace.ph.toolName")}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("common.description")}</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder={t("workspace.ph.toolDesc")}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                />
              </div>
              <p className="text-xs text-text-muted bg-surface/50 px-3 py-2 rounded-xl border border-border">
                {t("workspace.toolApiNote")}
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-hover transition">{t("common.cancel")}</button>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim() || saving}
                className="px-5 py-2 rounded-full text-sm font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-50 transition"
              >
                {t("common.add")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
