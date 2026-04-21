"use client";

import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Download, Swords, Filter, Settings } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { AdminNav } from "@/components/admin/AdminNav";
import { apiAdminRatings, type RatingEntryOut } from "@/lib/api/backendClient";

type EvalTab = "ratings" | "arena";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminEvaluationsPage() {
  const { lang } = useLanguage();
  const { user: me } = useAuth();
  const ko = lang === "ko";

  const [evalTab, setEvalTab]     = useState<EvalTab>("ratings");
  const [modelFilter, setModelFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState<"all" | "positive" | "negative">("all");
  const [ratings, setRatings]     = useState<RatingEntryOut[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (evalTab !== "ratings") return;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    apiAdminRatings(ratingFilter === "all" ? undefined : ratingFilter, 0, 100)
      .then(setRatings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [evalTab, ratingFilter]);

  if (me && me.role !== "admin") {
    return <div className="flex h-full items-center justify-center text-sm text-text-muted">관리자 권한이 필요합니다.</div>;
  }

  const positive     = ratings.filter((r) => r.rating === "positive").length;
  const negative     = ratings.filter((r) => r.rating === "negative").length;
  const total        = ratings.length;
  const positiveRate = total > 0 ? Math.round((positive / total) * 100) : 0;

  const models  = ["all", ...Array.from(new Set(ratings.map((r) => r.model ?? "unknown")))];
  const filtered = modelFilter === "all" ? ratings : ratings.filter((r) => (r.model ?? "unknown") === modelFilter);

  function escapeCsv(v: string) {
    return `"${v.replace(/"/g, '""').replace(/\r?\n/g, " ").replace(/\r/g, " ")}"`;
  }

  function exportCsv() {
    const rows = [
      ["message_id", "model", "rating", "message_preview", "user_email", "created_at"],
      ...ratings.map((r) => [
        escapeCsv(r.message_id),
        escapeCsv(r.model ?? ""),
        escapeCsv(r.rating),
        escapeCsv(r.message_preview),
        escapeCsv(r.user_email),
        escapeCsv(r.created_at),
      ]),
    ];
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ratings_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="flex h-full bg-base overflow-hidden">
      <AdminNav active="evaluations" />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">{ko ? "평가" : "Evaluations"}</h2>
              <p className="text-xs text-text-muted mt-0.5">{ko ? "유저 피드백과 모델 비교 데이터를 확인합니다." : "Review user feedback and model comparison data."}</p>
            </div>
            <button
              onClick={exportCsv}
              disabled={ratings.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-hover transition-colors disabled:opacity-40"
            >
              <Download size={12} />
              {ko ? "CSV 내보내기" : "Export CSV"}
            </button>
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-1 mb-6 bg-surface rounded-xl p-1 w-fit border border-border">
            {([
              { id: "ratings" as const, label: ko ? "메시지 평점" : "Message Ratings", icon: <ThumbsUp size={12} /> },
              { id: "arena"   as const, label: "Arena",                                  icon: <Swords size={12} /> },
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
                  <p className="text-xs text-text-muted mb-1">{ko ? "총 평점" : "Total Ratings"}</p>
                  <p className="text-2xl font-bold text-text-primary">{loading ? "—" : total}</p>
                </div>
                <div className="p-4 rounded-2xl bg-surface border border-border">
                  <p className="text-xs text-text-muted mb-1">{ko ? "긍정 비율" : "Positive Rate"}</p>
                  <p className="text-2xl font-bold text-green-400">{loading ? "—" : `${positiveRate}%`}</p>
                </div>
                <div className="p-4 rounded-2xl bg-surface border border-border">
                  <div className="flex items-center gap-3 mb-1">
                    <ThumbsUp size={12} className="text-green-400" />
                    <span className="text-xs text-text-muted">{loading ? "—" : positive}</span>
                    <ThumbsDown size={12} className="text-danger ml-2" />
                    <span className="text-xs text-text-muted">{loading ? "—" : negative}</span>
                  </div>
                  <div className="h-2 bg-hover rounded-full overflow-hidden mt-2">
                    <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${positiveRate}%` }} />
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-4 mb-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Filter size={12} className="text-text-muted" />
                  <span className="text-xs text-text-muted">{ko ? "평점:" : "Rating:"}</span>
                  <div className="flex gap-1.5">
                    {(["all", "positive", "negative"] as const).map((v) => (
                      <button key={v} onClick={() => setRatingFilter(v)}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                          ratingFilter === v ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                        }`}
                      >
                        {v === "all" ? (ko ? "전체" : "All") : v === "positive" ? (ko ? "긍정" : "Positive") : (ko ? "부정" : "Negative")}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">{ko ? "모델:" : "Model:"}</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {models.map((m) => (
                      <button key={m} onClick={() => setModelFilter(m)}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                          modelFilter === m ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-secondary hover:bg-hover"
                        }`}
                      >
                        {m === "all" ? (ko ? "전체" : "All") : m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Ratings table */}
              <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-0 text-[10px] font-medium text-text-muted px-4 py-2 border-b border-border bg-hover/30">
                  <span>{ko ? "메시지" : "Message"}</span>
                  <span className="text-center w-28">{ko ? "모델" : "Model"}</span>
                  <span className="text-center w-16">{ko ? "평점" : "Rating"}</span>
                  <span className="text-right w-28">{ko ? "날짜" : "Date"}</span>
                </div>
                {loading ? (
                  <div className="py-10 text-center text-xs text-text-muted">{ko ? "로딩 중..." : "Loading..."}</div>
                ) : filtered.length === 0 ? (
                  <div className="py-10 text-center text-xs text-text-muted">
                    {ko ? "평가 데이터가 없습니다." : "No rating data yet."}
                  </div>
                ) : filtered.map((r, i) => (
                  <div
                    key={r.message_id}
                    className={`grid grid-cols-[1fr_auto_auto_auto] gap-0 items-center px-4 py-3 ${i < filtered.length - 1 ? "border-b border-border-subtle" : ""}`}
                  >
                    <p className="text-sm text-text-secondary truncate pr-4">{r.message_preview}</p>
                    <span className="text-xs text-text-muted font-mono w-28 text-center truncate">{(r.model ?? "unknown").split("-").slice(0, 2).join("-")}</span>
                    <span className="w-16 flex justify-center">
                      {r.rating === "positive"
                        ? <ThumbsUp size={13} className="text-green-400" />
                        : <ThumbsDown size={13} className="text-danger" />
                      }
                    </span>
                    <span className="text-xs text-text-muted w-28 text-right">{formatDate(r.created_at)}</span>
                  </div>
                ))}
              </div>
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
                  {ko
                    ? "두 모델의 응답을 나란히 비교하고, 유저가 더 나은 응답을 선택합니다. Admin → Settings → Evaluations에서 Arena 모드를 활성화하세요."
                    : "Compare responses from two models side by side and let users vote for the better one. Enable Arena Mode in Admin → Settings → Evaluations."}
                </p>
              </div>
              <Link
                href="/admin/settings"
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover transition-colors"
              >
                <Settings size={13} />
                {ko ? "설정으로 이동" : "Go to Settings"}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
