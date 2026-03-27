"use client";

import { useRef } from "react";
import { X } from "lucide-react";
import { MaskCanvas, MaskCanvasHandle } from "@/components/canvas/MaskCanvas";
import { useLanguage } from "@/components/providers/LanguageProvider";

type Props = {
  open: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onApply: (compositeDataUrl: string) => void;
};

export default function MaskEditorModal({ open, imageSrc, onClose, onApply }: Props) {
  const { t } = useLanguage();
  const maskRef = useRef<MaskCanvasHandle>(null);

  if (!open) return null;

  async function handleApply() {
    const maskDataUrl = maskRef.current?.exportMaskDataUrl();
    if (!maskDataUrl || !imageSrc) return;

    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;

    await loadImage(imageSrc).then((img) => ctx.drawImage(img, 0, 0, 720, 480));

    const maskImg = await loadImage(maskDataUrl);
    const tmp = document.createElement("canvas");
    tmp.width = 720; tmp.height = 480;
    const tc = tmp.getContext("2d")!;
    tc.drawImage(maskImg, 0, 0, 720, 480);
    const data = tc.getImageData(0, 0, 720, 480);
    for (let i = 0; i < data.data.length; i += 4) {
      if (data.data[i + 3] > 0) {
        data.data[i] = 255; data.data[i + 1] = 60; data.data[i + 2] = 60; data.data[i + 3] = 140;
      }
    }
    tc.putImageData(data, 0, 0);
    ctx.drawImage(tmp, 0, 0);

    onApply(canvas.toDataURL("image/png"));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-elevated border border-border rounded-2xl overflow-hidden shadow-2xl animate-modal">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">{t("mask.title")}</h2>
            <p className="text-xs text-text-muted mt-0.5">{t("mask.subtitle")}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:bg-hover transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 캔버스 */}
        <div className="p-5">
          <MaskCanvas ref={maskRef} imageSrc={imageSrc} />
        </div>

        {/* 푸터 */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-hover transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleApply}
            className="px-4 py-2 rounded-full text-sm font-medium text-white bg-accent hover:bg-accent-hover transition-colors"
          >
            {t("mask.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    // N5: reject on error so callers can handle broken images rather than
    // silently drawing a blank/corrupt image onto the composite canvas
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}`));
    img.src = src;
  });
}
