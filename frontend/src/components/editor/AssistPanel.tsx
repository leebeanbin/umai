"use client";

import { AlertTriangle, Lightbulb, Zap } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

type Phase = "idle" | "masking" | "ready" | "queued" | "processing" | "succeeded" | "failed";

type Props = {
  instruction: string;
  phase: Phase;
  onApplySuggestion: (text: string) => void;
};

const PHASE_COLORS: Record<Phase, string> = {
  idle:       "text-text-muted",
  masking:    "text-accent",
  ready:      "text-green-400",
  queued:     "text-yellow-400",
  processing: "text-blue-400",
  succeeded:  "text-green-400",
  failed:     "text-danger",
};

export default function AssistPanel({ instruction, phase, onApplySuggestion }: Props) {
  const { t } = useLanguage();

  const phaseKey = `editor.phase.${phase}` as const;
  const base = instruction.trim() || t("editor.placeholder").split("\n")[0];
  const suggestion = `${base}. Edit only the masked area. Keep subject identity and composition unchanged.`;

  return (
    <div className="flex flex-col h-full bg-surface border-l border-border-subtle overflow-y-auto">
      <div className="px-4 py-3 border-b border-border-subtle">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Assist</h3>
      </div>

      <div className="flex flex-col gap-4 p-4">

        {/* 현재 단계 */}
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-text-muted">{t("editor.phase")}</p>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-elevated border border-border">
            {phase === "processing" && (
              <span className="size-1.5 rounded-full bg-blue-400 animate-pulse" />
            )}
            <span className={`text-sm font-medium ${PHASE_COLORS[phase]}`}>{t(phaseKey)}</span>
          </div>
        </div>

        {/* 리스크 경고 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-yellow-400" />
            <p className="text-xs font-medium text-text-muted">{t("editor.risks")}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            {([
              t("editor.risk1"),
              t("editor.risk2"),
              t("editor.risk3"),
            ] as string[]).map((warn) => (
              <div key={warn} className="flex gap-2 text-xs text-text-secondary leading-relaxed">
                <span className="mt-1 shrink-0 size-1 rounded-full bg-yellow-400/60" />
                {warn}
              </div>
            ))}
          </div>
        </div>

        {/* 선택 영역 해석 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Lightbulb size={13} className="text-accent" />
            <p className="text-xs font-medium text-text-muted">{t("editor.maskRegion")}</p>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed px-0.5">
            {t("editor.maskNote")}
          </p>
        </div>

        {/* 프롬프트 제안 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Zap size={13} className="text-accent" />
            <p className="text-xs font-medium text-text-muted">{t("editor.promptSuggest")}</p>
          </div>
          <div className="px-3 py-2.5 rounded-xl bg-elevated border border-border text-xs text-text-secondary leading-relaxed">
            {suggestion}
          </div>
          <button
            onClick={() => onApplySuggestion(suggestion)}
            className="w-full px-3 py-2 rounded-xl text-xs font-medium text-accent bg-accent/10 border border-accent/20 hover:bg-accent/15 transition-colors"
          >
            {t("editor.applyPrompt")}
          </button>
        </div>
      </div>
    </div>
  );
}
