"use client";

import { useRef, useState } from "react";
import { ArrowUp, ImageIcon, StopCircle, CheckCircle2 } from "lucide-react";
import { MaskCanvas, MaskCanvasHandle } from "@/components/canvas/MaskCanvas";
import AssistPanel from "@/components/editor/AssistPanel";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { streamChat } from "@/lib/apis/chat";
import { getModelCapabilities } from "@/lib/modelCapabilities";
import { loadSettings } from "@/lib/appStore";
import { getStoredToken } from "@/lib/api/backendClient";

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

  /** Use a vision-capable model to generate a better DALL-E prompt from the image + instruction */
  function enhancePromptWithVision(imageDataUrl: string, userInstruction: string): Promise<string> {
    return new Promise((resolve) => {
      const caps = getModelCapabilities(loadSettings().selectedModel);
      if (!caps.vision) { resolve(userInstruction); return; }
      let built = "";
      streamChat({
        messages: [{
          role: "user",
          content:
            "You are a DALL-E 2 inpainting prompt expert. Look at the provided image, then rewrite the following editing instruction as a precise, detailed English inpainting prompt that accurately describes what should appear in the edited area. Output only the improved prompt — no explanation, no quotes, no extra text.\n\n" +
            `Instruction: ${userInstruction.trim()}`,
          images: [imageDataUrl],
        }],
        onChunk: (chunk) => { built += chunk; },
        onDone:  () => resolve(built.trim() || userInstruction),
        onError: () => resolve(userInstruction),
      });
    });
  }

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
    if (!sourceImage) return;
    setPhase("queued");
    addLog(t("editor.log.sending"));

    // 1) OpenAI 키 확인
    const capRes = await fetch("/api/image").catch(() => null);
    const caps = capRes?.ok ? await capRes.json() as { openai: boolean } : null;
    if (!caps?.openai) {
      setPhase("failed");
      addLog("❌ 이미지 편집에는 OpenAI API 키(DALL-E 2)가 필요합니다. 관리자 설정 → Connections에서 키를 추가해주세요.");
      return;
    }

    // 2) 마스크 추출 및 DALL-E 형식으로 반전
    //    Canvas mask: 흰색 = 편집 영역, 투명 = 유지 영역
    //    DALL-E mask: 투명 = 편집 영역, 불투명 = 유지 영역  → 색상 반전 필요
    const maskDataUrl = maskRef.current?.exportMaskDataUrl();
    if (!maskDataUrl) {
      setPhase("failed");
      addLog("❌ 마스크를 그려주세요.");
      return;
    }

    setPhase("processing");
    addLog(t("editor.log.processing"));

    try {
      // 3) Vision 모델로 DALL-E 프롬프트 자동 개선 (vision 모델 연결 시)
      const caps = getModelCapabilities(loadSettings().selectedModel);
      let finalPrompt = instruction.trim();
      if (caps.vision) {
        addLog("🔍 이미지 분석 중 (멀티모달 프롬프트 개선)...");
        finalPrompt = await enhancePromptWithVision(sourceImage.dataUrl, instruction.trim());
        if (finalPrompt !== instruction.trim()) {
          addLog(`✨ 개선된 프롬프트: ${finalPrompt.slice(0, 80)}${finalPrompt.length > 80 ? "…" : ""}`);
        }
      }

      // 4) 마스크 반전: 흰색↔투명 교환, 512x512로 크롭/패드 (DALL-E 2는 정사각형 요구)
      const SIZE = 1024;
      const invertedMaskBlob = await invertAndSquareMask(maskDataUrl, SIZE);
      const squaredImageBlob = await squareImage(sourceImage.dataUrl, SIZE);

      // 5) API 호출
      const fd = new FormData();
      fd.append("image",  squaredImageBlob, "image.png");
      fd.append("mask",   invertedMaskBlob, "mask.png");
      fd.append("prompt", finalPrompt);
      fd.append("n",      "2");
      fd.append("size",   `${SIZE}x${SIZE}`);

      const token = getStoredToken();
      const res = await fetch("/api/image/edit", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json() as { images?: { url: string }[]; error?: string };

      if (!res.ok || data.error) {
        setPhase("failed");
        addLog(`❌ ${data.error ?? "편집 실패"}`);
        return;
      }

      const newVariants: Variant[] = (data.images ?? []).map((img, i) => ({
        id: crypto.randomUUID(),
        rank: i + 1,
        url: img.url,
      }));
      setVariants(newVariants);
      setSelectedVariant(newVariants[0]?.id ?? null);
      setPhase("succeeded");
      addLog(t("editor.log.done").replace("{n}", String(newVariants.length)));
    } catch (err) {
      setPhase("failed");
      addLog(`❌ ${(err as Error).message}`);
    }
  }

  /** DALL-E 2 마스크: 흰색→투명(편집 영역), 투명→흰색(유지 영역), 정사각형으로 맞춤 */
  async function invertAndSquareMask(dataUrl: string, size: number): Promise<Blob> {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    // 이미지를 정사각형에 맞게 그림 (letterbox)
    const scale = Math.min(size / img.width, size / img.height);
    const sw = img.width * scale, sh = img.height * scale;
    const ox = (size - sw) / 2, oy = (size - sh) / 2;

    // 먼저 전체를 흰색 불투명으로 채움 (유지 영역 기본값)
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, size, size);

    // 원본 마스크 그림
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = img.width; tmpCanvas.height = img.height;
    tmpCanvas.getContext("2d")!.drawImage(img, 0, 0);
    const { data: px } = tmpCanvas.getContext("2d")!.getImageData(0, 0, img.width, img.height);

    // 흰색 픽셀(r>128 && a>0) → 대상 canvas에 투명으로
    const scaledCanvas = document.createElement("canvas");
    scaledCanvas.width = img.width; scaledCanvas.height = img.height;
    const sCtx = scaledCanvas.getContext("2d")!;
    const id = sCtx.createImageData(img.width, img.height);
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] > 128 && px[i + 3] > 0) {
        // 편집 영역 → DALL-E 마스크에서 투명
        id.data[i] = id.data[i+1] = id.data[i+2] = 0;
        id.data[i+3] = 0;
      } else {
        // 유지 영역 → 흰색 불투명
        id.data[i] = id.data[i+1] = id.data[i+2] = 255;
        id.data[i+3] = 255;
      }
    }
    sCtx.putImageData(id, 0, 0);

    // 정사각형 캔버스에 그림 (배경은 이미 흰색이므로 letterbox 바깥은 유지 영역)
    // letterbox 안을 반전 마스크로 덮음
    ctx.drawImage(scaledCanvas, ox, oy, sw, sh);

    return await canvasToBlob(canvas);
  }

  /** 이미지를 정사각형(size×size)에 맞게 letterbox */
  async function squareImage(dataUrl: string, size: number): Promise<Blob> {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    const scale = Math.min(size / img.width, size / img.height);
    const sw = img.width * scale, sh = img.height * scale;
    ctx.drawImage(img, (size - sw) / 2, (size - sh) / 2, sw, sh);
    return await canvasToBlob(canvas);
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((res, rej) =>
      canvas.toBlob((b) => b ? res(b) : rej(new Error("canvas toBlob failed")), "image/png")
    );
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
          imageSrc={sourceImage?.dataUrl}
          onApplySuggestion={(s) => setInstruction(s)}
        />
      </div>
    </div>
  );
}
