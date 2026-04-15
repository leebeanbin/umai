"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Database, Cpu, ChevronRight, CheckCircle2, XCircle, Loader2, Clock, Ban } from "lucide-react";
import {
  apiListJobs,
  apiListDatasets,
  apiDeleteDataset,
  apiCancelJob,
  type JobOut,
  type DatasetOut,
  type JobStatus,
} from "@/lib/api/fineTuneClient";
import { useAuth } from "@/components/providers/AuthProvider";

// ── 상태 배지 ─────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<JobStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  pending:   { label: "대기 중",   icon: <Clock size={11} />,                       cls: "text-text-muted bg-elevated border-border" },
  running:   { label: "학습 중",   icon: <Loader2 size={11} className="animate-spin" />, cls: "text-accent bg-accent/10 border-accent/30" },
  done:      { label: "완료",      icon: <CheckCircle2 size={11} />,                cls: "text-success bg-success/10 border-success/30" },
  failed:    { label: "실패",      icon: <XCircle size={11} />,                     cls: "text-danger bg-danger/10 border-danger/30" },
  cancelled: { label: "취소됨",   icon: <Ban size={11} />,                          cls: "text-text-muted bg-elevated border-border" },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${s.cls}`}>
      {s.icon} {s.label}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-elevated overflow-hidden">
      <div
        className="h-full bg-accent rounded-full transition-all duration-500"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

export default function FineTunePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [jobs, setJobs]         = useState<JobOut[]>([]);
  const [datasets, setDatasets] = useState<DatasetOut[]>([]);
  const [tab, setTab]           = useState<"jobs" | "datasets">("jobs");
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    try {
      const [j, d] = await Promise.all([apiListJobs(), apiListDatasets()]);
      setJobs(j);
      setDatasets(d);
    } catch {/* ignore */} finally {
      setLoading(false);
    }
  }, []);

  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  useEffect(() => {
    if (authLoading || !user) return;
    load();
    const interval = setInterval(() => {
      if (jobsRef.current.some((j) => j.status === "running" || j.status === "pending")) load();
    }, 3000);
    return () => clearInterval(interval);
  }, [user, authLoading, load]);

  async function handleCancelJob(id: string) {
    try {
      await apiCancelJob(id);
      load();
    } catch {
      alert("작업 취소에 실패했습니다.");
    }
  }

  async function handleDeleteDataset(id: string) {
    if (!confirm("데이터셋을 삭제하시겠습니까?")) return;
    await apiDeleteDataset(id);
    setDatasets((prev) => prev.filter((d) => d.id !== id));
  }

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted">
        <Loader2 size={18} className="animate-spin mr-2" /> 불러오는 중...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-text-primary">파인튜닝</h1>
          <p className="text-xs text-text-muted mt-0.5">
            오픈 모델을 LoRA / QLoRA 방식으로 파인튜닝합니다
          </p>
        </div>
        <button
          onClick={() => router.push("/workspace/fine-tune/new")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
        >
          <Plus size={13} /> 새 학습 시작
        </button>
      </div>

      {/* 채팅 파인튜닝 모드 안내 */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl border border-accent/25 bg-accent/5">
        <div className="p-1.5 rounded-lg bg-accent/15 text-accent flex-shrink-0">
          <Cpu size={14} />
        </div>
        <div>
          <p className="text-xs font-medium text-text-primary mb-0.5">채팅에서 학습 데이터 수집</p>
          <p className="text-[11px] text-text-muted leading-relaxed">
            채팅 화면 상단의 <strong className="text-text-primary">파인튜닝 모드</strong> 토글을 켜면 대화가 자동으로 학습 데이터로 저장됩니다.
            어느 정도 쌓이면 여기서 학습을 시작하세요.
          </p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-border">
        {(["jobs", "datasets"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px " +
              (tab === t
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary")
            }
          >
            {t === "jobs" ? (
              <span className="flex items-center gap-1.5"><Cpu size={12} /> 학습 작업 ({jobs.length})</span>
            ) : (
              <span className="flex items-center gap-1.5"><Database size={12} /> 데이터셋 ({datasets.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* ── 학습 작업 목록 ──────────────────────────────────────────────── */}
      {tab === "jobs" && (
        <div className="space-y-2">
          {jobs.length === 0 ? (
            <div className="text-center py-16 text-text-muted">
              <Cpu size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">학습 작업이 없습니다</p>
              <p className="text-xs mt-1 opacity-60">
                데이터셋을 업로드하고 새 학습을 시작하세요
              </p>
            </div>
          ) : (
            jobs.map((job) => (
              <div
                key={job.id}
                className="p-4 rounded-xl border border-border bg-surface hover:border-border-hover transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-text-primary truncate">
                        {job.name}
                      </span>
                      <StatusBadge status={job.status} />
                    </div>
                    <p className="text-[11px] text-text-muted font-mono truncate">
                      {job.base_model} · {job.method.toUpperCase()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {job.status === "running" && (
                      <button
                        onClick={() => handleCancelJob(job.id)}
                        className="text-[11px] text-text-muted hover:text-danger px-2 py-1 rounded border border-border hover:border-danger/50 transition-colors"
                      >
                        취소
                      </button>
                    )}
                    <button
                      onClick={() => router.push(`/workspace/fine-tune/${job.id}`)}
                      className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover transition-colors"
                    >
                      상세 보기 <ChevronRight size={12} />
                    </button>
                  </div>
                </div>

                {/* 진행률 */}
                {(job.status === "running" || job.status === "done") && (
                  <div className="mt-3">
                    <div className="flex justify-between text-[10px] text-text-muted mb-1">
                      <span>Step {job.current_step} / {job.total_steps}</span>
                      <span>{Math.round(job.progress * 100)}%</span>
                    </div>
                    <ProgressBar value={job.progress} />
                    {job.metrics.train_loss.length > 0 && (
                      <div className="mt-1.5 flex gap-3 text-[10px] text-text-muted">
                        <span>
                          Train loss:{" "}
                          <strong className="text-text-primary">
                            {job.metrics.train_loss.at(-1)?.toFixed(4)}
                          </strong>
                        </span>
                        {job.metrics.val_loss.length > 0 && (
                          <span>
                            Val loss:{" "}
                            <strong className="text-text-primary">
                              {job.metrics.val_loss.at(-1)?.toFixed(4)}
                            </strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── 데이터셋 목록 ────────────────────────────────────────────────── */}
      {tab === "datasets" && (
        <div className="space-y-2">
          {datasets.length === 0 ? (
            <div className="text-center py-16 text-text-muted">
              <Database size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">데이터셋이 없습니다</p>
              <p className="text-xs mt-1 opacity-60">
                채팅 파인튜닝 모드로 수집하거나 직접 업로드하세요
              </p>
            </div>
          ) : (
            datasets.map((ds) => (
              <div
                key={ds.id}
                className="flex items-center gap-4 p-3.5 rounded-xl border border-border bg-surface"
              >
                <div className="p-2 rounded-lg bg-elevated text-text-muted flex-shrink-0">
                  <Database size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{ds.name}</p>
                  <p className="text-[11px] text-text-muted">
                    {ds.example_count}개 예제 · {ds.format} 형식
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteDataset(ds.id)}
                  className="p-1.5 rounded hover:bg-hover text-text-muted hover:text-danger transition-colors flex-shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
