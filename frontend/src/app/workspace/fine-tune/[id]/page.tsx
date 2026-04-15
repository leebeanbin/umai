"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, Clock, Ban, TrendingDown } from "lucide-react";
import { apiGetJob, apiCancelJob, type JobOut, type JobStatus } from "@/lib/api/fineTuneClient";
import { useAuth } from "@/components/providers/AuthProvider";

// ── SVG 손실 그래프 ───────────────────────────────────────────────────────────

function LossChart({
  steps,
  trainLoss,
  valLoss,
}: {
  steps: number[];
  trainLoss: number[];
  valLoss: number[];
}) {
  const W = 600;
  const H = 220;
  const PAD = { top: 16, right: 20, bottom: 36, left: 52 };

  if (steps.length < 2) {
    return (
      <div className="flex items-center justify-center h-[220px] text-text-muted text-xs">
        <Loader2 size={14} className="animate-spin mr-2" /> 데이터 수집 중...
      </div>
    );
  }

  const allLoss = [...trainLoss, ...valLoss].filter((v) => v != null);
  const minY = Math.max(0, Math.min(...allLoss) - 0.05);
  const maxY = Math.max(...allLoss) + 0.05;
  const minX = steps[0];
  const maxX = steps[steps.length - 1];

  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  function px(step: number) {
    return PAD.left + ((step - minX) / (maxX - minX || 1)) * chartW;
  }
  function py(loss: number) {
    return PAD.top + chartH - ((loss - minY) / (maxY - minY || 1)) * chartH;
  }

  function toPath(xs: number[], ys: number[]) {
    return xs
      .map((x, i) => `${i === 0 ? "M" : "L"} ${px(x).toFixed(1)} ${py(ys[i]).toFixed(1)}`)
      .join(" ");
  }

  // Y-axis ticks (5 steps)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = minY + ((maxY - minY) / 4) * i;
    return { y: py(v), label: v.toFixed(3) };
  });

  // X-axis ticks (5 steps)
  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const x = minX + ((maxX - minX) / 4) * i;
    return { x: px(x), label: Math.round(x) };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: "220px" }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* 그리드 */}
      {yTicks.map((t) => (
        <line
          key={t.y}
          x1={PAD.left}
          y1={t.y}
          x2={W - PAD.right}
          y2={t.y}
          stroke="var(--color-border)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ))}

      {/* Y axis 레이블 */}
      {yTicks.map((t) => (
        <text
          key={t.y}
          x={PAD.left - 6}
          y={t.y + 4}
          textAnchor="end"
          fontSize={9}
          fill="var(--color-text-muted)"
        >
          {t.label}
        </text>
      ))}

      {/* X axis 레이블 */}
      {xTicks.map((t) => (
        <text
          key={t.x}
          x={t.x}
          y={H - PAD.bottom + 16}
          textAnchor="middle"
          fontSize={9}
          fill="var(--color-text-muted)"
        >
          {t.label}
        </text>
      ))}

      {/* X axis 레이블 제목 */}
      <text
        x={PAD.left + chartW / 2}
        y={H - 2}
        textAnchor="middle"
        fontSize={9}
        fill="var(--color-text-muted)"
      >
        Step
      </text>

      {/* Val loss 선 (먼저 그려서 뒤에) */}
      {valLoss.length > 1 && (
        <path
          d={toPath(steps, valLoss)}
          fill="none"
          stroke="var(--color-warning)"
          strokeWidth={1.5}
          strokeDasharray="4 2"
          opacity={0.8}
        />
      )}

      {/* Train loss 선 */}
      <path
        d={toPath(steps, trainLoss)}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2}
      />

      {/* 현재 점 */}
      {steps.length > 0 && (
        <circle
          cx={px(steps.at(-1)!)}
          cy={py(trainLoss.at(-1)!)}
          r={3.5}
          fill="var(--color-accent)"
        />
      )}

      {/* 범례 */}
      <g transform={`translate(${PAD.left + 8}, ${PAD.top + 6})`}>
        <line x1={0} y1={5} x2={14} y2={5} stroke="var(--color-accent)" strokeWidth={2} />
        <text x={18} y={9} fontSize={9} fill="var(--color-text-muted)">Train Loss</text>
        {valLoss.length > 1 && (
          <>
            <line x1={80} y1={5} x2={94} y2={5} stroke="var(--color-warning)" strokeWidth={1.5} strokeDasharray="4 2" />
            <text x={98} y={9} fontSize={9} fill="var(--color-text-muted)">Val Loss</text>
          </>
        )}
      </g>
    </svg>
  );
}

// ── 상태 ─────────────────────────────────────────────────────────────────────

const STATUS_UI: Record<JobStatus, { icon: React.ReactNode; label: string; cls: string }> = {
  pending:   { icon: <Clock size={14} />,                       label: "대기 중",  cls: "text-text-muted" },
  running:   { icon: <Loader2 size={14} className="animate-spin" />, label: "학습 중", cls: "text-accent"     },
  done:      { icon: <CheckCircle2 size={14} />,                label: "완료",     cls: "text-success"    },
  failed:    { icon: <XCircle size={14} />,                     label: "실패",     cls: "text-danger"     },
  cancelled: { icon: <Ban size={14} />,                         label: "취소됨",  cls: "text-text-muted" },
};

// ── 메인 ─────────────────────────────────────────────────────────────────────

export default function FineTuneJobPage() {
  const { id }  = useParams<{ id: string }>();
  const router  = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [job, setJob] = useState<JobOut | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await apiGetJob(id);
      setJob(j);
      if (j.status !== "running" && j.status !== "pending") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    } catch {/* ignore */} finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (authLoading || !user) return;
    load();
    pollRef.current = setInterval(load, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user, authLoading, load]);

  async function handleCancel() {
    if (!job) return;
    try {
      await apiCancelJob(job.id);
      load();
    } catch {
      alert("작업 취소에 실패했습니다.");
    }
  }

  if (loading || !job) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted">
        <Loader2 size={18} className="animate-spin mr-2" /> 불러오는 중...
      </div>
    );
  }

  const statusUi = STATUS_UI[job.status] ?? STATUS_UI.pending;
  const lastTrainLoss = job.metrics.train_loss.at(-1);
  const lastValLoss   = job.metrics.val_loss.at(-1);
  const lastLr        = job.metrics.learning_rate.at(-1);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/workspace/fine-tune")}
          className="p-1.5 rounded-lg hover:bg-hover text-text-muted transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-text-primary truncate">{job.name}</h1>
            <span className={`flex items-center gap-1 text-xs font-medium ${statusUi.cls}`}>
              {statusUi.icon} {statusUi.label}
            </span>
          </div>
          <p className="text-[11px] text-text-muted font-mono">{job.base_model} · {job.method.toUpperCase()}</p>
        </div>
        {(job.status === "running" || job.status === "pending") && (
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 rounded-lg border border-danger/40 text-danger hover:bg-danger/10 text-xs font-medium transition-colors"
          >
            학습 취소
          </button>
        )}
      </div>

      {/* 진행률 */}
      <div className="p-4 rounded-xl border border-border bg-surface space-y-3">
        <div className="flex justify-between text-xs text-text-muted">
          <span>Step {job.current_step} / {job.total_steps}</span>
          <span className="font-semibold text-text-primary">{Math.round(job.progress * 100)}%</span>
        </div>
        <div className="w-full h-2 rounded-full bg-elevated overflow-hidden">
          <div
            className={
              "h-full rounded-full transition-all duration-700 " +
              (job.status === "done" ? "bg-success" : job.status === "failed" ? "bg-danger" : "bg-accent")
            }
            style={{ width: `${Math.round(job.progress * 100)}%` }}
          />
        </div>
        {/* 핵심 지표 */}
        <div className="grid grid-cols-3 gap-3 pt-1">
          {[
            { label: "Train Loss", value: lastTrainLoss?.toFixed(4), icon: <TrendingDown size={12} /> },
            { label: "Val Loss",   value: lastValLoss?.toFixed(4),   icon: <TrendingDown size={12} /> },
            { label: "LR",        value: lastLr ? lastLr.toExponential(2) : "—", icon: null },
          ].map(({ label, value, icon }) => (
            <div key={label} className="bg-elevated rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-1 text-[10px] text-text-muted mb-1">
                {icon} {label}
              </div>
              <p className="text-sm font-semibold text-text-primary font-mono">
                {value ?? "—"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 손실 그래프 */}
      <div className="p-4 rounded-xl border border-border bg-surface">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
          손실 곡선 (Loss Curve)
        </p>
        <LossChart
          steps={job.metrics.steps}
          trainLoss={job.metrics.train_loss}
          valLoss={job.metrics.val_loss}
        />
      </div>

      {/* 학습 설정 요약 */}
      <div className="p-4 rounded-xl border border-border bg-surface">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
          학습 설정
        </p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {Object.entries(job.config).map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs">
              <span className="text-text-muted">{k}</span>
              <span className="text-text-primary font-mono font-medium">{String(v)}</span>
            </div>
          ))}
          {job.output_model_name && (
            <div className="flex justify-between text-xs col-span-2">
              <span className="text-text-muted">출력 모델명</span>
              <span className="text-text-primary font-mono font-medium">{job.output_model_name}</span>
            </div>
          )}
        </div>
      </div>

      {/* 로그 */}
      {job.logs.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-surface">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
            학습 로그
          </p>
          <div className="bg-elevated rounded-lg p-3 max-h-48 overflow-y-auto">
            {job.logs.map((line, i) => (
              <p key={i} className="text-[11px] font-mono text-text-primary leading-relaxed">
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 완료 후 안내 */}
      {job.status === "done" && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-success/30 bg-success/5">
          <CheckCircle2 size={16} className="text-success flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-success mb-1">학습 완료!</p>
            <p className="text-xs text-text-muted leading-relaxed">
              {job.output_model_name
                ? `출력 모델 "${job.output_model_name}"이 저장되었습니다. Ollama에서 로드하거나 Workspace › Models에서 사용하세요.`
                : "학습이 완료되었습니다. Workspace › Models에서 파인튜닝된 모델을 등록하여 사용하세요."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
