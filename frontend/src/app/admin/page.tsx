"use client";

import { useEffect, useState } from "react";
import { Shield, Users, Settings, Search, MoreHorizontal, Crown, User, Ban, Loader2, ChevronRight, BarChart3 } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  apiAdminListUsers, apiAdminUpdateUser, apiAdminDeleteUser, apiAdminStats,
  type AdminUserOut, type AdminStatsOut,
} from "@/lib/api/backendClient";
import { getPastelColor, getInitials } from "@/lib/utils/avatar";
import { type TranslationKey } from "@/lib/i18n";
import { AdminNav } from "@/components/admin/AdminNav";

type TFn = (key: TranslationKey) => string;

const ROLE_STYLES: Record<string, string> = {
  admin:   "text-amber-400 bg-amber-400/10 border-amber-400/20",
  user:    "text-blue-400  bg-blue-400/10  border-blue-400/20",
  pending: "text-text-muted bg-hover border-border",
};

export default function AdminPage() {
  const { t } = useLanguage();
  const { user: me } = useAuth();

  if (me && me.role !== "admin") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        관리자 권한이 필요합니다.
      </div>
    );
  }

  return (
    <div className="flex h-full bg-base overflow-hidden">
      <AdminNav active="users" />
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <UsersPanel t={t} />
      </div>
    </div>
  );
}

function UsersPanel({ t }: { t: TFn }) {
  const [users, setUsers]   = useState<AdminUserOut[]>([]);
  const [stats, setStats]   = useState<AdminStatsOut | null>(null);
  const [query, setQuery]   = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState("");

  useEffect(() => {
    Promise.all([apiAdminListUsers(), apiAdminStats()])
      .then(([u, s]) => { setUsers(u); setStats(s); })
      .catch(() => setError("데이터를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = users.filter((u) =>
    !query ||
    u.name.toLowerCase().includes(query.toLowerCase()) ||
    u.email.toLowerCase().includes(query.toLowerCase())
  );

  async function updateRole(id: string, role: "admin" | "user" | "pending") {
    try {
      const updated = await apiAdminUpdateUser(id, { role });
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, ...updated } : u));
    } catch { /* ignore */ }
  }

  async function toggleActive(id: string, is_active: boolean) {
    try {
      const updated = await apiAdminUpdateUser(id, { is_active });
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, ...updated } : u));
    } catch { /* ignore */ }
  }

  async function deleteUser(id: string) {
    if (!confirm("이 유저를 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
    try {
      await apiAdminDeleteUser(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted gap-2">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">로딩 중...</span>
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-danger mt-8 text-center">{error}</div>;
  }

  return (
    <div className="flex flex-col gap-4 mt-2 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{t("admin.tab.users")}</h2>
          <p className="text-xs text-text-muted mt-0.5">{users.length} {t("admin.users.count")}</p>
        </div>
        <Link
          href="/admin/settings"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-text-secondary border border-border hover:bg-hover transition-colors"
        >
          <Settings size={12} />
          설정
          <ChevronRight size={11} />
        </Link>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "전체 유저", value: stats.total_users,  color: "text-text-primary" },
            { label: "활성 유저", value: stats.active_users, color: "text-accent" },
            { label: "전체 채팅", value: stats.total_chats,  color: "text-blue-400" },
          ].map((stat) => (
            <div key={stat.label} className="p-4 rounded-2xl bg-surface border border-border">
              <div className="flex items-center gap-1.5 mb-1">
                <BarChart3 size={11} className="text-text-muted" />
                <p className="text-xs text-text-muted">{stat.label}</p>
              </div>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search + table */}
      <div className="bg-surface rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={13} className="text-text-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 또는 이메일 검색..."
            className="w-full text-sm bg-transparent outline-none text-text-primary placeholder:text-text-muted"
          />
        </div>

        <div className="divide-y divide-border">
          {filtered.length === 0 && (
            <p className="text-center text-sm text-text-muted py-8">검색 결과 없음</p>
          )}
          {filtered.map((user) => {
            const pastel = getPastelColor(user.id);
            return (
              <div key={user.id} className="flex items-center gap-3 px-4 py-3 hover:bg-hover transition-colors group">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.name} className="size-8 rounded-full object-cover shrink-0" />
                ) : (
                  <div
                    className="size-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                    style={{ background: pastel.bg, color: pastel.text }}
                  >
                    {getInitials(user.name)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{user.name}</p>
                  <p className="text-xs text-text-muted truncate">{user.email}</p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${ROLE_STYLES[user.role] ?? ROLE_STYLES.user}`}>
                  {user.role}
                </span>
                {!user.is_active && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
                    정지됨
                  </span>
                )}
                <p className="text-xs text-text-muted hidden sm:block shrink-0 w-16 text-right">
                  {user.last_seen_at ? formatRelative(new Date(user.last_seen_at)) : "-"}
                </p>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <UserMenu
                    user={user}
                    onSetRole={updateRole}
                    onToggleActive={toggleActive}
                    onDelete={deleteUser}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UserMenu({
  user,
  onSetRole,
  onToggleActive,
  onDelete,
}: {
  user: AdminUserOut;
  onSetRole: (id: string, role: "admin" | "user" | "pending") => void;
  onToggleActive: (id: string, is_active: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-lg hover:bg-hover text-text-muted hover:text-text-secondary transition-colors"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-44 bg-elevated border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
            {user.role !== "admin" && (
              <button
                onClick={() => { onSetRole(user.id, "admin"); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:bg-hover transition-colors"
              >
                <Crown size={12} className="text-amber-400" /> 관리자로 설정
              </button>
            )}
            {user.role !== "user" && (
              <button
                onClick={() => { onSetRole(user.id, "user"); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:bg-hover transition-colors"
              >
                <User size={12} /> 일반 유저로 설정
              </button>
            )}
            <div className="my-1 mx-2 border-t border-border" />
            <button
              onClick={() => { onToggleActive(user.id, !user.is_active); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:bg-hover transition-colors"
            >
              <Ban size={12} className={user.is_active ? "text-orange-400" : "text-accent"} />
              {user.is_active ? "계정 정지" : "정지 해제"}
            </button>
            <div className="my-1 mx-2 border-t border-border" />
            <button
              onClick={() => { onDelete(user.id); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-400 hover:bg-hover transition-colors"
            >
              <Shield size={12} /> 유저 삭제
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60000)    return "방금";
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  return `${Math.floor(diff / 86400000)}일 전`;
}
