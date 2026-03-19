"use client";

import { useRef, useState } from "react";
import { ArrowUp, ImageIcon, StopCircle, CheckCircle2 } from "lucide-react";
import { MaskCanvas, MaskCanvasHandle } from "@/components/canvas/MaskCanvas";
import AssistPanel from "@/components/editor/AssistPanel";
import { useLanguage } from "@/components/providers/LanguageProvider";

type Phase = "idle" | "masking" | "ready" | "queued" | "processing" | "succeeded" | "failed";
type Variant = { id: string; rank: number; url: string };
type LogEntry = { time: string; text: string };

export default function EditorSession() {
  const { t } = useLanguage();
  const maskRef = useRef<MaskCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [sourceImage, setSourceImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [hasMask, setHasMask] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const canRun = !!sourceImage && instruction.trim().length >= 5 && hasMask && phase !== "queued" && phase !== "processing";

  function addLog(text: string) {
    setLogs((prev) => [{ time: new Date().toLocaleTimeString(), text }, ...prev].slice(0, 30));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSourceImage({ dataUrl: reader.result as string, name: file.name });
      setVariants([]);
      setSelectedVariant(null);
      setPhase("masking");
      addLog(`${t("editor.log.imageLoaded")}: ${file.name}`);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function runEdit() {
    setPhase("queued");
    addLog(t("editor.log.sending"));
    await new Promise((r) => setTimeout(r, 800));

    setPhase("processing");
    addLog(t("editor.log.processing"));
    await new Promise((r) => setTimeout(r, 1500));

    const mockVariants: Variant[] = Array.from({ length: 2 }, (_, i) => ({
      id: crypto.randomUUID(),
      rank: i + 1,
      url: `https://picsum.photos/seed/${Math.random().toString(36).slice(2)}/720/480`,
    }));
    setVariants(mockVariants);
    setSelectedVariant(mockVariants[0].id);
    setPhase("succeeded");
    addLog(t("editor.log.done").replace("{n}", String(mockVariants.length)));
  }

  const displayImage = variants.find((v) => v.id === selectedVariant)?.url ?? sourceImage?.dataUrl ?? null;

  return (
    <div className="flex h-full bg-base overflow-hidden">

      {/* 왼쪽: 채팅 패널 */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border-subtle bg-surface">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Chat</h3>
        </div>

        <div className="flex flex-col gap-3 p-4 flex-1">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={t("editor.placeholder")}
            className="w-full resize-none rounded-xl bg-elevated border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors p-3 leading-relaxed"
            rows={5}
          />

          <button
            disabled={!canRun}
            onClick={runEdit}
            className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium transition-colors ${
              canRun
                ? "bg-accent hover:bg-accent-hover text-white cursor-pointer"
                : "bg-hover text-text-muted cursor-not-allowed"
            }`}
          >
            {phase === "queued" || phase === "processing" ? (
              <><StopCircle size={14} />{t("editor.running")}</>
            ) : (
              <><ArrowUp size={14} />{t("editor.runEdit")}</>
            )}
          </button>
        </div>

        {/* 실행 로그 */}
        <div className="border-t border-border-subtle p-4">
          <p className="text-xs font-medium text-text-muted mb-2">{t("editor.logs")}</p>
          <div className="bg-base rounded-xl border border-border p-2.5 max-h-36 overflow-y-auto font-mono text-xs">
            {logs.length === 0 ? (
              <span className="text-text-muted">{t("editor.noLogs")}</span>
            ) : logs.map((l, i) => (
              <div key={i} className="mb-1 text-text-secondary">
                <span className="text-text-muted mr-1.5">{l.time}</span>
                {l.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 가운데: 캔버스 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 상단 툴바 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle bg-surface">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-elevated border border-border text-text-secondary hover:border-accent/50 hover:text-accent transition-colors"
            >
              <ImageIcon size={13} />{t("editor.uploadImage")}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          </div>

          {/* Variant 선택 */}
          {variants.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">Variants:</span>
              {variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariant(v.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                    v.id === selectedVariant
                      ? "bg-accent/15 border border-accent/40 text-accent"
                      : "bg-elevated border border-border text-text-secondary hover:border-accent/30"
                  }`}
                >
                  {v.id === selectedVariant && <CheckCircle2 size={11} />}
                  #{v.rank}
                </button>
              ))}
            </div>
          )}

          {phase === "succeeded" && (
            <span className="text-xs text-green-400 font-medium">{t("editor.done")}</span>
          )}
        </div>

        {/* 캔버스 영역 */}
        <div className="flex-1 overflow-auto p-4">
          <MaskCanvas
            ref={maskRef}
            imageSrc={displayImage}
            onMaskChange={(has) => {
              setHasMask(has);
              if (has && phase === "idle") setPhase("masking");
            }}
          />
        </div>
      </div>

      {/* 오른쪽: Assist 패널 */}
      <div className="w-64 shrink-0">
        <AssistPanel
          instruction={instruction}
          phase={phase}
          onApplySuggestion={(s) => setInstruction(s)}
        />
      </div>
    </div>
  );
}
