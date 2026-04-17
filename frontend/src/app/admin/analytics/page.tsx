"use client";

import { useEffect, useState } from "react";
import {
  Users, MessageSquare, Activity, Calendar,
  TrendingUp, TrendingDown, Minus, RefreshCw,
  UserCheck, Shield, Clock, Zap,
} from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { apiAdminStats, type AdminStatsOut } from "@/lib/api/backendClient";
import { AdminNav } from "@/components/admin/AdminNav";

// ── Sparkline (SVG, no deps) ──────────────────────────────────────────────────

function Sparkline({ values, color = "#7c6af5", height = 40 }: {
  values: number[];
  color?: string;
  height?: number;
}) {
  if (values.length < 2) return null;
  const w = 120;
  const h = height;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xs = values.map((_, i) => pad + (i / (values.length - 1)) * (w - pad * 2));
  const ys = values.map((v) => pad + ((1 - (v - min) / range) * (h - pad * 2)));
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const fill = `${d} L${xs[xs.length - 1].toFixed(1)},${h} L${xs[0].toFixed(1)},${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#sg-${color.replace("#", "")})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Bar chart (SVG, no deps) ──────────────────────────────────────────────────

const WEEK_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function BarChart({ values, color = "#7c6af5" }: { values: number[]; color?: string }) {
  const max = Math.max(...values, 1);
  const h = 80;
  const w = 240;
  const barW = 24;
  const gap = (w - barW * values.length) / (values.length + 1);
  return (
    <svg width={w} height={h + 20} viewBox={`0 0 ${w} ${h + 20}`}>
      {values.map((v, i) => {
        const barH = Math.max(3, (v / max) * h);
        const x = gap + i * (barW + gap);
        const y = h - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx={4} fill={color} opacity={i === values.length - 1 ? 1 : 0.4} />
            <text x={x + barW / 2} y={h + 14} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.4}>
              {WEEK_LABELS[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Donut chart (SVG) ─────────────────────────────────────────────────────────

type Segment = { label: string; value: number; color: string };

function DonutChart({ segments, size = 80 }: { segments: Segment[]; size?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  const { result: arcs } = segments.reduce<{
    offset: number;
    result: Array<(typeof segments)[0] & { dash: number; gap: number; rotate: number }>;
  }>(
    ({ offset, result }, s) => {
      const pct = s.value / total;
      const dash = pct * circumference;
      return {
        offset: offset + pct,
        result: [...result, { ...s, dash, gap: circumference - dash, rotate: offset * 360 - 90 }],
      };
    },
    { offset: 0, result: [] },
  );

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {arcs.map((arc, i) => (
        <circle
          key={i}
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={arc.color}
          strokeWidth={8}
          strokeDasharray={`${arc.dash} ${arc.gap}`}
          strokeDashoffset={0}
          strokeLinecap="butt"
          transform={`rotate(${arc.rotate} ${cx} ${cy})`}
          opacity={0.85}
        />
      ))}
      {/* Center hole */}
      <circle cx={cx} cy={cy} r={r - 6} fill="var(--color-surface)" />
    </svg>
  );
}

// ── Derived metrics from API stats ────────────────────────────────────────────

function deriveMetrics(stats: AdminStatsOut) {
  const activeRate = stats.total_users > 0
    ? Math.round((stats.active_users / stats.total_users) * 100)
    : 0;
  const pendingUsers = stats.total_users - stats.active_users;
  const chatsPerUser = stats.active_users > 0
    ? (stats.total_chats / stats.active_users).toFixed(1)
    : "0";
  const weeklyGrowthRate = stats.total_users > 0
    ? ((stats.new_this_week / stats.total_users) * 100).toFixed(1)
    : "0";
  return { activeRate, pendingUsers, chatsPerUser, weeklyGrowthRate };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminAnalyticsPage() {
  const { lang } = useLanguage();
  const { user: me } = useAuth();
  const [stats, setStats] = useState<AdminStatsOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const ko = lang === "ko";

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const s = await apiAdminStats();
      setStats(s);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (me && me.role !== "admin") {
    return <div className="flex h-full items-center justify-center text-sm text-text-muted">관리자 권한이 필요합니다.</div>;
  }

  const m = stats ? deriveMetrics(stats) : null;

  // 실제 일별 데이터 사용 (API 미로드 시 빈 슬롯)
  const weeklyBars    = stats?.daily_chats   ?? [0, 0, 0, 0, 0, 0, 0];
  const signupSparkline = stats?.daily_signups ?? [0, 0, 0, 0, 0, 0, 0];

  const modelSegments: Segment[] = [
    { label: "OpenAI",    value: 45, color: "#10b981" },
    { label: "Anthropic", value: 30, color: "#a78bfa" },
    { label: "Google",    value: 15, color: "#60a5fa" },
    { label: "Ollama",    value: 10, color: "#f59e0b" },
  ];

  return (
    <div className="flex h-full bg-base overflow-hidden">
      <AdminNav active="analytics" />
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-5 max-w-4xl">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">{ko ? "분석 대시보드" : "Analytics"}</h2>
              <p className="text-xs text-text-muted mt-0.5">
                {ko ? "인스턴스 사용 현황 및 성장 지표" : "Usage overview and growth metrics for your instance"}
              </p>
            </div>
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-text-secondary border border-border hover:bg-hover transition-colors"
            >
              <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
              {ko ? "새로고침" : "Refresh"}
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-text-muted py-20 justify-center">
              <Activity size={16} className="animate-pulse" />
              {ko ? "로딩 중..." : "Loading..."}
            </div>
          ) : (
            <div className="space-y-5">

              {/* ── KPI cards ── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard
                  icon={<Users size={15} />}
                  iconBg="bg-accent/10"
                  iconColor="text-accent"
                  label={ko ? "전체 유저" : "Total Users"}
                  value={stats?.total_users ?? 0}
                  sub={m ? `${m.activeRate}% active` : undefined}
                  sparkline={stats ? signupSparkline : undefined}
                  sparkColor="#7c6af5"
                />
                <KpiCard
                  icon={<UserCheck size={15} />}
                  iconBg="bg-green-400/10"
                  iconColor="text-green-400"
                  label={ko ? "활성 유저" : "Active Users"}
                  value={stats?.active_users ?? 0}
                  trend={m && stats && stats.total_users > 0 ? (m.activeRate >= 70 ? "up" : m.activeRate >= 40 ? "flat" : "down") : undefined}
                  trendLabel={m ? `${m.activeRate}%` : undefined}
                  sparkline={stats ? signupSparkline : undefined}
                  sparkColor="#4ade80"
                />
                <KpiCard
                  icon={<MessageSquare size={15} />}
                  iconBg="bg-blue-400/10"
                  iconColor="text-blue-400"
                  label={ko ? "전체 채팅" : "Total Chats"}
                  value={stats?.total_chats ?? 0}
                  sub={m ? `${m.chatsPerUser} / ${ko ? "활성 유저" : "active user"}` : undefined}
                  sparkline={stats ? weeklyBars : undefined}
                  sparkColor="#60a5fa"
                />
                <KpiCard
                  icon={<Calendar size={15} />}
                  iconBg="bg-purple-400/10"
                  iconColor="text-purple-400"
                  label={ko ? "이번 주 신규" : "New This Week"}
                  value={stats?.new_this_week ?? 0}
                  trend={stats && stats.new_this_week > 0 ? "up" : "flat"}
                  trendLabel={m ? `+${m.weeklyGrowthRate}%` : undefined}
                  sparkline={weeklyBars}
                  sparkColor="#c084fc"
                />
              </div>

              {/* ── Two-column row: Weekly activity + Engagement ── */}
              <div className="grid grid-cols-2 gap-3">

                {/* Weekly activity bar chart */}
                <div className="bg-surface border border-border rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">{ko ? "주간 활동" : "Weekly Activity"}</p>
                      <p className="text-xs text-text-muted mt-0.5">{ko ? "최근 7일 채팅 생성 수" : "Chats created in the last 7 days"}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                      +{stats?.new_this_week ?? 0} {ko ? "명" : "users"}
                    </span>
                  </div>
                  <div className="text-text-muted">
                    <BarChart values={weeklyBars} color="#7c6af5" />
                  </div>
                </div>

                {/* Engagement metrics */}
                <div className="bg-surface border border-border rounded-2xl p-5">
                  <p className="text-sm font-semibold text-text-primary mb-4">{ko ? "참여 지표" : "Engagement"}</p>
                  <div className="space-y-3">
                    <MetricRow
                      icon={<Zap size={13} className="text-amber-400" />}
                      label={ko ? "활성화율" : "Activation Rate"}
                      value={`${m?.activeRate ?? 0}%`}
                      barPct={m?.activeRate ?? 0}
                      barColor="bg-amber-400"
                    />
                    <MetricRow
                      icon={<MessageSquare size={13} className="text-blue-400" />}
                      label={ko ? "유저당 채팅 수" : "Chats / User"}
                      value={m?.chatsPerUser ?? "0"}
                      barPct={Math.min(Number(m?.chatsPerUser ?? 0) * 10, 100)}
                      barColor="bg-blue-400"
                    />
                    <MetricRow
                      icon={<TrendingUp size={13} className="text-green-400" />}
                      label={ko ? "주간 성장률" : "Weekly Growth"}
                      value={`${m?.weeklyGrowthRate ?? 0}%`}
                      barPct={Math.min(Number(m?.weeklyGrowthRate ?? 0) * 5, 100)}
                      barColor="bg-green-400"
                    />
                    <MetricRow
                      icon={<Clock size={13} className="text-purple-400" />}
                      label={ko ? "대기 유저" : "Pending Users"}
                      value={String(m?.pendingUsers ?? 0)}
                      barPct={stats && stats.total_users > 0 ? ((m?.pendingUsers ?? 0) / stats.total_users) * 100 : 0}
                      barColor="bg-purple-400"
                    />
                  </div>
                </div>
              </div>

              {/* ── Two-column row: Model usage + User funnel ── */}
              <div className="grid grid-cols-2 gap-3">

                {/* Model usage donut + legend */}
                <div className="bg-surface border border-border rounded-2xl p-5">
                  <p className="text-sm font-semibold text-text-primary mb-4">{ko ? "모델 사용 분포" : "Model Distribution"}</p>
                  <div className="flex items-center gap-5">
                    <DonutChart segments={modelSegments} size={88} />
                    <div className="flex-1 space-y-2.5">
                      {modelSegments.map((seg) => (
                        <div key={seg.label} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="size-2 rounded-full shrink-0" style={{ background: seg.color }} />
                            <span className="text-xs text-text-secondary">{seg.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1 bg-hover rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${seg.value}%`, background: seg.color, opacity: 0.7 }} />
                            </div>
                            <span className="text-xs text-text-muted w-7 text-right">{seg.value}%</span>
                          </div>
                        </div>
                      ))}
                      <p className="text-[10px] text-text-muted pt-1">{ko ? "샘플 데이터" : "Sample data"}</p>
                    </div>
                  </div>
                </div>

                {/* User status funnel */}
                <div className="bg-surface border border-border rounded-2xl p-5">
                  <p className="text-sm font-semibold text-text-primary mb-4">{ko ? "유저 현황" : "User Status"}</p>
                  {stats ? (
                    <div className="space-y-3">
                      <FunnelRow
                        label={ko ? "전체 유저" : "Total"}
                        value={stats.total_users}
                        max={stats.total_users}
                        color="bg-accent"
                        icon={<Users size={12} className="text-accent" />}
                      />
                      <FunnelRow
                        label={ko ? "활성 유저" : "Active"}
                        value={stats.active_users}
                        max={stats.total_users}
                        color="bg-green-400"
                        icon={<UserCheck size={12} className="text-green-400" />}
                      />
                      <FunnelRow
                        label={ko ? "비활성" : "Inactive"}
                        value={Math.max(0, stats.total_users - stats.active_users)}
                        max={stats.total_users}
                        color="bg-orange-400"
                        icon={<Shield size={12} className="text-orange-400" />}
                      />
                      <FunnelRow
                        label={ko ? "이번 주 신규" : "New / week"}
                        value={stats.new_this_week}
                        max={Math.max(stats.total_users, 1)}
                        color="bg-purple-400"
                        icon={<TrendingUp size={12} className="text-purple-400" />}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-text-muted">—</p>
                  )}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  icon, iconBg, iconColor, label, value, sub,
  trend, trendLabel, sparkline, sparkColor,
}: {
  icon: React.ReactNode;
  iconBg: string; iconColor: string;
  label: string; value: number;
  sub?: string;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
  sparkline?: number[];
  sparkColor?: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <div className={`size-8 rounded-xl ${iconBg} flex items-center justify-center ${iconColor}`}>
          {icon}
        </div>
        {trend && trendLabel && (
          <span className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
            trend === "up"   ? "text-green-400 bg-green-400/10" :
            trend === "down" ? "text-red-400 bg-red-400/10"     : "text-text-muted bg-hover"
          }`}>
            {trend === "up"   && <TrendingUp size={9} />}
            {trend === "down" && <TrendingDown size={9} />}
            {trend === "flat" && <Minus size={9} />}
            {trendLabel}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-text-primary tabular-nums">{value.toLocaleString()}</p>
        <p className="text-xs text-text-muted mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-text-muted mt-0.5 opacity-70">{sub}</p>}
      </div>
      {sparkline && (
        <div className="flex justify-end -mb-1 opacity-60">
          <Sparkline values={sparkline} color={sparkColor} height={32} />
        </div>
      )}
    </div>
  );
}

function MetricRow({
  icon, label, value, barPct, barColor,
}: {
  icon: React.ReactNode;
  label: string; value: string;
  barPct: number; barColor: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs text-text-secondary">{label}</span>
        </div>
        <span className="text-xs font-medium text-text-primary tabular-nums">{value}</span>
      </div>
      <div className="h-1 bg-hover rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-700 opacity-70`}
          style={{ width: `${Math.min(Math.max(barPct, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

function FunnelRow({
  icon, label, value, max, color,
}: {
  icon: React.ReactNode;
  label: string; value: number; max: number; color: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 w-24 shrink-0">
        {icon}
        <span className="text-xs text-text-secondary truncate">{label}</span>
      </div>
      <div className="flex-1 h-2 bg-hover rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full opacity-70 transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-text-primary tabular-nums w-8 text-right">{value}</span>
    </div>
  );
}
