"use client";

/**
 * Reusable model selector dropdown.
 * Used by ChatNavbar and Playground.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check, Sliders, Loader2 } from "lucide-react";
import { loadModels, fetchModels, type DynamicModel } from "@/lib/appStore";
import { useLanguage } from "@/components/providers/LanguageProvider";

type TagFilter = "All" | "Vision" | "Fast";

type Props = {
  value:     DynamicModel;
  onChange:  (m: DynamicModel) => void;
  /** Show the session-parameters (temperature) panel. Default true. */
  showTuning?: boolean;
};

export default function ModelSelect({ value, onChange, showTuning = true }: Props) {
  const { t }       = useLanguage();
  const dropRef     = useRef<HTMLDivElement>(null);
  const searchRef   = useRef<HTMLInputElement>(null);

  // [] on SSR — localStorage는 클라이언트 전용이므로 lazy init 대신 useEffect로 로드
  const [models, setModels] = useState<DynamicModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState(false);
  const [open, setOpen]           = useState(false);
  const [query, setQuery]         = useState("");
  const [tagFilter, setTagFilter] = useState<TagFilter>("All");
  const [showParams, setShowParams]   = useState(false);
  const [temperature, setTemperature] = useState<number | null>(null);

  const filtered = useMemo(() => models.filter((m) => {
    const matchQ   = !query || m.name.toLowerCase().includes(query.toLowerCase()) || m.provider.toLowerCase().includes(query.toLowerCase());
    const matchTag = tagFilter === "All" || m.tags.includes(tagFilter as string);
    return matchQ && matchTag;
  }), [models, query, tagFilter]);

  // 마운트 후: localStorage 초기값 로드 → API에서 최신 목록으로 갱신 (stale-while-revalidate)
  useEffect(() => {
    const cached = loadModels();
    setModels(cached); // eslint-disable-line react-hooks/set-state-in-effect
    if (cached.length > 0) setModelsLoading(false);
    fetchModels().then((fresh) => {
      if (fresh.length > 0) {
        setModels(fresh);
        setModelsError(false);
      }
      setModelsLoading(false);
    }).catch(() => {
      setModelsError(true);
      setModelsLoading(false);
    });
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
    else { setQuery(""); setShowParams(false); } // eslint-disable-line react-hooks/set-state-in-effect
  }, [open]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const tempVal = temperature ?? 0.8;

  return (
    <div className="relative" ref={dropRef}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium bg-surface border border-border hover:border-accent/50 transition-colors"
      >
        <span className="relative flex size-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-accent" />
        </span>
        <span className="text-text-primary">{value.name}</span>
        <span className="text-xs text-text-muted">{value.provider}</span>
        <ChevronDown size={13} className={`text-text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-72 rounded-2xl bg-elevated border border-border shadow-2xl overflow-hidden z-30 animate-modal">
          {/* Search */}
          <div className="flex items-center gap-2.5 px-4 mt-3.5 mb-1.5">
            <Search size={14} className="text-text-muted shrink-0" strokeWidth={2.5} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("navbar.modelSearch")}
              className="w-full text-sm bg-transparent text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>

          {/* Tag filter */}
          <div className="px-2 mb-1">
            <div className="flex gap-1 px-1.5 whitespace-nowrap text-sm overflow-x-auto scrollbar-none">
              {(["All", "Vision", "Fast"] as const).map((tag) => (
                <button
                  key={tag}
                  onClick={() => setTagFilter(tag)}
                  className={`min-w-fit px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    tagFilter === tag ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Model list */}
          <div className="max-h-56 overflow-y-auto py-1" role="listbox">
            {modelsLoading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-4 text-xs text-text-muted">
                <Loader2 size={12} className="animate-spin" /> 로딩 중...
              </div>
            ) : modelsError ? (
              <div className="px-4 py-3 text-xs text-danger text-center">
                모델 목록을 불러오지 못했습니다
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-3 text-xs text-text-muted text-center">{t("navbar.noResults")}</p>
            ) : filtered.map((m) => (
              <button
                key={m.id}
                role="option"
                aria-selected={m.id === value.id}
                onClick={() => { onChange(m); setOpen(false); }}
                className="flex group/item w-full items-center gap-2 py-2 pl-3 pr-1.5 text-sm text-text-secondary hover:bg-hover transition-all duration-75 cursor-pointer rounded-xl mx-1"
                style={{ width: "calc(100% - 8px)" }}
              >
                <div className={`flex items-center justify-center size-5 rounded-full text-xs font-bold text-white shrink-0 ${
                  m.provider === "OpenAI"    ? "bg-gray-700" :
                  m.provider === "Google"    ? "bg-blue-600" :
                  m.provider === "Anthropic" ? "bg-orange-600" : "bg-accent"
                }`}>
                  {m.name[0]}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="truncate font-medium text-text-primary">{m.name}</div>
                </div>
                <div className="shrink-0 flex items-center gap-1.5 pr-1">
                  {m.tags.map((tag) => (
                    <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent/70 border border-accent/15">{tag}</span>
                  ))}
                  <span className="text-xs text-text-muted">{m.provider}</span>
                  {m.id === value.id && <Check size={13} className="text-accent ml-0.5" />}
                </div>
              </button>
            ))}
          </div>

          {/* Temperature tuning */}
          {showTuning && (
            <div className="border-t border-border p-2">
              <button
                onClick={(e) => { e.stopPropagation(); setShowParams((v) => !v); }}
                className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-lg text-xs text-text-muted hover:bg-hover hover:text-text-secondary transition-colors"
              >
                <Sliders size={12} />
                <span>{t("navbar.sessionParams")}</span>
                <ChevronDown size={11} className={`ml-auto transition-transform duration-150 ${showParams ? "rotate-180" : ""}`} />
              </button>

              {showParams && (
                <div className="mt-2 px-2 pb-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-secondary">{t("navbar.temperature")}</span>
                    <div className="flex items-center gap-1.5">
                      {temperature !== null && (
                        <button onClick={() => setTemperature(null)} className="text-xs text-text-muted hover:text-red-400 transition-colors">
                          {t("navbar.reset")}
                        </button>
                      )}
                      <span className="text-xs font-mono text-accent w-8 text-right tabular-nums">
                        {temperature !== null ? temperature.toFixed(2) : t("navbar.default")}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="range" min={0} max={2} step={0.05} value={tempVal}
                      onChange={(e) => setTemperature(Number(e.target.value))}
                      className="flex-1 h-1.5 rounded-full cursor-pointer accent-accent"
                      style={{ background: `linear-gradient(to right, var(--color-accent) ${(tempVal / 2) * 100}%, var(--color-border) ${(tempVal / 2) * 100}%)` }}
                    />
                    <input
                      type="number" min={0} max={2} step={0.05} value={tempVal}
                      onChange={(e) => setTemperature(Math.min(2, Math.max(0, parseFloat(e.target.value) || 0)))}
                      className="bg-transparent text-center w-14 text-xs font-mono text-text-primary border border-border rounded-lg py-1 outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <div className="flex justify-between text-xs text-text-muted mt-0.5">
                    <span>{t("navbar.deterministic")}</span>
                    <span>{t("navbar.creative")}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
