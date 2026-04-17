"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, FileText, Upload, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import {
  apiListKnowledge,
  apiUploadKnowledge,
  apiDeleteKnowledge,
  apiEnqueueKnowledgeProcess,
  type KnowledgeItem,
} from "@/lib/api/backendClient";
import { pollTask } from "@/lib/utils/pollTask";

const ACCEPTED = [".pdf", ".txt", ".md", ".docx"];
const FILE_ICON_COLOR: Record<string, string> = {
  pdf: "text-red-400", txt: "text-blue-400", md: "text-green-400", docx: "text-blue-500",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExt(contentType: string, name: string): string {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "text/markdown") return "md";
  if (contentType.includes("wordprocessingml")) return "docx";
  return name.split(".").pop() ?? "txt";
}

export default function KnowledgePage() {
  const { t } = useLanguage();
  const [query, setQuery]         = useState("");
  const [files, setFiles]         = useState<KnowledgeItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  // id → task status ("queued" | "running" | "success" | "failed")
  const [taskStatus, setTaskStatus] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiListKnowledge()
      .then(setFiles)
      .catch(() => setError(t("workspace.loadError")))
      .finally(() => setLoading(false));
  }, [t]);

  const filtered = files.filter((f) =>
    !query || f.name.toLowerCase().includes(query.toLowerCase())
  );

  function addFiles(fileList: FileList | File[]) {
    if (uploading) return; // 업로드 중 재진입 방지
    const valid = Array.from(fileList).filter((f) =>
      ACCEPTED.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    if (valid.length === 0) return;
    handleUpload(valid);
  }

  async function handleUpload(toUpload: File[]) {
    setUploading(true);
    setError(null);
    const results: KnowledgeItem[] = [];
    for (const file of toUpload) {
      try {
        const item = await apiUploadKnowledge(file);
        results.push(item);
        // Trigger Celery embedding task (best-effort, non-blocking)
        apiEnqueueKnowledgeProcess(item.id, file)
          .then((task) => {
            setTaskStatus((prev) => ({ ...prev, [item.id]: "running" }));
            pollTask(task.task_id, { maxPolls: 120 }) // up to 4 min
              .then(() => setTaskStatus((prev) => ({ ...prev, [item.id]: "success" })))
              .catch(() => setTaskStatus((prev) => ({ ...prev, [item.id]: "failed" })));
          })
          .catch(() => {
            setTaskStatus((prev) => ({ ...prev, [item.id]: "failed" }));
          });
      } catch {
        setError(`"${file.name}" ${t("workspace.uploadError")}`);
      }
    }
    if (results.length > 0) {
      setFiles((prev) => [...results, ...prev]);
    }
    setUploading(false);
  }

  async function handleDelete(id: string) {
    // 삭제 전에 taskStatus를 정리해 stale polling 업데이트를 무시하게 함
    setTaskStatus((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setFiles((prev) => prev.filter((f) => f.id !== id));
    try {
      await apiDeleteKnowledge(id);
    } catch {
      // Re-fetch on failure to restore accurate state
      apiListKnowledge().then(setFiles).catch(() => {});
    }
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

  return (
    <div className="flex flex-col gap-1 mt-4">
      <div className="flex justify-between items-center mb-3 px-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">{t("workspace.knowledge")}</h2>
          <span className="text-base text-text-muted">{files.length}</span>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-2 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-medium flex items-center gap-1 transition disabled:opacity-60"
        >
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} strokeWidth={2.5} />}
          <span className="hidden sm:block text-xs">{uploading ? t("common.saving") : t("workspace.upload")}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.docx"
          multiple
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {/* 드래그앤드롭 업로드 영역 */}
      <div
        className={`flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border border-dashed cursor-pointer transition-colors mb-2 ${
          dragging
            ? "border-accent/70 bg-accent/5"
            : "border-border hover:border-accent/50 hover:bg-accent/5"
        }`}
        onClick={() => fileRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Upload size={18} className={dragging ? "text-accent" : "text-text-muted"} />
        <div className="text-center">
          <p className="text-xs text-text-secondary font-medium">
            {dragging ? t("workspace.dropHere") : t("workspace.dropFiles")}
          </p>
          <p className="text-xs text-text-muted mt-0.5">{t("workspace.filesSupported")}</p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 px-1 mb-1">{error}</p>
      )}

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

        <div className="px-3 mt-2 flex flex-col gap-1">
          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 size={18} className="animate-spin text-text-muted" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-text-muted py-6 text-center">{t("workspace.noItems")}</p>
          ) : filtered.map((f) => {
            const ext = fileExt(f.content_type, f.name);
            return (
              <div key={f.id} className="group flex items-center gap-3 transition rounded-2xl w-full p-3 hover:bg-hover cursor-default">
                <div className="size-9 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0">
                  <FileText size={16} className={FILE_ICON_COLOR[ext] ?? "text-text-muted"} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{f.name}</div>
                  <div className="text-xs text-text-muted flex items-center gap-2">
                    <span className="uppercase font-mono">{ext}</span>
                    <span>·</span>
                    <span>{formatBytes(f.file_size)}</span>
                    {taskStatus[f.id] === "queued" || taskStatus[f.id] === "running" ? (
                      <span className="flex items-center gap-1 text-amber-400"><Loader2 size={10} className="animate-spin" />{t("workspace.embedding.processing")}</span>
                    ) : taskStatus[f.id] === "success" ? (
                      <span className="text-green-400">{t("workspace.embedding.success")}</span>
                    ) : taskStatus[f.id] === "failed" ? (
                      <span className="text-red-400">{t("workspace.embedding.failed")}</span>
                    ) : null}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(f.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-red-400 transition shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
