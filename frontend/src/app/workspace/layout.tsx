"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, FileText, BookOpen, Wrench, Code2, Cpu } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

const TABS = [
  { href: "/workspace/models",     key: "workspace.models",    Icon: Brain    },
  { href: "/workspace/prompts",    key: "workspace.prompts",   Icon: FileText },
  { href: "/workspace/knowledge",  key: "workspace.knowledge", Icon: BookOpen },
  { href: "/workspace/tools",      key: "workspace.tools",     Icon: Wrench   },
  { href: "/workspace/skills",     key: "workspace.skills",    Icon: Code2    },
  { href: "/workspace/fine-tune",  key: "workspace.finetune",  Icon: Cpu      },
] as const;

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <div className="flex h-full bg-base overflow-hidden">
      {/* Left sidebar nav */}
      <nav className="w-44 shrink-0 border-r border-border-subtle bg-surface flex flex-col pt-4 pb-4 gap-0.5 px-2">
        <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest px-3 mb-2">
          Workspace
        </p>
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              draggable={false}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors select-none ${
                active
                  ? "bg-hover text-text-primary font-medium"
                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
              }`}
            >
              <tab.Icon
                size={14}
                className={active ? "text-accent" : "text-text-muted"}
              />
              {t(tab.key)}
            </Link>
          );
        })}
      </nav>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {children}
      </div>
    </div>
  );
}
