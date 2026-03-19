"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Plus, X, FileText, Upload, BookOpen, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { loadWs, saveWs } from "@/lib/workspaceStore";

type KnowledgeFile = { name: string; size: string; type: string };

type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  files: KnowledgeFile[];
  createdAt: Date;
};

const INITIAL: KnowledgeBase[] = [
  {
    id: "k1",
    name: "편집 가이드라인",
    description: "브랜드 이미지 편집 규칙 및 스타일 가이드",
    files: [
      { name: "brand_guideline.pdf", size: "2.4 MB", type: "pdf" },
      { name: "color_palette.txt",   size: "12 KB",  type: "txt" },
    ],
    createdAt: new Date(Date.now() - 86400000 * 5),
  },
];

const ACCEPTED = [".pdf", ".txt", ".md", ".docx"];
const FILE_ICON_COLOR: Record<string, string> = {
  pdf: "text-red-400", txt: "text-blue-400", md: "text-green-400", docx: "text-blue-500",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgePage() {
  const { t } = useLanguage();
  const [query, setQuery]           = useState("");
  const [bases, setBases]           = useState<KnowledgeBase[]>(() => loadWs<KnowledgeBase>("knowledge", INITIAL));

  useEffect(() => { saveWs("knowledge", bases); }, [bases]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState({ name: "", description: "" });
  const [pendingFiles, setPending]  = useState<File[]>([]);
  const [dragging, setDragging]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = bases.filter((b) => !query || b.name.toLowerCase().includes(query.toLowerCase()));

  function addFiles(files: FileList | File[]) {
    const valid = Array.from(files).filter((f) =>
      ACCEPTED.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    setPending((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !existing.has(f.name))];
    });
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  async function handleCreate() {
    if (!form.name.trim()) return;
    setUploading(true);
    await new Promise((r) => setTimeout(r, 600)); // TODO: 실제 업로드 API
    setBases((prev) => [...prev, {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      description: form.description,
      files: pendingFiles.map((f) => ({
        name: f.name,
        size: formatBytes(f.size),
        type: f.name.split(".").pop() ?? "file",
      })),
      createdAt: new Date(),
    }]);
    setForm({ name: "", description: "" });
    setPending([]);
    setUploading(false);
    setShowCreate(false);
  }

  return (
    <div className="flex flex-col gap-1 mt-4">
      <div className="flex justify-between items-center mb-3 px-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">{t("workspace.knowledge")}</h2>
          <span className="text-base text-text-muted">{bases.length}</span>
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
          {filtered.length === 0 ? (
            <p className="text-xs text-text-muted py-6 text-center col-span-2">{t("workspace.noItems")}</p>
          ) : filtered.map((b) => (
            <div key={b.id} className="group flex flex-col gap-2 transition rounded-2xl w-full p-3 hover:bg-hover cursor-default">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="size-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                    <BookOpen size={14} className="text-accent" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{b.name}</div>
                    <div className="text-xs text-text-muted truncate">{b.description || `${b.files.length} ${t("workspace.filesCount")}`}</div>
                  </div>
                </div>
                <button
                  onClick={() => setBases((prev) => prev.filter((x) => x.id !== b.id))}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-red-400 transition shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
              {b.files.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-10">
                  {b.files.map((f, i) => (
                    <div key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-elevated border border-border text-xs">
                      <FileText size={10} className={FILE_ICON_COLOR[f.type] ?? "text-text-muted"} />
                      <span className="truncate max-w-[100px] text-text-secondary">{f.name}</span>
                      <span className="text-text-muted/60 shrink-0">{f.size}</span>
                    </div>
                  ))}
                </div>
              )}
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
              <h3 className="text-sm font-semibold text-text-primary">{t("workspace.newKnowledge")}</h3>
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
                  placeholder={t("workspace.ph.kbName")}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("common.description")}</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder={t("workspace.ph.kbDesc")}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                />
              </div>

              {/* 파일 업로드 — 드래그앤드롭 실제 동작 */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  {t("workspace.files")}
                  <span className="ml-1.5 text-text-muted font-normal">PDF, TXT, MD, DOCX</span>
                </label>
                <div
                  className={`flex flex-col items-center justify-center gap-2 py-8 rounded-xl border border-dashed cursor-pointer transition-colors ${
                    dragging
                      ? "border-accent/70 bg-accent/5"
                      : "border-border hover:border-accent/50 hover:bg-accent/5"
                  }`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <Upload size={20} className={dragging ? "text-accent" : "text-text-muted"} />
                  <div className="text-center">
                    <p className="text-xs text-text-secondary font-medium">
                      {dragging ? t("workspace.dropHere") : t("workspace.dropFiles")}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">{t("workspace.filesSupported")}</p>
                  </div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt,.md,.docx"
                  multiple
                  onChange={handleFileInput}
                  className="hidden"
                />

                {pendingFiles.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1 max-h-32 overflow-y-auto">
                    {pendingFiles.map((f, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-surface border border-border text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={11} className={FILE_ICON_COLOR[f.name.split(".").pop() ?? ""] ?? "text-text-muted"} />
                          <span className="truncate text-text-secondary">{f.name}</span>
                          <span className="text-text-muted shrink-0">{formatBytes(f.size)}</span>
                        </div>
                        <button
                          onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
                          className="text-text-muted hover:text-red-400 transition shrink-0 ml-2"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-hover transition">{t("common.cancel")}</button>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim() || uploading}
                className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-50 transition"
              >
                {uploading ? <><Loader2 size={13} className="animate-spin" />{t("common.saving")}</> : t("common.create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
