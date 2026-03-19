"use client";

import { useEffect, useState } from "react";
import {
  Users, MessageSquare, TrendingUp,
  TrendingDown, Activity, Calendar, BarChart3, BarChart2,
} from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { apiAdminStats, type AdminStatsOut } from "@/lib/api/backendClient";
import { AdminNav } from "@/components/admin/AdminNav";

type UserGrowth = { label: string; value: number; change: number | null };

export default function AdminAnalyticsPage() {
  const { lang } = useLanguage();
  const { user: me } = useAuth();
  const [stats, setStats] = useState<AdminStatsOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiAdminStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (me && me.role !== "admin") {
    return <div className="flex h-full items-center justify-center text-sm text-text-muted">관리자 권한이 필요합니다.</div>;
  }

  const statCards = stats ? [
    {
      label: lang === "ko" ? "전체 유저" : "Total Users",
      value: stats.total_users,
      icon: <Users size={16} className="text-accent" />,
      color: "text-accent",
      bg: "bg-accent/10",
      change: null,
    },
    {
      label: lang === "ko" ? "활성 유저" : "Active Users",
      value: stats.active_users,
      icon: <Activity size={16} className="text-green-400" />,
      color: "text-green-400",
      bg: "bg-green-400/10",
      change: stats.total_users > 0 ? Math.round((stats.active_users / stats.total_users) * 100) : 0,
      changeSuffix: "% active",
    },
    {
      label: lang === "ko" ? "전체 채팅" : "Total Chats",
      value: stats.total_chats,
      icon: <MessageSquare size={16} className="text-blue-400" />,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
      change: null,
    },
    {
      label: lang === "ko" ? "이번 주 신규" : "New This Week",
      value: stats.new_this_week,
      icon: <Calendar size={16} className="text-purple-400" />,
      color: "text-purple-400",
      bg: "bg-purple-400/10",
      change: null,
    },
  ] : [];

  return (
    <div className="flex h-full bg-base overflow-hidden">
      <AdminNav active="analytics" />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">{lang === "ko" ? "분석" : "Analytics"}</h2>
              <p className="text-xs text-text-muted mt-0.5">{lang === "ko" ? "인스턴스 사용 현황을 확인합니다." : "Monitor usage across your instance."}</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-text-muted py-12 justify-center">
              <Activity size={16} className="animate-pulse" />
              {lang === "ko" ? "로딩 중..." : "Loading..."}
            </div>
          ) : (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                {statCards.map((card) => (
                  <div key={card.label} className="p-4 rounded-2xl bg-surface border border-border">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`size-8 rounded-xl ${card.bg} flex items-center justify-center`}>
                        {card.icon}
                      </div>
                      <p className="text-xs text-text-muted">{card.label}</p>
                    </div>
                    <p className={`text-3xl font-bold ${card.color}`}>{card.value.toLocaleString()}</p>
                    {"changeSuffix" in card && card.changeSuffix && (
                      <p className="text-xs text-text-muted mt-1">{card.change}{card.changeSuffix}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Usage trends placeholder */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-text-primary mb-3">{lang === "ko" ? "사용 추이" : "Usage Trends"}</h3>
                <div className="bg-surface rounded-2xl border border-border p-6 flex flex-col items-center justify-center min-h-[200px] gap-3">
                  <div className="flex gap-1 items-end">
                    {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
                      <div
                        key={i}
                        className="w-8 rounded-t-md bg-accent/30 border border-accent/20 transition-all"
                        style={{ height: `${h}px` }}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-text-muted flex items-center gap-1.5">
                    <BarChart3 size={11} />
                    {lang === "ko" ? "실시간 데이터는 백엔드 API 연결 후 표시됩니다." : "Live data will display once the backend API is connected."}
                  </p>
                </div>
              </div>

              {/* Growth indicators */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-text-primary mb-3">{lang === "ko" ? "성장 지표" : "Growth Indicators"}</h3>
                <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                  {([
                    { label: lang === "ko" ? "유저 성장률 (7일)" : "User Growth (7d)",     trend: "up",   value: `+${stats?.new_this_week ?? 0}` },
                    { label: lang === "ko" ? "채팅 활성도"       : "Chat Activity",        trend: "up",   value: "—" },
                    { label: lang === "ko" ? "평균 세션 길이"    : "Avg. Session Length",  trend: "flat", value: "—" },
                    { label: lang === "ko" ? "대기 유저 수"      : "Pending Users",        trend: "flat", value: `${stats ? stats.total_users - stats.active_users : "—"}` },
                  ]).map((row, i, arr) => (
                    <div key={row.label} className={`flex items-center justify-between px-4 py-3 ${i < arr.length - 1 ? "border-b border-border-subtle" : ""}`}>
                      <p className="text-sm text-text-secondary">{row.label}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">{row.value}</span>
                        {row.trend === "up"   && <TrendingUp size={13} className="text-green-400" />}
                        {row.trend === "down" && <TrendingDown size={13} className="text-danger" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Model usage placeholder */}
              <div>
                <h3 className="text-sm font-semibold text-text-primary mb-3">{lang === "ko" ? "모델 사용 분포" : "Model Usage Distribution"}</h3>
                <div className="bg-surface rounded-2xl border border-border p-4">
                  {([
                    { model: "gpt-4o",              pct: 45, color: "bg-green-400" },
                    { model: "claude-sonnet-4-6",   pct: 30, color: "bg-purple-400" },
                    { model: "gemini-2.0-flash",    pct: 15, color: "bg-blue-400" },
                    { model: "others",              pct: 10, color: "bg-text-muted" },
                  ]).map((item) => (
                    <div key={item.model} className="mb-3 last:mb-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-secondary font-mono">{item.model}</span>
                        <span className="text-xs text-text-muted">{item.pct}%</span>
                      </div>
                      <div className="h-1.5 bg-hover rounded-full overflow-hidden">
                        <div className={`h-full ${item.color} rounded-full opacity-70`} style={{ width: `${item.pct}%` }} />
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-text-muted mt-3 flex items-center gap-1.5">
                    <BarChart3 size={10} />
                    {lang === "ko" ? "샘플 데이터입니다. 실제 데이터는 백엔드 연결 후 표시됩니다." : "Sample data. Live stats require backend API connection."}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
