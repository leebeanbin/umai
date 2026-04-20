"use client";

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

interface PromptModalProps {
  open: boolean;
  message: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptModal({
  open,
  message,
  defaultValue = "",
  confirmLabel = "확인",
  cancelLabel = "취소",
  onConfirm,
  onCancel,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(ref, open);

  useEffect(() => {
    if (open) {
      setValue(defaultValue); // eslint-disable-line react-hooks/set-state-in-effect
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [open, defaultValue]);

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
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-sm bg-surface border border-border rounded-2xl shadow-xl p-5 animate-modal"
      >
        <p className="text-sm text-text-primary mb-3 leading-relaxed">{message}</p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onConfirm(value.trim()); }}
          className="w-full px-3 py-2 rounded-xl border border-border bg-base text-sm text-text-primary outline-none focus:border-accent transition-colors text-[16px]"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm text-text-secondary border border-border hover:bg-hover transition-colors min-h-[44px]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => { if (value.trim()) onConfirm(value.trim()); }}
            disabled={!value.trim()}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
