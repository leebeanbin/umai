"use client";

import { useRef, useState } from "react";
import { ArrowUp, ImageIcon, Layers, MousePointer2, Scissors, StopCircle, CheckCircle2 } from "lucide-react";
import { MaskCanvas, MaskCanvasHandle } from "@/components/canvas/MaskCanvas";
import AssistPanel from "@/components/editor/AssistPanel";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { streamChat } from "@/lib/apis/chat";
import { getModelCapabilities } from "@/lib/modelCapabilities";
import { loadSettings } from "@/lib/appStore";
import {
  apiEnqueueRemoveBackground,
  apiEnqueueSegmentClick,
  apiEnqueueEditImage,
  apiEnqueueComposeStudio,
} from "@/lib/api/backendClient";
import type { BackgroundPreset } from "@/components/editor/AssistPanel";
import { pollTask } from "@/lib/utils/pollTask";

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
  const [engine, setEngine] = useState<"gpt-image-1" | "comfyui">("gpt-image-1");
  const [segmentMode, setSegmentMode] = useState(false);

  const SIZE = 1024;
  const isBusy = phase === "queued" || phase === "processing";
  const canRun = !!sourceImage && instruction.trim().length >= 5 && hasMask && !isBusy;

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
            "You are a gpt-image-1 inpainting prompt expert. Look at the provided image, then rewrite the following editing instruction as a precise, detailed English inpainting prompt that accurately describes what should appear in the edited area. Output only the improved prompt — no explanation, no quotes, no extra text.\n\n" +
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

  async function handleRemoveBg() {
    if (!sourceImage || isBusy) return;
    setPhase("processing");
    addLog("✂️ 배경 제거 중...");
    try {
      const task = await apiEnqueueRemoveBackground(sourceImage.dataUrl, "birefnet-general", true);
      const res = await pollTask<{ b64: string; format: string }>(task.task_id, { maxPolls: 60 });
      setSourceImage({ dataUrl: `data:image/png;base64,${res.b64}`, name: sourceImage.name });
      setPhase("masking");
      addLog("✅ 누끼 완료 (BiRefNet + alpha matting)");
    } catch {
      setPhase("failed");
      addLog("❌ 배경 제거 실패");
    }
  }

  async function handleCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!segmentMode || !sourceImage || isBusy) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top)  / rect.height;
    addLog(`🎯 세그먼트 중... (${(x * 100).toFixed(0)}%, ${(y * 100).toFixed(0)}%)`);
    try {
      const task = await apiEnqueueSegmentClick(sourceImage.dataUrl, x, y);
      const res = await pollTask<{ mask_b64: string }>(task.task_id, { maxPolls: 30 });
      maskRef.current?.loadMask(res.mask_b64);
      setHasMask(true);
      addLog("✅ 세그먼트 완료");
    } catch {
      addLog("❌ 세그먼트 실패");
    }
  }

  async function handleApplyBackground(preset: BackgroundPreset) {
    if (!sourceImage || isBusy) return;
    setPhase("processing");

    try {
      // Step 1: BiRefNet + alpha matting으로 고품질 누끼
      addLog(`✂️ 누끼 추출 중 (BiRefNet${preset.bgType !== "ai" ? ", 즉시 합성" : " + DALL-E 3"})...`);
      const rmTask = await apiEnqueueRemoveBackground(
        sourceImage.dataUrl,
        "birefnet-general",
        true,
      );
      const rmRes = await pollTask<{ b64: string; width: number; height: number }>(
        rmTask.task_id, { maxPolls: 60 },
      );
      const fgB64 = rmRes.b64;
      addLog("✅ 누끼 완료 — 배경 합성 중...");

      // Step 2: 배경 합성 (solid/gradient는 즉시, ai는 DALL-E 3 생성 후 PIL composite)
      const compTask = await apiEnqueueComposeStudio(
        fgB64,
        preset.prompt,
        preset.bgType,
        preset.bgColor ?? "#ffffff",
        preset.bgColor2 ?? "#e0e0e0",
        SIZE,
      );
      const compRes = await pollTask<{ b64: string }>(compTask.task_id, { maxPolls: 60 });

      const resultDataUrl = `data:image/png;base64,${compRes.b64}`;
      const newVariants: Variant[] = [{ id: crypto.randomUUID(), rank: 1, url: resultDataUrl }];
      setVariants(newVariants);
      setSelectedVariant(newVariants[0].id);
      setPhase("succeeded");
      addLog(`✅ ${preset.label} 배경 적용 완료`);
    } catch (err) {
      setPhase("failed");
      addLog(`❌ 배경 교체 실패: ${(err as Error).message}`);
    }
  }

  async function runEdit() {
    const maskDataUrl = maskRef.current?.exportMaskDataUrl();
    if (!sourceImage || !maskDataUrl) {
      setPhase("failed");
      addLog(!sourceImage ? "❌ 이미지를 업로드해주세요." : "❌ 마스크를 그려주세요.");
      return;
    }
    await runEditWithParams(sourceImage.dataUrl, maskDataUrl, instruction);
  }

  async function runEditWithParams(imgDataUrl: string, rawMaskDataUrl: string, prompt: string) {
    setPhase("queued");
    addLog(t("editor.log.sending"));
    setPhase("processing");
    addLog(t("editor.log.processing"));

    try {
      // Vision 모델로 프롬프트 자동 개선
      const caps = getModelCapabilities(loadSettings().selectedModel);
      let finalPrompt = prompt.trim();
      if (caps.vision) {
        addLog("🔍 이미지 분석 중 (멀티모달 프롬프트 개선)...");
        const enhanced = await enhancePromptWithVision(imgDataUrl, finalPrompt);
        if (enhanced !== finalPrompt) {
          finalPrompt = enhanced;
          addLog(`✨ 개선된 프롬프트: ${finalPrompt.slice(0, 80)}${finalPrompt.length > 80 ? "…" : ""}`);
        }
      }

      // 마스크 반전 + 정사각형 패딩
      const invertedMaskDataUrl = await blobToDataUrl(await invertAndSquareMask(rawMaskDataUrl, SIZE));
      const squaredImageDataUrl  = await blobToDataUrl(await squareImage(imgDataUrl, SIZE));

      addLog(`🖌️ ${engine === "comfyui" ? "FLUX.1 Fill" : "gpt-image-1"} 인페인팅 중...`);
      const task = await apiEnqueueEditImage(squaredImageDataUrl, invertedMaskDataUrl, finalPrompt, engine, `${SIZE}x${SIZE}`);
      const res = await pollTask<{ b64: string | null; url: string | null; prompt_id?: string }>(task.task_id, { maxPolls: 60 });

      const imageUrl = res.b64
        ? `data:image/png;base64,${res.b64}`
        : res.url ?? null;

      if (!imageUrl) {
        setPhase("succeeded");
        addLog(`✅ ComfyUI 작업 전송됨 (prompt_id: ${res.prompt_id ?? "?"})`);
        return;
      }

      const newVariants: Variant[] = [{ id: crypto.randomUUID(), rank: 1, url: imageUrl }];
      setVariants(newVariants);
      setSelectedVariant(newVariants[0].id);
      setPhase("succeeded");
      addLog(t("editor.log.done").replace("{n}", "1"));
    } catch (err) {
      setPhase("failed");
      addLog(`❌ ${(err as Error).message}`);
    }
  }

  /** gpt-image-1 마스크: 흰색→투명(편집 영역), 투명→흰색(유지 영역), 정사각형으로 맞춤 */
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

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(blob);
    });
  }

  /** 투명 픽셀을 흰색(편집 영역), 불투명 픽셀을 투명(유지 영역)으로 변환 — DALL-E 형식 마스크 */
  async function generateTransparencyMask(dataUrl: string, size: number): Promise<string> {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, size, size);
    const { data: px } = ctx.getImageData(0, 0, size, size);
    const id = ctx.createImageData(size, size);
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 10) {
        // 투명 픽셀 → 흰색 불투명 (DALL-E: 편집 영역)
        id.data[i] = id.data[i + 1] = id.data[i + 2] = 255;
        id.data[i + 3] = 255;
      } else {
        // 불투명 픽셀 → 투명 (DALL-E: 유지 영역)
        id.data[i] = id.data[i + 1] = id.data[i + 2] = 0;
        id.data[i + 3] = 0;
      }
    }
    ctx.putImageData(id, 0, 0);
    return canvas.toDataURL("image/png");
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
            {isBusy ? (
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

            {sourceImage && (
              <>
                <button
                  onClick={handleRemoveBg}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-elevated border border-border text-text-secondary hover:border-accent/50 hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Scissors size={13} />누끼
                </button>

                <button
                  onClick={() => setSegmentMode((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    segmentMode
                      ? "bg-accent/15 border-accent/50 text-accent"
                      : "bg-elevated border-border text-text-secondary hover:border-accent/50 hover:text-accent"
                  }`}
                >
                  <MousePointer2 size={13} />{segmentMode ? "클릭 모드 ON" : "클릭 세그먼트"}
                </button>

                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-elevated border border-border">
                  <Layers size={12} className="text-text-muted" />
                  <select
                    value={engine}
                    onChange={(e) => setEngine(e.target.value as "gpt-image-1" | "comfyui")}
                    className="text-xs text-text-secondary bg-transparent outline-none cursor-pointer"
                  >
                    <option value="gpt-image-1">gpt-image-1</option>
                    <option value="comfyui">FLUX.1 Fill</option>
                  </select>
                </div>
              </>
            )}
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
        <div
          className="flex-1 overflow-auto p-4"
          onClick={segmentMode ? handleCanvasClick : undefined}
          style={segmentMode ? { cursor: "crosshair" } : undefined}
        >
          {segmentMode && (
            <div className="mb-2 text-xs text-accent bg-accent/10 border border-accent/20 rounded-lg px-3 py-1.5">
              클릭 세그먼트 모드 — 오브젝트를 클릭하면 자동으로 마스크가 생성됩니다
            </div>
          )}
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
          onApplyBackground={handleApplyBackground as (p: BackgroundPreset) => void}
        />
      </div>
    </div>
  );
}
