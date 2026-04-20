"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

interface ConfirmModalProps {
  open: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-sm bg-surface border border-border rounded-2xl shadow-xl p-5 animate-modal"
      >
        <div className="flex items-start gap-3 mb-4">
          {danger && (
            <div className="shrink-0 mt-0.5">
              <AlertTriangle size={16} className="text-danger" />
            </div>
          )}
          <p className="text-sm text-text-primary leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm text-text-secondary border border-border hover:bg-hover transition-colors min-h-[44px]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors min-h-[44px] ${
              danger
                ? "bg-danger/90 hover:bg-danger text-white"
                : "bg-accent hover:bg-accent-hover text-white"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
