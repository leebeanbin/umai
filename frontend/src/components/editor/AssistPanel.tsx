"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Aperture, Building2, ImageIcon, Leaf, Lightbulb, Sparkles, StopCircle, Sun, Telescope, Zap } from "lucide-react";
import type { LucideProps } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { streamChat } from "@/lib/apis/chat";

type Phase = "idle" | "masking" | "ready" | "queued" | "processing" | "succeeded" | "failed";

export type BackgroundPreset = {
  label: string;
  Icon: React.ComponentType<LucideProps> | null;
  bgType: "solid" | "gradient" | "ai";
  bgColor?: string;
  bgColor2?: string;
  prompt: string;
};

export const BACKGROUNDS: BackgroundPreset[] = [
  // solid / gradient (즉시, API 비용 없음) — Icon null: color swatch으로 렌더링
  { label: "화이트",    Icon: null, bgType: "solid",    bgColor: "#ffffff", prompt: "" },
  { label: "블랙",     Icon: null, bgType: "solid",    bgColor: "#111111", prompt: "" },
  { label: "그레이",    Icon: null, bgType: "gradient", bgColor: "#f5f5f5", bgColor2: "#c0c0c0", prompt: "" },
  { label: "크림",     Icon: null, bgType: "gradient", bgColor: "#fdf6ec", bgColor2: "#e8d5b0", prompt: "" },
  // AI 생성 배경 (DALL-E 3, 실제 사진 품질)
  { label: "선셋",     Icon: Sun,       bgType: "ai", prompt: "beautiful golden sunset sky, warm orange and pink gradient clouds, cinematic" },
  { label: "도시 야경", Icon: Building2, bgType: "ai", prompt: "city night skyline, glowing windows, bokeh lights, cinematic photography" },
  { label: "숲 배경",  Icon: Leaf,      bgType: "ai", prompt: "lush green forest, natural soft dappled light, shallow depth of field" },
  { label: "Bokeh",  Icon: Aperture,  bgType: "ai", prompt: "soft pastel bokeh background, dreamy blur, shallow depth of field" },
  { label: "우주",     Icon: Telescope, bgType: "ai", prompt: "deep space nebula background, purple and blue cosmic, stars" },
  { label: "스튜디오", Icon: Lightbulb, bgType: "ai", prompt: "professional studio photography background, soft gradient grey, rim lighting" },
];

type Props = {
  instruction: string;
  phase: Phase;
  onApplySuggestion: (text: string) => void;
  onApplyBackground?: (preset: BackgroundPreset) => void;
  /** Optional source image (data URL) — passed to the vision model for image-aware prompt enhancement */
  imageSrc?: string;
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

export default function AssistPanel({
  instruction, phase, onApplySuggestion, onApplyBackground, imageSrc,
}: Props) {
  const { t } = useLanguage();
  // Snapshot pattern: store which instruction the enhancement was computed for.
  // When instruction changes, enhanced/enhErr auto-derive as empty — no useEffect needed.
  const [enhState, setEnhState] = useState({ forInstruction: instruction, text: "", err: "" });
  const [enhancing, setEnhancing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const enhanced = enhState.forInstruction === instruction ? enhState.text : "";
  const enhErr   = enhState.forInstruction === instruction ? enhState.err  : "";
  const setEnhanced = (text: string) => setEnhState({ forInstruction: instruction, text, err: "" });
  const setEnhErr   = (err: string)  => setEnhState((s) => ({ ...s, forInstruction: instruction, err }));

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
    const hasImage = !!imageSrc;
    const baseInstruction = hasImage
      ? `You are a gpt-image-1 inpainting prompt expert. Look at the provided image, then rewrite the following editing instruction as a precise, detailed English inpainting prompt that accurately describes what should appear in the edited area. Output only the improved prompt — no explanation, no quotes, no extra text.\n\nInstruction: ${instruction.trim()}`
      : `You are a gpt-image-1 inpainting prompt expert. Rewrite the following image editing instruction as a precise, detailed English inpainting prompt. Output only the improved prompt — no explanation, no quotes, no extra text.\n\nInstruction: ${instruction.trim()}`;

    await streamChat({
      signal: ctrl.signal,
      messages: [{
        role: "user",
        content: baseInstruction,
        ...(hasImage ? { images: [imageSrc] } : {}),
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
              Ollama 또는 연결된 모델로 편집 지시문을 gpt-image-1에 최적화된 프롬프트로 자동 변환합니다.
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

        {/* 스튜디오 배경 프리셋 */}
        {onApplyBackground && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <ImageIcon size={13} className="text-accent" />
              <p className="text-xs font-medium text-text-muted">스튜디오 배경</p>
            </div>
            <p className="text-[10px] text-text-muted leading-relaxed px-0.5">
              자동 누끼 후 배경 교체. <span className="text-text-secondary">솔리드·그라디언트 즉시</span> · <span className="text-accent">AI 배경은 DALL-E 3 사용</span>
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {BACKGROUNDS.map((bg) => (
                <button
                  key={bg.label}
                  onClick={() => onApplyBackground(bg)}
                  disabled={phase === "queued" || phase === "processing"}
                  className={`flex items-center gap-1.5 px-2 py-2 rounded-lg text-[10px] font-medium transition-colors text-left leading-tight
                    disabled:opacity-40 disabled:cursor-not-allowed
                    ${bg.bgType === "ai"
                      ? "text-accent bg-accent/5 border border-accent/20 hover:bg-accent/10 hover:border-accent/40"
                      : "text-text-secondary bg-elevated border border-border hover:border-accent/40 hover:text-accent"
                    }`}
                >
                  {bg.Icon
                    ? <bg.Icon size={11} className="flex-shrink-0" />
                    : <span className="w-3.5 h-3.5 rounded-sm flex-shrink-0 border border-black/10" style={{ background: bg.bgColor }} />
                  }
                  <span>{bg.label}</span>
                  {bg.bgType === "ai" && <span className="ml-auto text-[9px] opacity-60">AI</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
