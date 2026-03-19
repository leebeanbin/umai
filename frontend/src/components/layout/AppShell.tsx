"use client";

import Sidebar from "./Sidebar";
import { useSidebar } from "@/components/providers/SidebarProvider";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — full width or narrow icon bar */}
      <div className={`shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden ${collapsed ? "w-14" : "w-64"}`}>
        <Sidebar />
      </div>

      <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
