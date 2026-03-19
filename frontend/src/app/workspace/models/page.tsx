"use client";

import { useEffect, useState } from "react";
import { Search, Plus, X, ExternalLink } from "lucide-react";
import { loadModels } from "@/lib/appStore";
import { loadWs, saveWs } from "@/lib/workspaceStore";
import { useLanguage } from "@/components/providers/LanguageProvider";

type CustomModel = {
  id: string;
  name: string;
  baseModel: string;
  systemPrompt: string;
  description: string;
  createdAt: Date;
};

const INITIAL_CUSTOM: CustomModel[] = [
  {
    id: "cm1",
    name: "상품 사진 전문가",
    baseModel: "gpt-4o",
    systemPrompt: "당신은 상품 사진 편집 전문가입니다. 항상 구체적이고 실행 가능한 지시를 한국어로 제공하세요.",
    description: "상품 사진 편집에 최적화된 커스텀 모델",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3),
  },
];

export default function ModelsPage() {
  const { t } = useLanguage();
  const [query, setQuery]             = useState("");
  const [customModels, setCustom]     = useState<CustomModel[]>(() => loadWs<CustomModel>("custom-models", INITIAL_CUSTOM));

  useEffect(() => { saveWs("custom-models", customModels); }, [customModels]);
  const [showCreate, setShowCreate]   = useState(false);
  const [form, setForm]               = useState({ name: "", baseModel: "gpt-4o", systemPrompt: "", description: "" });
  const [builtinModels]               = useState(() => loadModels());

  const filteredBase = builtinModels.filter(
    (m) => !query || m.name.toLowerCase().includes(query.toLowerCase()) || m.provider.toLowerCase().includes(query.toLowerCase())
  );
  const filteredCustom = customModels.filter(
    (m) => !query || m.name.toLowerCase().includes(query.toLowerCase())
  );

  function handleCreate() {
    if (!form.name.trim()) return;
    setCustom((prev) => [...prev, {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      baseModel: form.baseModel,
      systemPrompt: form.systemPrompt,
      description: form.description,
      createdAt: new Date(),
    }]);
    setForm({ name: "", baseModel: "gpt-4o", systemPrompt: "", description: "" });
    setShowCreate(false);
  }

  return (
    <div className="flex flex-col gap-1 mt-4">
      {/* 헤더 */}
      <div className="flex justify-between items-center mb-3 px-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">{t("workspace.models")}</h2>
          <span className="text-base text-text-muted">{builtinModels.length + customModels.length}</span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-2 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-medium flex items-center gap-1 transition"
        >
          <Plus size={13} strokeWidth={2.5} />
          <span className="hidden sm:block text-xs">{t("workspace.createNew")}</span>
        </button>
      </div>

      {/* 검색 + 목록 컨테이너 */}
      <div className="py-2 bg-surface rounded-3xl border border-border/30">
        {/* 검색 */}
        <div className="px-3.5 flex flex-1 items-center w-full gap-2 py-0.5 pb-2 border-b border-border-subtle">
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

        {/* 기본 제공 모델 섹션 */}
        <div className="px-3 mt-2 mb-1">
          <p className="text-xs font-medium text-text-muted mb-1.5 px-0.5">{t("workspace.builtinModels")}</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {filteredBase.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 transition rounded-2xl w-full p-2.5 hover:bg-hover cursor-default"
              >
                <div className={`size-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${
                  m.provider === "OpenAI" ? "bg-gray-700" :
                  m.provider === "Google" ? "bg-blue-600" :
                  m.provider === "Anthropic" ? "bg-orange-600" : "bg-accent"
                }`}>
                  {m.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{m.name}</div>
                  <div className="text-xs text-text-muted">{m.provider}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {m.tags.map((tag) => (
                    <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent/70 border border-accent/15">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 커스텀 모델 섹션 */}
        {filteredCustom.length > 0 && (
          <div className="px-3 mt-3 border-t border-border-subtle pt-3">
            <p className="text-xs font-medium text-text-muted mb-1.5 px-0.5">{t("workspace.customModels")}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {filteredCustom.map((m) => (
                <div
                  key={m.id}
                  className="group flex items-center gap-3 transition rounded-2xl w-full p-2.5 hover:bg-hover cursor-default"
                >
                  <div className="size-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-xs font-bold text-accent shrink-0">
                    {m.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{m.name}</div>
                    <div className="text-xs text-text-muted truncate">{m.description || m.baseModel}</div>
                  </div>
                  <button
                    onClick={() => setCustom((prev) => prev.filter((c) => c.id !== m.id))}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/5 text-text-muted hover:text-red-400 transition"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 새로 만들기 생성 모달 */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}
        >
          <div className="w-full max-w-md bg-elevated border border-border rounded-2xl shadow-2xl animate-modal flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">{t("workspace.newModel")}</h3>
              <button onClick={() => setShowCreate(false)} className="p-1.5 rounded-lg text-text-muted hover:bg-hover transition">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("workspace.modelName")} {t("common.required")}</label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder={t("workspace.ph.modelName")}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("workspace.baseModel")}</label>
                <select
                  value={form.baseModel}
                  onChange={(e) => setForm((p) => ({ ...p, baseModel: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary outline-none focus:border-accent transition-colors"
                >
                  {builtinModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("workspace.systemPrompt")}</label>
                <textarea
                  value={form.systemPrompt}
                  onChange={(e) => setForm((p) => ({ ...p, systemPrompt: e.target.value }))}
                  rows={4}
                  placeholder={t("workspace.ph.modelPrompt")}
                  className="w-full resize-none px-3 py-2.5 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors leading-relaxed"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("common.description")}</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder={t("workspace.ph.modelDesc")}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-hover transition">{t("common.cancel")}</button>
              <button onClick={handleCreate} disabled={!form.name.trim()} className="px-5 py-2 rounded-full text-sm font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-50 transition">
                {t("common.create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
