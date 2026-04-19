"use client";

import { useEffect, useReducer, useRef } from "react";
import { X, ImageIcon, Loader2, Cpu, BookOpen } from "lucide-react";
import type { Folder } from "@/lib/store";
import { useLanguage } from "@/components/providers/LanguageProvider";

type Props = {
  open: boolean;
  folder?: Folder | null; // null = create, Folder = edit
  onClose: () => void;
  onSave: (data: Omit<Folder, "id" | "open">) => void;
};

type FormState = { name: string; systemPrompt: string; bgImageUrl: string | null; saving: boolean };
type FormAction =
  | { type: "init"; folder?: Folder | null }
  | { type: "setName"; value: string }
  | { type: "setSystemPrompt"; value: string }
  | { type: "setBgImageUrl"; value: string | null }
  | { type: "setSaving"; value: boolean };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "init":       return { name: action.folder?.name ?? "", systemPrompt: action.folder?.systemPrompt ?? "", bgImageUrl: action.folder?.bgImageUrl ?? null, saving: false };
    case "setName":    return { ...state, name: action.value };
    case "setSystemPrompt": return { ...state, systemPrompt: action.value };
    case "setBgImageUrl":   return { ...state, bgImageUrl: action.value };
    case "setSaving":  return { ...state, saving: action.value };
  }
}

export default function FolderModal({ open, folder, onClose, onSave }: Props) {
  const { t } = useLanguage();
  const nameRef    = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  const [form, dispatch] = useReducer(formReducer, {
    name: folder?.name ?? "",
    systemPrompt: folder?.systemPrompt ?? "",
    bgImageUrl: folder?.bgImageUrl ?? null,
    saving: false,
  });
  const { name, systemPrompt, bgImageUrl, saving } = form;
  const setName         = (value: string)           => dispatch({ type: "setName", value });
  const setSystemPrompt = (value: string)           => dispatch({ type: "setSystemPrompt", value });
  const setBgImageUrl   = (value: string | null)    => dispatch({ type: "setBgImageUrl", value });
  const setSaving       = (value: boolean)          => dispatch({ type: "setSaving", value });

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      dispatch({ type: "init", folder });
      setTimeout(() => {
        nameRef.current?.focus();
        nameRef.current?.select();
      }, 50);
    }
    wasOpenRef.current = open;
  }, [open, folder]);

  if (!open) return null;

  function handleBgChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBgImageUrl(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleSave() {
    if (!name.trim()) { nameRef.current?.focus(); return; }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    onSave({ name: name.trim(), systemPrompt: systemPrompt.trim() || undefined, bgImageUrl: bgImageUrl ?? undefined });
    setSaving(false);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && e.metaKey) handleSave();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="w-full max-w-md bg-elevated border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-modal">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">
            {folder ? t("folder.edit") : t("folder.create")}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:bg-hover hover:text-text-secondary transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* 배경 이미지 */}
        <div
          className="relative h-24 bg-surface border-b border-border overflow-hidden cursor-pointer group"
          onClick={() => bgInputRef.current?.click()}
        >
          {bgImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bgImageUrl} alt="bg" loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-1.5 text-text-muted group-hover:text-text-secondary transition-colors">
              <ImageIcon size={20} />
              <span className="text-xs">{t("folder.bgAdd")}</span>
            </div>
          )}
          {bgImageUrl && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-xs text-white font-medium">{t("folder.bgChange")}</span>
            </div>
          )}
          <input ref={bgInputRef} type="file" accept="image/*" onChange={handleBgChange} className="hidden" />
        </div>

        {/* 폼 */}
        <div className="px-5 py-4 flex flex-col gap-4">

          {/* 이름 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              {t("folder.name")} <span className="text-danger">{t("common.required")}</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("folder.namePlaceholder")}
              maxLength={80}
              className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* System Prompt */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Cpu size={12} className="text-text-muted" />
              <label className="text-xs font-medium text-text-secondary">
                System Prompt
                <span className="ml-1.5 text-text-muted font-normal">{t("common.optional")}</span>
              </label>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t("folder.systemPromptPh")}
              rows={4}
              className="w-full resize-none px-3 py-2.5 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors leading-relaxed"
            />
            <p className="mt-1 text-xs text-text-muted">{t("folder.systemPromptNote")}</p>
          </div>

          {/* Knowledge Files (coming soon) */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <BookOpen size={12} className="text-text-muted" />
              <label className="text-xs font-medium text-text-secondary">
                Knowledge Files
                <span className="ml-1.5 text-text-muted font-normal">{t("common.comingSoon")}</span>
              </label>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border border-dashed">
              <span className="text-xs text-text-muted">{t("folder.knowledgeDrop")}</span>
            </div>
          </div>
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
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving
              ? <><Loader2 size={14} className="animate-spin" />{t("folder.saving")}</>
              : folder ? t("folder.save") : t("folder.createBtn")
            }
          </button>
        </div>
      </div>
    </div>
  );
}
