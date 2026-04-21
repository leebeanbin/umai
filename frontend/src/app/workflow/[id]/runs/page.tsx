"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  ArrowLeft, CheckCircle2, XCircle, PauseCircle,
  Loader2, Clock, Layers, StopCircle, X,
} from "lucide-react";
import {
  apiListRuns,
  apiGetRun,
  apiCancelRun,
  apiGetStats,
  type RunListItem,
  type RunOut,
  type WorkflowStats,
} from "@/lib/api/backendClient";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

// ── 상태 배지 ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    running:   { icon: <Loader2 size={11} className="animate-spin" />, label: "실행 중",   cls: "text-accent bg-accent/10" },
    suspended: { icon: <PauseCircle size={11} />,                      label: "승인 대기", cls: "text-warning bg-warning/10" },
    done:      { icon: <CheckCircle2 size={11} />,                     label: "완료",      cls: "text-success bg-success/10" },
    failed:    { icon: <XCircle size={11} />,                          label: "실패",      cls: "text-danger bg-danger/10" },
  };
  const info = map[status] ?? { icon: null, label: status, cls: "text-text-muted bg-elevated" };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${info.cls}`}>
      {info.icon} {info.label}
    </span>
  );
}

function formatDuration(s: number | null) {
  if (s === null) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toFixed(0)}s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ── 스텝 출력 드로어 ───────────────────────────────────────────────────────────

function RunDetailDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<RunOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGetRun(runId).then(setRun).finally(() => setLoading(false));
  }, [runId]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside className="w-[480px] bg-base border-l border-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <span className="text-xs font-semibold text-text-primary">실행 상세</span>
          <button onClick={onClose} aria-label="Close" className="p-1 text-text-muted hover:text-text-primary"><X size={13} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex justify-center pt-8"><Loader2 size={18} className="animate-spin text-text-muted" /></div>
          ) : !run ? (
            <p className="text-xs text-text-muted text-center pt-8">데이터를 불러올 수 없습니다.</p>
          ) : (
            <>
              {/* 메타 */}
              <div className="flex items-center gap-2">
                <StatusBadge status={run.status} />
                <span className="text-[11px] text-text-muted">{formatDate(run.started_at)}</span>
              </div>

              {/* 최종 출력 */}
              {run.status === "done" && Object.keys(run.outputs).length > 0 && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <p className="text-[10px] font-semibold text-text-muted uppercase mb-2">최종 출력</p>
                  <pre className="text-[11px] text-text-primary whitespace-pre-wrap font-mono">
                    {JSON.stringify(run.outputs, null, 2)}
                  </pre>
                </div>
              )}

              {/* 스텝별 결과 */}
              <p className="text-[10px] font-semibold text-text-muted uppercase mt-2">노드별 실행 결과</p>
              {run.steps.length === 0 ? (
                <p className="text-xs text-text-muted">스텝 데이터 없음</p>
              ) : (
                run.steps.map((step) => (
                  <div key={step.node_id} className="rounded-lg border border-border bg-surface overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={step.status} />
                        <span className="text-[11px] font-medium text-text-primary font-mono">{step.node_id}</span>
                      </div>
                      <span className="text-[10px] text-text-muted">
                        {step.started_at && step.finished_at
                          ? formatDuration((new Date(step.finished_at).getTime() - new Date(step.started_at).getTime()) / 1000)
                          : "—"}
                      </span>
                    </div>
                    {Object.keys(step.output_data).length > 0 && (
                      <div className="px-3 py-2">
                        <p className="text-[10px] text-text-muted mb-1">Output</p>
                        <pre className="text-[11px] text-text-primary whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
                          {JSON.stringify(step.output_data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── 메인 페이지 ────────────────────────────────────────────────────────────────

export default function RunsHistoryPage() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params?.id as string;

  const { user, loading: authLoading } = useAuth();
  const PAGE_LIMIT = 20;
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [stats, setStats] = useState<WorkflowStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!workflowId || authLoading) return;
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    Promise.all([
      apiListRuns(workflowId, page, PAGE_LIMIT + 1),
      apiGetStats(workflowId),
    ]).then(([r, s]) => {
      setHasNext(r.length > PAGE_LIMIT);
      setRuns(r.slice(0, PAGE_LIMIT));
      setStats(s);
    }).catch(() => setLoadError("실행 기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."))
      .finally(() => setLoading(false));
  }, [workflowId, page, user, authLoading]);

  async function handleCancel(e: React.MouseEvent, runId: string) {
    e.stopPropagation();
    setCancelTarget(runId);
  }

  async function confirmCancel(runId: string) {
    setCancelTarget(null);
    setCancelling(runId);
    try {
      await apiCancelRun(runId);
      setRuns((prev) =>
        prev.map((r) => r.run_id === runId ? { ...r, status: "cancelled" } : r)
      );
    } finally {
      setCancelling(null);
    }
  }

  return (
    <div className="flex flex-col h-full bg-base">
      <ConfirmModal
        open={cancelTarget !== null}
        message="실행을 취소하시겠습니까?"
        confirmLabel="취소하기"
        onConfirm={() => { const id = cancelTarget!; confirmCancel(id); }}
        onCancel={() => setCancelTarget(null)}
      />
      {/* 헤더 */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        <button
          onClick={() => router.push(`/workflow/${workflowId}`)}
          className="p-1.5 rounded-lg hover:bg-hover text-text-muted transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-sm font-semibold text-text-primary">실행 기록</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loadError && (
          <div className="px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
            {loadError}
          </div>
        )}
        {/* 통계 카드 */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "전체 실행", value: stats.total_runs, icon: <Layers size={14} />, cls: "text-text-primary" },
              { label: "완료", value: stats.done, icon: <CheckCircle2 size={14} />, cls: "text-success" },
              { label: "실패", value: stats.failed, icon: <XCircle size={14} />, cls: "text-danger" },
              { label: "평균 소요", value: stats.avg_duration_s !== null ? formatDuration(stats.avg_duration_s) : "—", icon: <Clock size={14} />, cls: "text-accent" },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-border bg-surface p-4">
                <div className={`flex items-center gap-1.5 mb-1 ${c.cls}`}>
                  {c.icon}
                  <span className="text-[11px] font-medium text-text-muted">{c.label}</span>
                </div>
                <p className={`text-xl font-bold ${c.cls}`}>{c.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* 실행 목록 */}
        {loading ? (
          <div className="flex justify-center pt-12"><Loader2 size={20} className="animate-spin text-text-muted" /></div>
        ) : runs.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-text-muted">아직 실행 기록이 없습니다.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-text-muted uppercase">상태</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-text-muted uppercase">시작</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-text-muted uppercase">소요시간</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-text-muted uppercase">스텝</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {runs.map((run, i) => (
                  <tr
                    key={run.run_id}
                    onClick={() => setSelectedRunId(run.run_id)}
                    className={`border-b border-border last:border-0 cursor-pointer hover:bg-hover transition-colors ${i % 2 === 0 ? "bg-base" : "bg-surface/50"}`}
                  >
                    <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                    <td className="px-4 py-3 text-text-primary font-mono">{formatDate(run.started_at)}</td>
                    <td className="px-4 py-3 text-text-muted">{formatDuration(run.duration_s)}</td>
                    <td className="px-4 py-3 text-text-muted">{run.step_count}개</td>
                    <td className="px-4 py-3 text-right">
                      {(run.status === "running" || run.status === "suspended") && (
                        <button
                          onClick={(e) => handleCancel(e, run.run_id)}
                          disabled={cancelling === run.run_id}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                        >
                          {cancelling === run.run_id
                            ? <Loader2 size={10} className="animate-spin" />
                            : <StopCircle size={10} />}
                          취소
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(page > 1 || hasNext) && (
          <div className="flex justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-primary hover:bg-hover disabled:opacity-40 transition-colors"
            >
              이전
            </button>
            <span className="px-3 py-1.5 text-xs text-text-muted">{page}</span>
            {hasNext && (
              <button
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-primary hover:bg-hover transition-colors"
              >
                다음
              </button>
            )}
          </div>
        )}
      </div>

      {/* 실행 상세 드로어 */}
      {selectedRunId && (
        <RunDetailDrawer runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
      )}
    </div>
  );
}
