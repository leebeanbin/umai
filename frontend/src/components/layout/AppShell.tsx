"use client";

import Sidebar from "./Sidebar";
import { useSidebar } from "@/components/providers/SidebarProvider";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed, toggle } = useSidebar();

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Mobile overlay backdrop — shown when sidebar is open on small screens */}
      {!collapsed && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={toggle}
          aria-hidden="true"
        />
      )}

      {/*
        Mobile  (<md): fixed overlay drawer — slides in/out via translate
        Desktop (≥md): in-flow panel — w-14 (icons) or w-64 (full)
      */}
      <div
        className={`
          fixed md:relative z-40 md:z-auto
          h-full shrink-0 overflow-hidden
          transition-[width,transform] duration-200 ease-in-out
          ${collapsed
            ? "-translate-x-full md:translate-x-0 md:w-14"
            : "translate-x-0 w-72 md:w-64"
          }
        `}
      >
        <Sidebar />
      </div>

      <main id="main-content" className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
