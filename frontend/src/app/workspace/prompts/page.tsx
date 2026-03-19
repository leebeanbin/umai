"use client";

import { useEffect, useState } from "react";
import { Search, Plus, X, Copy, Check } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { loadWs, saveWs } from "@/lib/workspaceStore";

type Prompt = {
  id: string;
  command: string;   // /command 형식
  title: string;
  content: string;
  createdAt: Date;
};

const INITIAL_PROMPTS: Prompt[] = [
  { id: "p1", command: "/배경교체", title: "배경 교체",    content: "선택된 영역의 배경을 {{배경 설명}}으로 자연스럽게 교체해줘. 피사체의 경계를 최대한 보존하고, 조명과 그림자가 어울리게 합성해줘.", createdAt: new Date(Date.now() - 86400000 * 2) },
  { id: "p2", command: "/리터칭",   title: "피부 리터칭",  content: "선택 영역의 피부를 자연스럽게 리터칭해줘. 잡티와 주름을 줄이되 지나치게 인위적이지 않게 해줘.", createdAt: new Date(Date.now() - 86400000) },
  { id: "p3", command: "/스타일",   title: "스타일 변환",  content: "선택 영역을 {{스타일}} 스타일로 변환해줘. 원본의 구도와 피사체 형태는 최대한 유지해줘.", createdAt: new Date() },
];

export default function PromptsPage() {
  const { t } = useLanguage();
  const [query, setQuery]           = useState("");
  const [prompts, setPrompts]       = useState<Prompt[]>(() => loadWs<Prompt>("prompts", INITIAL_PROMPTS));

  useEffect(() => { saveWs("prompts", prompts); }, [prompts]);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId]     = useState<string | null>(null);
  const [form, setForm]             = useState({ command: "", title: "", content: "" });

  const filtered = prompts.filter((p) =>
    !query || p.title.toLowerCase().includes(query.toLowerCase()) || p.command.includes(query.toLowerCase())
  );

  function handleCreate() {
    if (!form.title.trim() || !form.content.trim()) return;
    const command = form.command.startsWith("/") ? form.command : `/${form.command}`;
    setPrompts((prev) => [...prev, { id: crypto.randomUUID(), command, title: form.title.trim(), content: form.content.trim(), createdAt: new Date() }]);
    setForm({ command: "", title: "", content: "" });
    setShowCreate(false);
  }

  function handleCopy(p: Prompt) {
    navigator.clipboard.writeText(p.content);
    setCopiedId(p.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="flex flex-col gap-1 mt-4">
      <div className="flex justify-between items-center mb-3 px-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">{t("workspace.prompts")}</h2>
          <span className="text-base text-text-muted">{prompts.length}</span>
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
          {query && <button onClick={() => setQuery("")} className="p-0.5 rounded-full hover:bg-hover transition"><X size={12} className="text-text-muted" /></button>}
        </div>

        <div className="px-3 mt-2 grid gap-1 sm:grid-cols-2">
          {filtered.length === 0 ? (
            <p className="text-xs text-text-muted py-4 text-center col-span-2">{t("workspace.noItems")}</p>
          ) : filtered.map((p) => (
            <div key={p.id} className="group flex flex-col gap-1.5 transition rounded-2xl w-full p-3 hover:bg-hover cursor-default">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded-md">{p.command}</span>
                    <span className="text-sm font-medium text-text-primary truncate">{p.title}</span>
                  </div>
                  <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">{p.content}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => handleCopy(p)} className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-secondary transition">
                    {copiedId === p.id ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
                  </button>
                  <button onClick={() => setPrompts((prev) => prev.filter((x) => x.id !== p.id))} className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-red-400 transition">
                    <X size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 생성 모달 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
          <div className="w-full max-w-md bg-elevated border border-border rounded-2xl shadow-2xl animate-modal">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">{t("workspace.newPrompt")}</h3>
              <button onClick={() => setShowCreate(false)} className="p-1.5 rounded-lg text-text-muted hover:bg-hover transition"><X size={15} /></button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("workspace.command")}</label>
                  <input autoFocus value={form.command} onChange={(e) => setForm((p) => ({ ...p, command: e.target.value }))} placeholder="/bg-replace" className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("workspace.promptTitle")} {t("common.required")}</label>
                  <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder={t("workspace.ph.promptTitle")} className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("workspace.promptContent")} {t("common.required")}<span className="ml-1.5 text-text-muted font-normal">Use {"{{variable}}"} syntax for variables</span></label>
                <textarea value={form.content} onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))} rows={5} placeholder={t("workspace.ph.promptBody")} className="w-full resize-none px-3 py-2.5 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors leading-relaxed" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-hover transition">{t("common.cancel")}</button>
              <button onClick={handleCreate} disabled={!form.title.trim() || !form.content.trim()} className="px-5 py-2 rounded-full text-sm font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-50 transition">{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
