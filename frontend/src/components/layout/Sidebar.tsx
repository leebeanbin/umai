"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare, ImageIcon, Plus, Search, Settings,
  ChevronRight, Folder, FolderOpen, MoreHorizontal,
  PenLine, Trash2, FolderPlus, X, LayoutGrid, PanelLeft,
  FlaskConical, Shield, ChevronUp, Share2,
} from "lucide-react";
import ChatShareModal from "@/components/chat/ChatShareModal";
import {
  loadFolders, saveFolders, loadSessions, saveSessions,
  groupByTime,
  type Folder as FolderType, type Session,
} from "@/lib/store";
import { apiDeleteChat, apiUpdateFolder, apiDeleteFolder, apiCreateFolder } from "@/lib/api/backendClient";
import SettingsModal from "./SettingsModal";
import FolderModal from "./FolderModal";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useSidebar } from "@/components/providers/SidebarProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { LogOut } from "lucide-react";
import { getPastelColor, getInitials } from "@/lib/utils/avatar";

type ContextTarget = { type: "session" | "folder"; id: string; x: number; y: number };

export default function Sidebar() {
  const pathname = usePathname();
  useRouter(); // keep for potential future navigation
  const { t } = useLanguage();
  const { collapsed, toggle } = useSidebar();
  const { user, logout } = useAuth();
  const [search, setSearch]   = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [folders, setFolders]   = useState<FolderType[]>(() => loadFolders());
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions());
  const [showSettings, setShowSettings] = useState(false);
  const [contextMenu, setContextMenu]   = useState<ContextTarget | null>(null);
  const [shareSessionId, setShareSessionId] = useState<string | null>(null);
  const [folderModal, setFolderModal]   = useState<{ open: boolean; editing: FolderType | null }>({ open: false, editing: null });
  const [renamingId, setRenamingId]     = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Memoized computed values ──────────────────────────────────────────────
  const filteredSessions = useMemo(() =>
    sessions.filter((s) => !search || s.title.toLowerCase().includes(search.toLowerCase())),
    [sessions, search]
  );

  const folderSessions = useCallback((folderId: string) =>
    filteredSessions.filter((s) => s.folderId === folderId),
    [filteredSessions]
  );

  const unfolderedSessions = useMemo(() =>
    filteredSessions.filter((s) => s.folderId === null),
    [filteredSessions]
  );

  const { today, yesterday, older } = useMemo(() =>
    groupByTime(unfolderedSessions),
    [unfolderedSessions]
  );

  // ── Stable handlers (useCallback) ────────────────────────────────────────
  const toggleFolder = useCallback((id: string) => {
    setFolders((prev) => prev.map((f) => f.id === id ? { ...f, open: !f.open } : f));
  }, []);

  const openCreateFolder = useCallback(() => {
    setFolderModal({ open: true, editing: null });
  }, []);

  const openEditFolder = useCallback((folder: FolderType) => {
    setContextMenu(null);
    setFolderModal({ open: true, editing: folder });
  }, []);

  const saveFolder = useCallback((data: Omit<FolderType, "id" | "open">) => {
    setFolderModal((prev) => {
      if (prev.editing) {
        setFolders((flds) => flds.map((f) => f.id === prev.editing!.id ? { ...f, ...data } : f));
        if (localStorage.getItem("umai_access_token")) {
          apiUpdateFolder(prev.editing.id, { name: data.name, description: data.description, system_prompt: data.systemPrompt }).catch(() => {});
        }
      } else {
        const newId = crypto.randomUUID();
        setFolders((flds) => [...flds, { id: newId, open: true, ...data }]);
        if (localStorage.getItem("umai_access_token")) {
          apiCreateFolder(data.name, data.description, data.systemPrompt).catch(() => {});
        }
      }
      return { open: false, editing: null };
    });
  }, []);

  const startRenameSession = useCallback((id: string) => {
    setContextMenu(null);
    setRenamingId(id);
    // Focus is handled inside SessionItem's useEffect
  }, []);

  const commitRename = useCallback((id: string, value: string) => {
    if (value.trim()) {
      setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: value.trim() } : s));
    }
    setRenamingId(null);
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    localStorage.removeItem(`umai_msgs_${id}`);
    if (localStorage.getItem("umai_access_token")) {
      apiDeleteChat(id).catch(() => {});
    }
  }, []);

  const deleteFolder = useCallback((id: string) => {
    setSessions((prev) => prev.map((s) => s.folderId === id ? { ...s, folderId: null } : s));
    setFolders((prev) => prev.filter((f) => f.id !== id));
    if (localStorage.getItem("umai_access_token")) {
      apiDeleteFolder(id).catch(() => {});
    }
  }, []);

  const sessionHref = useCallback((s: Session) =>
    s.type === "editor" ? `/editor/${s.id}` : `/chat/${s.id}`,
    []
  );

  const handleSessionContext = useCallback((id: string, e: React.MouseEvent) => {
    setContextMenu({ type: "session", id, x: e.clientX, y: e.clientY });
  }, []);

  const closeFolderModal = useCallback(() =>
    setFolderModal({ open: false, editing: null }),
    []
  );

  // ── localStorage 자동 저장 ────────────────────────────────────────────────
  useEffect(() => { saveFolders(folders); }, [folders]);
  useEffect(() => { saveSessions(sessions); }, [sessions]);

  // 다른 컴포넌트에서 세션이 추가되면 다시 로드
  useEffect(() => {
    function onSessionsChange() { setSessions(loadSessions()); }
    window.addEventListener("umai:sessions-change", onSessionsChange);
    return () => window.removeEventListener("umai:sessions-change", onSessionsChange);
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") { setContextMenu(null); setShowUserMenu(false); }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    function handler() { setShowSettings(true); }
    window.addEventListener("umai:open-settings", handler);
    return () => window.removeEventListener("umai:open-settings", handler);
  }, []);

  return (
    <>
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      {shareSessionId && (
        <ChatShareModal
          sessionId={shareSessionId}
          sessionTitle={sessions.find((s) => s.id === shareSessionId)?.title ?? "Chat"}
          onClose={() => setShareSessionId(null)}
        />
      )}
      <FolderModal
        open={folderModal.open}
        folder={folderModal.editing}
        onClose={closeFolderModal}
        onSave={saveFolder}
      />

      {/* 컨텍스트 메뉴 */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 w-44 bg-elevated border border-border rounded-xl shadow-xl overflow-hidden py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.type === "session" ? (
              <>
                <button
                  onClick={() => startRenameSession(contextMenu.id)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
                >
                  <PenLine size={13} />{t("sidebar.rename")}
                </button>
                <button
                  onClick={() => { setShareSessionId(contextMenu.id); setContextMenu(null); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
                >
                  <Share2 size={13} />공유 및 내보내기
                </button>
                <div className="my-1 mx-2 border-t border-border" />
                <button
                  onClick={() => { deleteSession(contextMenu.id); setContextMenu(null); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-hover transition-colors"
                >
                  <Trash2 size={13} />{t("sidebar.delete")}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => openEditFolder(folders.find((f) => f.id === contextMenu.id)!)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
                >
                  <PenLine size={13} />{t("sidebar.editFolder")}
                </button>
                <div className="my-1 mx-2 border-t border-border" />
                <button
                  onClick={() => { deleteFolder(contextMenu.id); setContextMenu(null); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-hover transition-colors"
                >
                  <Trash2 size={13} />{t("sidebar.delete")}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Collapsed: 아이콘 바 ── */}
      {collapsed ? (
        <aside className="flex flex-col items-center h-full w-14 bg-surface border-r border-border-subtle select-none py-2 gap-1">
          <button
            onClick={toggle}
            title={t("navbar.toggleSidebar")}
            className="p-2 rounded-xl text-text-muted hover:bg-hover hover:text-text-primary transition-colors"
          >
            <PanelLeft size={16} className="rotate-180" />
          </button>

          <Link
            href="/chat/new"
            title={t("sidebar.newChat")}
            className="p-2 rounded-xl text-accent hover:bg-accent/10 transition-colors"
          >
            <Plus size={16} />
          </Link>

          <div className="w-6 border-t border-border-subtle my-1" />

          <IconNavItem href="/chat"       icon={<MessageSquare size={16} />} label={t("nav.chat")}       active={pathname === "/chat"} />
          <IconNavItem href="/editor"     icon={<ImageIcon size={16} />}     label={t("nav.editor")}     active={pathname.startsWith("/editor")} />
          <IconNavItem href="/workspace"  icon={<LayoutGrid size={16} />}    label={t("nav.workspace")}  active={pathname.startsWith("/workspace")} />
          <IconNavItem href="/playground" icon={<FlaskConical size={16} />}  label={t("nav.playground")} active={pathname.startsWith("/playground")} />

          <div className="flex-1" />

          <div className="relative">
            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 bg-elevated border border-border rounded-xl shadow-xl overflow-hidden py-1 z-50">
                  <button
                    onClick={() => { setShowSettings(true); setShowUserMenu(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
                  >
                    <Settings size={13} />{t("settings.title")}
                  </button>
                  {user?.role === "admin" && (
                    <>
                      <div className="my-1 mx-2 border-t border-border" />
                      <Link
                        href="/admin"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
                      >
                        <Shield size={13} />{t("nav.admin")}
                      </Link>
                    </>
                  )}
                  {user && (
                    <>
                      <div className="my-1 mx-2 border-t border-border" />
                      <button
                        onClick={() => { setShowUserMenu(false); logout(); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-danger hover:bg-hover transition-colors"
                      >
                        <LogOut size={13} />{t("auth.logout")}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            <button
              onClick={() => setShowUserMenu((v) => !v)}
              className="p-2 rounded-xl text-text-muted hover:bg-hover hover:text-text-secondary transition-colors"
            >
              {(() => {
                const pastel = user ? getPastelColor(user.id) : { bg: "hsl(220,55%,82%)", text: "hsl(220,45%,32%)" };
                const initials = user ? getInitials(user.name) : "U";
                return user?.avatar_url
                  ? <img src={user.avatar_url} alt={user.name} className="size-6 rounded-full object-cover" />
                  : <div className="size-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: pastel.bg, color: pastel.text }}>{initials}</div>;
              })()}
            </button>
          </div>
        </aside>
      ) : (
        /* ── Expanded: 풀 사이드바 ── */
        <aside className="flex flex-col h-full w-64 shrink-0 bg-surface border-r border-border-subtle select-none">

          <div className="flex items-center justify-between px-3 py-3 border-b border-border-subtle">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="size-7 rounded-lg bg-accent flex items-center justify-center text-xs font-bold text-white">U</div>
              <span className="text-sm font-semibold text-text-primary">Umai-bin</span>
            </Link>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => { setShowSearch((v) => !v); if (showSearch) setSearch(""); }}
                className={`p-1.5 rounded-lg transition-colors ${
                  showSearch ? "bg-accent/15 text-accent" : "text-text-muted hover:bg-hover hover:text-text-secondary"
                }`}
              >
                {showSearch ? <X size={14} /> : <Search size={14} />}
              </button>
              <button
                onClick={toggle}
                title={t("navbar.toggleSidebar")}
                className="p-1.5 rounded-lg text-text-muted hover:bg-hover hover:text-text-secondary transition-colors"
              >
                <PanelLeft size={14} />
              </button>
            </div>
          </div>

          {showSearch && (
            <div className="px-3 py-2 border-b border-border-subtle">
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (setShowSearch(false), setSearch(""))}
                placeholder={t("sidebar.search")}
                className="w-full px-3 py-1.5 rounded-lg text-sm bg-elevated border border-border text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
              />
            </div>
          )}

          <div className="px-3 pt-3 pb-1">
            <Link
              href="/chat/new"
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm font-medium text-accent bg-accent/10 border border-accent/20 hover:bg-accent/15 transition-colors"
            >
              <Plus size={14} />{t("sidebar.newChat")}
            </Link>
          </div>

          <nav className="px-3 py-1 flex flex-col gap-0.5">
            <NavItem href="/chat"       icon={<MessageSquare size={14} />} label={t("nav.chat")}       active={pathname === "/chat"} />
            <NavItem href="/editor"     icon={<ImageIcon size={14} />}     label={t("nav.editor")}     active={pathname.startsWith("/editor")} />
            <NavItem href="/workspace"  icon={<LayoutGrid size={14} />}    label={t("nav.workspace")}  active={pathname.startsWith("/workspace")} />
            <NavItem href="/playground" icon={<FlaskConical size={14} />}  label={t("nav.playground")} active={pathname.startsWith("/playground")} />
          </nav>

          <div className="mx-3 my-1.5 border-t border-border-subtle" />

          <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2">

            {folders.map((folder) => {
              const children = folderSessions(folder.id);
              return (
                <div key={folder.id} className="mb-0.5">
                  <div className="flex items-center gap-1 px-1 py-1 rounded-lg group hover:bg-hover transition-colors">
                    <button
                      onClick={() => toggleFolder(folder.id)}
                      className="flex items-center gap-1.5 flex-1 min-w-0 text-sm text-text-secondary"
                    >
                      <ChevronRight
                        size={13}
                        className={`shrink-0 text-text-muted transition-transform duration-150 ${folder.open ? "rotate-90" : ""}`}
                      />
                      {folder.open
                        ? <FolderOpen size={14} className="shrink-0 text-accent/70" />
                        : <Folder size={14} className="shrink-0 text-text-muted" />
                      }
                      <span className="truncate">{folder.name}</span>
                      <span className="text-xs text-text-muted ml-auto shrink-0 pr-1">
                        {children.length > 0 ? children.length : ""}
                      </span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setContextMenu({ type: "folder", id: folder.id, x: e.clientX, y: e.clientY }); }}
                      className="shrink-0 p-1 rounded-md opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-secondary transition-all"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  </div>

                  {folder.open && (
                    <div className="ml-5 flex flex-col gap-0.5 mt-0.5 border-l border-border-subtle pl-2">
                      {children.map((s) => (
                        <SessionItem
                          key={s.id}
                          session={s}
                          href={sessionHref(s)}
                          active={pathname === sessionHref(s)}
                          isRenaming={renamingId === s.id}
                          renameInputRef={renamingId === s.id ? renameInputRef : undefined}
                          onCommitRename={(val) => commitRename(s.id, val)}
                          onContext={(e) => handleSessionContext(s.id, e)}
                        />
                      ))}
                      {children.length === 0 && (
                        <p className="text-xs text-text-muted px-2 py-1 italic">{t("sidebar.empty")}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onClick={openCreateFolder}
              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-xs text-text-muted hover:bg-hover hover:text-text-secondary transition-colors mt-0.5"
            >
              <FolderPlus size={13} />{t("sidebar.newFolder")}
            </button>

            <div className="mx-1 my-2 border-t border-border-subtle" />

            {today.length > 0 && (
              <SessionGroup
                label={t("sidebar.today")} sessions={today}
                sessionHref={sessionHref}
                renamingId={renamingId}
                renameInputRef={renameInputRef}
                onCommitRename={commitRename}
                onContext={handleSessionContext}
                pathname={pathname}
              />
            )}
            {yesterday.length > 0 && (
              <SessionGroup
                label={t("sidebar.yesterday")} sessions={yesterday}
                sessionHref={sessionHref}
                renamingId={renamingId}
                renameInputRef={renameInputRef}
                onCommitRename={commitRename}
                onContext={handleSessionContext}
                pathname={pathname}
              />
            )}
            {older.length > 0 && (
              <SessionGroup
                label={t("sidebar.older")} sessions={older}
                sessionHref={sessionHref}
                renamingId={renamingId}
                renameInputRef={renameInputRef}
                onCommitRename={commitRename}
                onContext={handleSessionContext}
                pathname={pathname}
              />
            )}

            {filteredSessions.length === 0 && (
              <p className="text-xs text-text-muted text-center py-6">
                {search ? `"${search}" — ${t("sidebar.noSessions")}` : t("sidebar.noSessions")}
              </p>
            )}
          </div>

          {/* 하단 사용자 */}
          <div className="shrink-0 px-3 py-3 border-t border-border-subtle relative">
            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className="absolute bottom-full left-3 right-3 mb-2 bg-elevated border border-border rounded-xl shadow-xl overflow-hidden py-1 z-50">
                  <button
                    onClick={() => { setShowSettings(true); setShowUserMenu(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
                  >
                    <Settings size={13} />{t("settings.title")}
                  </button>
                  {user?.role === "admin" && (
                    <>
                      <div className="my-1 mx-2 border-t border-border" />
                      <Link
                        href="/admin"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
                      >
                        <Shield size={13} />{t("nav.admin")}
                      </Link>
                    </>
                  )}
                  {user && (
                    <>
                      <div className="my-1 mx-2 border-t border-border" />
                      <button
                        onClick={() => { setShowUserMenu(false); logout(); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-danger hover:bg-hover transition-colors"
                      >
                        <LogOut size={13} />{t("auth.logout")}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            <button
              onClick={() => setShowUserMenu((v) => !v)}
              className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-xl text-sm text-text-secondary hover:bg-hover transition-colors group"
            >
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt={user.name} className="size-6 rounded-full object-cover shrink-0" />
              ) : (() => {
                const pastel = user ? getPastelColor(user.id) : { bg: "hsl(220,55%,82%)", text: "hsl(220,45%,32%)" };
                const initials = user ? getInitials(user.name) : "U";
                return <div className="size-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: pastel.bg, color: pastel.text }}>{initials}</div>;
              })()}
              <span className="flex-1 text-left truncate text-text-secondary">{user?.name ?? t("sidebar.user")}</span>
              <ChevronUp size={13} className={`text-text-muted transition-transform ${showUserMenu ? "" : "rotate-180"}`} />
            </button>
          </div>
        </aside>
      )}
    </>
  );
}

// ── Sub-components (memoized) ─────────────────────────────────────────────────

const IconNavItem = memo(function IconNavItem({ href, icon, label, active }: {
  href: string; icon: React.ReactNode; label: string; active: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={`p-2 rounded-xl transition-colors ${
        active ? "bg-hover text-text-primary" : "text-text-muted hover:bg-hover hover:text-text-secondary"
      }`}
    >
      {icon}
    </Link>
  );
});

const NavItem = memo(function NavItem({ href, icon, label, active }: {
  href: string; icon: React.ReactNode; label: string; active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-2xl text-sm transition-colors ${
        active ? "bg-hover text-text-primary" : "text-text-secondary hover:bg-hover hover:text-text-primary"
      }`}
    >
      {icon}{label}
    </Link>
  );
});

type SessionItemProps = {
  session: Session;
  href: string;
  active: boolean;
  isRenaming?: boolean;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  onCommitRename?: (val: string) => void;
  onContext: (e: React.MouseEvent) => void;
};

const SessionItem = memo(function SessionItem({
  session, href, active, isRenaming, renameInputRef, onCommitRename, onContext,
}: SessionItemProps) {
  const [editVal, setEditVal] = useState(session.title);

  // Sync editVal when not actively renaming (e.g., after external updateSessionTitle)
  useEffect(() => {
    if (!isRenaming) setEditVal(session.title);
  }, [isRenaming, session.title]);

  // Handle focus with cleanup when rename starts
  useEffect(() => {
    if (!isRenaming || !renameInputRef) return;
    const timerId = setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 30);
    return () => clearTimeout(timerId);
  }, [isRenaming, renameInputRef]);

  if (isRenaming) {
    return (
      <div className="px-2 py-1">
        <input
          ref={renameInputRef as React.RefObject<HTMLInputElement>}
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={() => onCommitRename?.(editVal)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename?.(editVal);
            if (e.key === "Escape") onCommitRename?.(session.title);
          }}
          className="w-full px-2 py-1 rounded-lg bg-elevated border border-accent text-sm text-text-primary outline-none"
        />
      </div>
    );
  }

  return (
    <Link
      href={href}
      onContextMenu={(e) => { e.preventDefault(); onContext(e); }}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-xl text-sm group transition-colors ${
        active ? "bg-hover text-text-primary" : "text-text-secondary hover:bg-hover hover:text-text-primary"
      }`}
    >
      {session.type === "editor"
        ? <ImageIcon size={12} className="shrink-0 text-accent" />
        : <MessageSquare size={12} className="shrink-0 text-text-muted" />}
      <span className="truncate flex-1">{session.title}</span>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onContext(e); }}
        className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-secondary transition-all"
      >
        <MoreHorizontal size={12} />
      </button>
    </Link>
  );
}, (prev, next) =>
  prev.session.id    === next.session.id    &&
  prev.session.title === next.session.title &&
  prev.session.type  === next.session.type  &&
  prev.href          === next.href          &&
  prev.active        === next.active        &&
  prev.isRenaming    === next.isRenaming    &&
  prev.onCommitRename === next.onCommitRename &&
  prev.onContext     === next.onContext
);

type SessionGroupProps = {
  label: string;
  sessions: Session[];
  sessionHref: (s: Session) => string;
  renamingId: string | null;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onCommitRename: (id: string, val: string) => void;
  onContext: (id: string, e: React.MouseEvent) => void;
  pathname: string;
};

const SessionGroup = memo(function SessionGroup({
  label, sessions, sessionHref, renamingId, renameInputRef, onCommitRename, onContext, pathname,
}: SessionGroupProps) {
  return (
    <div className="mb-3">
      <p className="px-2 py-1 text-xs font-medium text-text-muted uppercase tracking-wider">{label}</p>
      {sessions.map((s) => (
        <SessionItem
          key={s.id}
          session={s}
          href={sessionHref(s)}
          active={pathname === sessionHref(s)}
          isRenaming={renamingId === s.id}
          renameInputRef={renamingId === s.id ? renameInputRef : undefined}
          onCommitRename={(val) => onCommitRename(s.id, val)}
          onContext={(e) => onContext(s.id, e)}
        />
      ))}
    </div>
  );
}, (prev, next) =>
  prev.label      === next.label      &&
  prev.sessions   === next.sessions   &&
  prev.renamingId === next.renamingId &&
  prev.pathname   === next.pathname   &&
  prev.sessionHref    === next.sessionHref    &&
  prev.onCommitRename === next.onCommitRename &&
  prev.onContext       === next.onContext
);
