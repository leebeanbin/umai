"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Play, Trash2, GitFork, Loader2 } from "lucide-react";
import {
  apiListWorkflows,
  apiCreateWorkflow,
  apiDeleteWorkflow,
  type WorkflowOut,
} from "@/lib/api/backendClient";
import { useAuth } from "@/components/providers/AuthProvider";

export default function WorkflowListPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    apiListWorkflows()
      .then(setWorkflows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  async function handleCreate() {
    setCreating(true);
    try {
      const wf = await apiCreateWorkflow("New Workflow");
      router.push(`/workflow/${wf.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm("이 워크플로우를 삭제하시겠습니까?")) return;
    await apiDeleteWorkflow(id);
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
  }

  return (
    <div className="flex flex-col h-full bg-base">
      {/* 상단 헤더 */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <GitFork size={18} className="text-accent" />
          <h1 className="text-sm font-semibold text-text-primary">워크플로우</h1>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-medium transition-colors"
        >
          {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          새 워크플로우
        </button>
      </header>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={20} className="animate-spin text-text-muted" />
          </div>
        ) : workflows.length === 0 ? (
          /* 빈 상태 */
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
            <div className="p-4 rounded-2xl bg-surface border border-border">
              <GitFork size={28} className="text-text-muted" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">워크플로우가 없습니다</p>
              <p className="text-xs text-text-muted mt-1">
                새 워크플로우를 만들어 AI 에이전트 흐름을 시각화하세요
              </p>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              첫 워크플로우 만들기
            </button>
          </div>
        ) : (
          /* 그리드 */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                onClick={() => router.push(`/workflow/${wf.id}`)}
                className="group flex flex-col gap-3 p-4 rounded-xl border border-border bg-surface hover:bg-hover hover:border-accent/40 cursor-pointer transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="p-2 rounded-lg bg-elevated">
                    <GitFork size={14} className="text-accent" />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push(`/workflow/${wf.id}`); }}
                      className="p-1.5 rounded-lg hover:bg-elevated text-text-muted hover:text-accent transition-colors"
                      title="실행"
                    >
                      <Play size={12} />
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, wf.id)}
                      className="p-1.5 rounded-lg hover:bg-elevated text-text-muted hover:text-danger transition-colors"
                      title="삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{wf.name}</p>
                  {wf.description && (
                    <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{wf.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-3 text-[10px] text-text-muted">
                  <span>{wf.graph.nodes.length}개 노드</span>
                  <span>·</span>
                  <span>{new Date(wf.updated_at || wf.created_at).toLocaleDateString("ko-KR")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
