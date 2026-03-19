"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, Download, Swords, Filter, Info, Settings } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { AdminNav } from "@/components/admin/AdminNav";

type EvalTab = "ratings" | "arena";

// Sample data shape
type RatingEntry = {
  id: string;
  model: string;
  rating: "positive" | "negative";
  message_preview: string;
  user: string;
  created_at: string;
};

const SAMPLE_RATINGS: RatingEntry[] = [
  { id: "1", model: "gpt-4o",            rating: "positive", message_preview: "Python으로 퀵소트 구현해줘",          user: "user@example.com", created_at: "2026-03-17T10:22:00Z" },
  { id: "2", model: "claude-sonnet-4-6", rating: "positive", message_preview: "이 코드에서 버그를 찾아줘",           user: "test@example.com", created_at: "2026-03-17T09:10:00Z" },
  { id: "3", model: "gemini-2.0-flash",  rating: "negative", message_preview: "오늘 날씨 어때?",                     user: "demo@example.com", created_at: "2026-03-16T18:05:00Z" },
  { id: "4", model: "gpt-4o",            rating: "positive", message_preview: "React 컴포넌트 최적화 방법 알려줘",    user: "user@example.com", created_at: "2026-03-16T14:30:00Z" },
  { id: "5", model: "claude-sonnet-4-6", rating: "negative", message_preview: "이 문서를 요약해줘",                  user: "test@example.com", created_at: "2026-03-15T11:20:00Z" },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminEvaluationsPage() {
  const { lang } = useLanguage();
  const { user: me } = useAuth();
  const [evalTab, setEvalTab] = useState<EvalTab>("ratings");
  const [modelFilter, setModelFilter] = useState("all");

  if (me && me.role !== "admin") {
    return <div className="flex h-full items-center justify-center text-sm text-text-muted">관리자 권한이 필요합니다.</div>;
  }

  const positive = SAMPLE_RATINGS.filter((r) => r.rating === "positive").length;
  const negative = SAMPLE_RATINGS.filter((r) => r.rating === "negative").length;
  const total    = SAMPLE_RATINGS.length;
  const positiveRate = total > 0 ? Math.round((positive / total) * 100) : 0;

  const models = ["all", ...Array.from(new Set(SAMPLE_RATINGS.map((r) => r.model)))];
  const filtered = modelFilter === "all" ? SAMPLE_RATINGS : SAMPLE_RATINGS.filter((r) => r.model === modelFilter);

  return (
    <div className="flex h-full bg-base overflow-hidden">
      <AdminNav active="evaluations" />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">{lang === "ko" ? "평가" : "Evaluations"}</h2>
              <p className="text-xs text-text-muted mt-0.5">{lang === "ko" ? "유저 피드백과 모델 비교 데이터를 확인합니다." : "Review user feedback and model comparison data."}</p>
            </div>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-hover transition-colors">
              <Download size={12} />
              {lang === "ko" ? "CSV 내보내기" : "Export CSV"}
            </button>
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-1 mb-6 bg-surface rounded-xl p-1 w-fit border border-border">
            {([
              { id: "ratings" as const, label: lang === "ko" ? "메시지 평점" : "Message Ratings", icon: <ThumbsUp size={12} /> },
              { id: "arena"   as const, label: "Arena",                                             icon: <Swords size={12} /> },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => setEvalTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  evalTab === t.id ? "bg-accent/10 text-accent font-medium" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>

          {evalTab === "ratings" && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="p-4 rounded-2xl bg-surface border border-border">
                  <p className="text-xs text-text-muted mb-1">{lang === "ko" ? "총 평점" : "Total Ratings"}</p>
                  <p className="text-2xl font-bold text-text-primary">{total}</p>
                </div>
                <div className="p-4 rounded-2xl bg-surface border border-border">
                  <p className="text-xs text-text-muted mb-1">{lang === "ko" ? "긍정 비율" : "Positive Rate"}</p>
                  <p className="text-2xl font-bold text-green-400">{positiveRate}%</p>
                </div>
                <div className="p-4 rounded-2xl bg-surface border border-border">
                  <div className="flex items-center gap-3 mb-1">
                    <ThumbsUp size={12} className="text-green-400" />
                    <span className="text-xs text-text-muted">{positive}</span>
                    <ThumbsDown size={12} className="text-danger ml-2" />
                    <span className="text-xs text-text-muted">{negative}</span>
                  </div>
                  <div className="h-2 bg-hover rounded-full overflow-hidden mt-2">
                    <div
                      className="h-full bg-green-400 rounded-full"
                      style={{ width: `${positiveRate}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Filter */}
              <div className="flex items-center gap-2 mb-4">
                <Filter size={12} className="text-text-muted" />
                <span className="text-xs text-text-muted">{lang === "ko" ? "모델:" : "Model:"}</span>
                <div className="flex gap-1.5">
                  {models.map((m) => (
                    <button key={m} onClick={() => setModelFilter(m)}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                        modelFilter === m ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                      }`}
                    >
                      {m === "all" ? (lang === "ko" ? "전체" : "All") : m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ratings table */}
              <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-0 text-[10px] font-medium text-text-muted px-4 py-2 border-b border-border bg-hover/30">
                  <span>{lang === "ko" ? "메시지" : "Message"}</span>
                  <span className="text-center w-24">{lang === "ko" ? "모델" : "Model"}</span>
                  <span className="text-center w-16">{lang === "ko" ? "평점" : "Rating"}</span>
                  <span className="text-right w-24">{lang === "ko" ? "날짜" : "Date"}</span>
                </div>
                {filtered.map((r, i) => (
                  <div
                    key={r.id}
                    className={`grid grid-cols-[1fr_auto_auto_auto] gap-0 items-center px-4 py-3 ${i < filtered.length - 1 ? "border-b border-border-subtle" : ""}`}
                  >
                    <p className="text-sm text-text-secondary truncate pr-4">{r.message_preview}</p>
                    <span className="text-xs text-text-muted font-mono w-24 text-center truncate">{r.model.split("-").slice(0, 2).join("-")}</span>
                    <span className="w-16 flex justify-center">
                      {r.rating === "positive"
                        ? <ThumbsUp size={13} className="text-green-400" />
                        : <ThumbsDown size={13} className="text-danger" />
                      }
                    </span>
                    <span className="text-xs text-text-muted w-24 text-right">{formatDate(r.created_at)}</span>
                  </div>
                ))}
              </div>

              <p className="text-xs text-text-muted mt-3 flex items-center gap-1.5">
                <Info size={10} />
                {lang === "ko" ? "샘플 데이터입니다. 실제 평점은 Admin → Settings → Evaluations에서 평점 수집을 활성화하면 표시됩니다." : "Sample data. Enable rating collection in Admin → Settings → Evaluations."}
              </p>
            </>
          )}

          {evalTab === "arena" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="size-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                <Swords size={28} className="text-accent" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary mb-1">Arena Mode</p>
                <p className="text-xs text-text-muted max-w-xs leading-relaxed">
                  {lang === "ko"
                    ? "두 모델의 응답을 나란히 비교하고, 유저가 더 나은 응답을 선택합니다. Admin → Settings → Evaluations에서 Arena 모드를 활성화하세요."
                    : "Compare responses from two models side by side and let users vote for the better one. Enable Arena Mode in Admin → Settings → Evaluations."}
                </p>
              </div>
              <Link
                href="/admin/settings"
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover transition-colors"
              >
                <Settings size={13} />
                {lang === "ko" ? "설정으로 이동" : "Go to Settings"}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
