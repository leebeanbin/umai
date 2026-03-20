"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Lightbulb, Sparkles, StopCircle, Zap } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { streamChat } from "@/lib/apis/chat";

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
  const [enhanced, setEnhanced]   = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhErr, setEnhErr]       = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Reset enhancement when instruction changes significantly
  useEffect(() => {
    setEnhanced("");
    setEnhErr("");
  }, [instruction]);

  // Cleanup abort on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const phaseKey = `editor.phase.${phase}` as const;
  const staticSuggestion = `${instruction.trim() || t("editor.placeholder").split("\n")[0]}. Edit only the masked area. Keep subject identity and composition unchanged.`;

  async function handleEnhance() {
    if (enhancing) {
      abortRef.current?.abort();
      return;
    }
    if (!instruction.trim()) return;
    setEnhanced("");
    setEnhErr("");
    setEnhancing(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let built = "";
    await streamChat({
      signal: ctrl.signal,
      messages: [{
        role: "user",
        content:
          "You are a DALL-E 2 inpainting prompt expert. " +
          "Rewrite the following image editing instruction as a precise, detailed English inpainting prompt. " +
          "Output only the improved prompt — no explanation, no quotes, no extra text.\n\n" +
          `Instruction: ${instruction.trim()}`,
      }],
      onChunk: (chunk) => { built += chunk; setEnhanced(built); },
      onDone: () => { setEnhancing(false); abortRef.current = null; },
      onError: (err) => {
        if (err !== "AbortError") setEnhErr(err);
        setEnhancing(false);
        abortRef.current = null;
      },
    });
  }

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

        {/* AI 프롬프트 개선 (Ollama / any model) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles size={13} className="text-accent" />
              <p className="text-xs font-medium text-text-muted">AI 프롬프트 개선</p>
            </div>
            <button
              onClick={handleEnhance}
              disabled={!instruction.trim()}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors border ${
                !instruction.trim()
                  ? "border-border text-text-muted cursor-not-allowed opacity-40"
                  : enhancing
                  ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/15"
                  : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15"
              }`}
            >
              {enhancing ? <><StopCircle size={10} />중지</> : <><Sparkles size={10} />개선</>}
            </button>
          </div>

          {enhErr && (
            <p className="text-[10px] text-danger px-1">{enhErr}</p>
          )}

          {(enhanced || enhancing) && (
            <div className="flex flex-col gap-1.5">
              <div className="px-3 py-2.5 rounded-xl bg-elevated border border-border text-xs text-text-secondary leading-relaxed min-h-[3rem]">
                {enhanced || (
                  <span className="inline-flex gap-0.5">
                    <span className="size-1 rounded-full bg-text-muted animate-bounce [animation-delay:0ms]" />
                    <span className="size-1 rounded-full bg-text-muted animate-bounce [animation-delay:150ms]" />
                    <span className="size-1 rounded-full bg-text-muted animate-bounce [animation-delay:300ms]" />
                  </span>
                )}
              </div>
              {enhanced && !enhancing && (
                <button
                  onClick={() => onApplySuggestion(enhanced.trim())}
                  className="w-full px-3 py-2 rounded-xl text-xs font-medium text-accent bg-accent/10 border border-accent/20 hover:bg-accent/15 transition-colors"
                >
                  적용하기
                </button>
              )}
            </div>
          )}

          {!enhanced && !enhancing && (
            <p className="text-[10px] text-text-muted leading-relaxed px-0.5">
              Ollama 또는 연결된 모델로 편집 지시문을 DALL-E 2에 최적화된 프롬프트로 자동 변환합니다.
            </p>
          )}
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

        {/* 정적 프롬프트 제안 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Zap size={13} className="text-accent" />
            <p className="text-xs font-medium text-text-muted">{t("editor.promptSuggest")}</p>
          </div>
          <div className="px-3 py-2.5 rounded-xl bg-elevated border border-border text-xs text-text-secondary leading-relaxed">
            {staticSuggestion}
          </div>
          <button
            onClick={() => onApplySuggestion(staticSuggestion)}
            className="w-full px-3 py-2 rounded-xl text-xs font-medium text-accent bg-accent/10 border border-accent/20 hover:bg-accent/15 transition-colors"
          >
            {t("editor.applyPrompt")}
          </button>
        </div>
      </div>
    </div>
  );
}
