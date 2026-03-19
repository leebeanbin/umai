"use client";

import Link from "next/link";
import { Users, BarChart2, Star, Settings } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

type AdminTab = "users" | "analytics" | "evaluations" | "settings";

interface Props {
  active: AdminTab;
}

export function AdminNav({ active }: Props) {
  const { t } = useLanguage();

  const navItems: { id: AdminTab; href: string; icon: React.ReactNode; label: string }[] = [
    { id: "users",       href: "/admin",             icon: <Users size={14} />,    label: t("admin.tab.users") },
    { id: "analytics",   href: "/admin/analytics",   icon: <BarChart2 size={14} />, label: "Analytics" },
    { id: "evaluations", href: "/admin/evaluations", icon: <Star size={14} />,      label: "Evaluations" },
    { id: "settings",    href: "/admin/settings",    icon: <Settings size={14} />,  label: "Settings" },
  ];

  return (
    <nav className="w-44 shrink-0 border-r border-border bg-surface flex flex-col pt-4 gap-0.5 px-2">
      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest px-3 mb-2">Admin</p>
      {navItems.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors ${
            active === item.id
              ? "bg-accent/10 text-accent font-medium"
              : "text-text-secondary hover:bg-hover hover:text-text-primary"
          }`}
        >
          <span className={active === item.id ? "text-accent" : "text-text-muted"}>{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
