"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { useLanguage } from "@/components/providers/LanguageProvider";

export type MaskCanvasHandle = {
  exportMaskDataUrl: () => string | null;
  hasMask: () => boolean;
  clear: () => void;
  loadMask: (b64: string) => void;
};

type Tool = "brush" | "rect";

type Props = {
  imageSrc: string | null;
  width?: number;
  height?: number;
  onMaskChange?: (hasMask: boolean) => void;
};

const BRUSH_RADIUS = 16;

export const MaskCanvas = forwardRef<MaskCanvasHandle, Props>(function MaskCanvas(
  { imageSrc, width = 720, height = 480, onMaskChange },
  ref
) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [masked, setMasked] = useState(false);
  const isDrawing = useRef(false);
  const rectStart = useRef<{ x: number; y: number } | null>(null);

  // Declared before useImperativeHandle so the React Compiler can verify references
  function clear() {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    setMasked(false);
    onMaskChange?.(false);
  }

  function setMask(val: boolean) {
    setMasked(val);
    onMaskChange?.(val);
  }

  useImperativeHandle(ref, () => ({
    exportMaskDataUrl: () => {
      if (!canvasRef.current || !masked) return null;
      return canvasRef.current.toDataURL("image/png");
    },
    hasMask: () => masked,
    clear,
    loadMask: (b64: string) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        setMask(true);
      };
      img.src = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
    },
  }));

  useEffect(() => { clear(); }, [imageSrc]); // eslint-disable-line react-hooks/set-state-in-effect

  function toLocal(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height,
    };
  }

  function drawBrush(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.beginPath();
    ctx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pt = toLocal(e);
    isDrawing.current = true;
    if (tool === "brush") {
      drawBrush(ctx, pt.x, pt.y);
      setMask(true);
    } else {
      rectStart.current = pt;
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing.current || tool !== "brush") return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawBrush(ctx, toLocal(e).x, toLocal(e).y);
    setMask(true);
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    if (tool === "rect" && rectStart.current) {
      const end = toLocal(e);
      const x = Math.min(rectStart.current.x, end.x);
      const y = Math.min(rectStart.current.y, end.y);
      const w = Math.abs(end.x - rectStart.current.x);
      const h = Math.abs(end.y - rectStart.current.y);
      if (w > 2 && h > 2) {
        ctx.fillStyle = "rgba(255,255,255,1)";
        ctx.fillRect(x, y, w, h);
        setMask(true);
      }
    }
    rectStart.current = null;
    isDrawing.current = false;
  }

  const TOOL_LABELS: Record<Tool, string> = {
    brush: t("mask.brush"),
    rect:  t("mask.rect"),
  };

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        {(["brush", "rect"] as Tool[]).map((toolItem) => (
          <button
            key={toolItem}
            type="button"
            onClick={() => setTool(toolItem)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === toolItem
                ? "bg-accent text-white"
                : "bg-elevated border border-border text-text-secondary hover:text-text-primary"
            }`}
          >
            {TOOL_LABELS[toolItem]}
          </button>
        ))}
        <button
          type="button"
          onClick={clear}
          className="px-3 py-1.5 rounded-lg text-xs bg-elevated border border-border text-text-secondary hover:text-text-primary transition-colors"
        >
          {t("mask.clear")}
        </button>
        <span className="text-xs text-text-muted ml-auto">
          {t("mask.status")} {masked ? <span className="text-accent">{t("mask.drawn")}</span> : t("mask.none")}
        </span>
      </div>

      {/* Canvas */}
      <div
        className="relative rounded-xl overflow-hidden bg-elevated border border-border w-full"
        style={{ aspectRatio: `${width}/${height}` }}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={t("mask.title")}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted">
            {t("mask.upload")}
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { isDrawing.current = false; }}
          className="absolute inset-0 w-full h-full cursor-crosshair opacity-45"
        />
      </div>
    </div>
  );
});
