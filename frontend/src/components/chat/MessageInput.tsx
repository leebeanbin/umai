"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, ArrowUp, X, Brush, Globe, Sparkles, StopCircle, Wand2, ChevronUp, FileText, BookOpen, ScanText } from "lucide-react";
import MaskEditorModal from "./MaskEditorModal";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { loadSettings } from "@/lib/appStore";
import { getModelCapabilities, type ModelCapabilities } from "@/lib/modelCapabilities";
import { getStoredToken } from "@/lib/api/backendClient";

type AttachedImage = { id: string; dataUrl: string; name: string };

type AttachedDoc = {
  id: string;
  name: string;
  text: string;
  charCount: number;
  pageCount?: number | null;
  truncated: boolean;
  mode: "full" | "first_pages";
};

type Props = {
  onSend: (content: string, images: AttachedImage[], webSearch?: boolean, docContext?: string, useRag?: boolean) => void;
  onStop?: () => void;
  generating?: boolean;
  disabled?: boolean;
};

/* ── 프롬프트 평가 휴리스틱 ── */
type EvalResult = {
  clarity: number;
  specificity: number;
  context: number;
  actionability: number;
  overall: number;
  suggestions: string[];
};

function evaluatePrompt(text: string, lang: "ko" | "en"): EvalResult {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const len   = words.length;

  const vagueWords = ["뭔가", "좀", "그냥", "어떻게", "이거", "저거", "something", "somehow", "maybe", "just"];
  const vagueCount = vagueWords.filter((w) => text.toLowerCase().includes(w)).length;
  const clarity    = Math.min(10, Math.max(1, (len >= 10 ? 8 : len >= 5 ? 5 : 2) - vagueCount));

  const specificPat = [/\d+/, /색|color|colour/, /스타일|style/, /px|cm|mm|%/, /밝|어둡|따뜻|차갑|bright|dark|warm|cool/i, /자연스럽|natural/, /선명|sharp|vivid/];
  const specificity = Math.min(10, Math.max(1, 2 + specificPat.filter((p) => p.test(text)).length * 1.5));

  const contextPat = [/이미지|image|사진|photo/, /선택|영역|region|area|mask/, /배경|background/, /피사체|subject|object/, /foreground/];
  const context    = Math.min(10, Math.max(1, 2 + contextPat.filter((p) => p.test(text)).length * 2));

  const actionPat = [/교체|replace|바꿔|change/, /제거|remove|지워/, /보정|adjust|correct/, /변환|convert|transform/, /리터칭|retouch/, /추가|add|넣어/, /향상|enhance|improve/, /흐리|blur/];
  const actionability = Math.min(10, Math.max(1, 2 + actionPat.filter((p) => p.test(text)).length * 2));

  const overall = Math.round((clarity + specificity + context + actionability) / 4);

  const suggestions: string[] = [];
  if (lang === "ko") {
    if (len < 5)            suggestions.push("더 구체적인 지시를 추가해 길이를 늘려보세요.");
    if (specificity < 5)    suggestions.push("색상·스타일·분위기 같은 속성을 명시해보세요.");
    if (context < 4)        suggestions.push("편집할 영역이나 피사체를 구체적으로 언급해보세요.");
    if (actionability < 4)  suggestions.push("'교체', '제거', '보정' 같은 명확한 동사를 써보세요.");
  } else {
    if (len < 5)            suggestions.push("Add more detail to make the instruction clearer.");
    if (specificity < 5)    suggestions.push("Specify attributes like color, style, or mood.");
    if (context < 4)        suggestions.push("Mention which area or subject to edit.");
    if (actionability < 4)  suggestions.push("Use clear action verbs like replace, remove, enhance.");
  }

  return { clarity, specificity, context, actionability, overall, suggestions };
}

function ScoreBar({ value, label }: { value: number; label: string }) {
  const color = value >= 7 ? "bg-success" : value >= 5 ? "bg-warning" : "bg-danger";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-muted w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-hover overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value * 10}%` }} />
      </div>
      <span className={`text-xs font-mono w-4 text-right ${value >= 7 ? "text-success" : value >= 5 ? "text-warning" : "text-danger"}`}>
        {value}
      </span>
    </div>
  );
}

export default function MessageInput({ onSend, onStop, generating, disabled }: Props) {
  const { t, lang } = useLanguage();
  const [input, setInput]           = useState("");
  const [images, setImages]         = useState<AttachedImage[]>([]);
  const [docs, setDocs]             = useState<AttachedDoc[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [maskTarget, setMaskTarget] = useState<AttachedImage | null>(null);
  const [webSearch, setWebSearch]   = useState(false);
  const [useRag, setUseRag]         = useState(false);
  const [showEval, setShowEval]     = useState(false);
  const [modelCaps, setModelCaps]   = useState<ModelCapabilities>(() =>
    getModelCapabilities(loadSettings().selectedModel)
  );
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const docInputRef     = useRef<HTMLInputElement>(null);
  const textareaRef     = useRef<HTMLTextAreaElement>(null);

  // Re-check model capabilities when model changes
  useEffect(() => {
    function update() {
      setModelCaps(getModelCapabilities(loadSettings().selectedModel));
    }
    window.addEventListener("umai:settings-change", update);
    window.addEventListener("umai:models-change",   update);
    return () => {
      window.removeEventListener("umai:settings-change", update);
      window.removeEventListener("umai:models-change",   update);
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [input]);

  // Close eval panel when input is cleared
  useEffect(() => {
    if (!input.trim()) setShowEval(false);
  }, [input]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () =>
        setImages((prev) => [...prev, { id: crypto.randomUUID(), dataUrl: reader.result as string, name: file.name }]);
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }, []);

  const handleDocChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setDocLoading(true);
    try {
      for (const file of files) {
        const token = getStoredToken();
        const fd = new FormData();
        fd.append("file", file);
        fd.append("mode", "full");
        fd.append("max_chars", "60000");
        const r = await fetch("/api/v1/tasks/documents/extract", {
          method: "POST",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!r.ok) continue;
        const data = await r.json() as {
          text: string; char_count: number; page_count?: number | null;
          filename: string; mode: string; truncated: boolean;
        };
        setDocs((prev) => [...prev, {
          id: crypto.randomUUID(),
          name: data.filename || file.name,
          text: data.text,
          charCount: data.char_count,
          pageCount: data.page_count,
          truncated: data.truncated,
          mode: "full",
        }]);
      }
    } finally {
      setDocLoading(false);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (!input.trim() && images.length === 0 && docs.length === 0) return;
    setShowEval(false);
    const docContext = docs.length > 0
      ? docs.map((d) => `### ${d.name}\n${d.text}`).join("\n\n---\n\n")
      : undefined;
    onSend(input.trim(), images, webSearch || undefined, docContext, useRag || undefined);
    setInput("");
    setImages([]);
    setDocs([]);
  }, [input, images, docs, onSend, webSearch, useRag]);

  const handleMaskApply = useCallback((compositeDataUrl: string) => {
    setImages((prev) => [...prev, { id: crypto.randomUUID(), dataUrl: compositeDataUrl, name: "masked_region.png" }]);
    setMaskTarget(null);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const canSend = (input.trim().length > 0 || images.length > 0 || docs.length > 0) && !disabled && !generating && !docLoading;
  const evalResult = input.trim() ? evaluatePrompt(input, lang) : null;

  return (
    <>
      <MaskEditorModal
        open={!!maskTarget}
        imageSrc={maskTarget?.dataUrl ?? null}
        onClose={() => setMaskTarget(null)}
        onApply={handleMaskApply}
      />

      <div className="w-full px-3 pb-4 pt-1">
        <div className="flex flex-col max-w-3xl mx-auto gap-1">

          {/* 프롬프트 평가 패널 */}
          {showEval && evalResult && (
            <div className="rounded-2xl border border-border bg-elevated px-4 py-3 flex flex-col gap-2.5 animate-modal">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">{t("eval.title")}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    evalResult.overall >= 7 ? "bg-success/15 text-success" :
                    evalResult.overall >= 5 ? "bg-warning/15 text-warning" : "bg-danger/15 text-danger"
                  }`}>
                    {evalResult.overall}/10
                  </span>
                </div>
                <button
                  onClick={() => setShowEval(false)}
                  className="p-1 rounded-lg text-text-muted hover:bg-hover transition-colors"
                >
                  <X size={12} />
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <ScoreBar value={evalResult.clarity}       label={t("eval.clarity")} />
                <ScoreBar value={evalResult.specificity}   label={t("eval.specificity")} />
                <ScoreBar value={evalResult.context}       label={t("eval.context")} />
                <ScoreBar value={evalResult.actionability} label={t("eval.actionability")} />
              </div>

              {evalResult.suggestions.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-text-secondary mb-1">{t("eval.suggestions")}</p>
                  <ul className="flex flex-col gap-1">
                    {evalResult.suggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-text-muted">
                        <span className="text-warning mt-0.5">·</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-success">{t("eval.good")}</p>
              )}
            </div>
          )}

          {/* 메인 입력 박스 */}
          <div className="flex flex-col relative w-full shadow-lg rounded-3xl border border-border/30 bg-white/5 backdrop-blur-sm transition px-1">

            {/* 파일 미리보기 */}
            {images.length > 0 && (
              <div className="mx-2 mt-2.5 pb-1.5 flex items-center flex-wrap gap-2">
                {images.map((img) => (
                  <div key={img.id} className="relative group/file">
                    <img src={img.dataUrl} alt={img.name} className="size-14 rounded-xl object-cover border border-border" />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                      className="absolute -top-1 -right-1 bg-white text-black border border-white rounded-full size-4 flex items-center justify-center outline-none group-hover/file:opacity-100 opacity-0 transition"
                    >
                      <X size={10} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaskTarget(img)}
                      title={t("input.mask")}
                      className="absolute -bottom-1 -left-1 bg-blue-600 text-white rounded-full size-4 flex items-center justify-center outline-none group-hover/file:opacity-100 opacity-0 transition"
                    >
                      <Brush size={9} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 문서 첨부 미리보기 */}
            {(docs.length > 0 || docLoading) && (
              <div className="mx-2 mt-2.5 pb-1.5 flex flex-col gap-1.5">
                {docLoading && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-elevated border border-border text-xs text-text-muted animate-pulse">
                    <FileText size={13} />
                    <span>{lang === "ko" ? "문서 추출 중…" : "Extracting document…"}</span>
                  </div>
                )}
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-elevated border border-border text-xs group/doc">
                    <FileText size={13} className="text-accent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium text-text-primary">{doc.name}</p>
                      <p className="text-text-muted">
                        {doc.pageCount ? `${doc.pageCount}p · ` : ""}
                        {(doc.charCount / 1000).toFixed(1)}k chars
                        {doc.truncated ? " (truncated)" : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDocs((prev) => prev.filter((d) => d.id !== doc.id))}
                      className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-hover transition opacity-0 group-hover/doc:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 텍스트 입력 */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("input.placeholder")}
              rows={1}
              disabled={disabled}
              className="scrollbar-none bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none w-full py-3 px-3 resize-none overflow-auto leading-relaxed"
              style={{ maxHeight: "144px" }}
            />

            {/* 하단 툴바 */}
            <div className="flex justify-between mt-0.5 mb-2.5 mx-0.5">
              {/* 왼쪽 */}
              <div className="ml-1 self-end flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-transparent hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary rounded-full size-8 flex justify-center items-center outline-none transition"
                  title={t("input.attach")}
                >
                  <ImageIcon size={16} />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />

                <button
                  type="button"
                  onClick={() => docInputRef.current?.click()}
                  disabled={docLoading}
                  className="bg-transparent hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary rounded-full size-8 flex justify-center items-center outline-none transition disabled:opacity-40"
                  title={lang === "ko" ? "문서 첨부 (PDF, DOCX, TXT)" : "Attach document (PDF, DOCX, TXT)"}
                >
                  <FileText size={16} />
                </button>
                <input ref={docInputRef} type="file" accept=".pdf,.docx,.txt,.md" multiple onChange={handleDocChange} className="hidden" />

                <div className="flex self-center w-px h-4 mx-0.5 bg-border/50" />

                {/* 웹 검색 */}
                <button
                  type="button"
                  onClick={() => setWebSearch((v) => !v)}
                  className={`group p-[7px] flex gap-1.5 items-center text-xs rounded-full transition-colors duration-300 outline-none ${
                    webSearch
                      ? "text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20"
                      : "bg-transparent text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
                  }`}
                >
                  <Globe size={14} />
                  <span className="pr-0.5">{t("home.webSearch")}</span>
                </button>

                {/* Vision / OCR 배지 (이미지 첨부 시) */}
                {images.length > 0 && (
                  modelCaps.vision ? (
                    <div
                      title={lang === "ko" ? "모델이 이미지를 직접 분석합니다" : "Model will analyze image natively"}
                      className="group p-[7px] flex gap-1.5 items-center text-xs rounded-full text-accent bg-accent/10 border border-accent/20"
                    >
                      <Sparkles size={14} />
                      <span className="pr-0.5">Vision</span>
                    </div>
                  ) : (
                    <div
                      title={lang === "ko" ? "OCR로 이미지에서 텍스트를 추출합니다 (Ollama llava 필요)" : "Text will be extracted via OCR (requires Ollama llava)"}
                      className="group p-[7px] flex gap-1.5 items-center text-xs rounded-full text-yellow-400 bg-yellow-500/10 border border-yellow-500/20"
                    >
                      <ScanText size={14} />
                      <span className="pr-0.5">OCR</span>
                    </div>
                  )
                )}

                {/* RAG 토글 */}
                <button
                  type="button"
                  onClick={() => setUseRag((v) => !v)}
                  title={lang === "ko" ? "Knowledge Base 검색 활성화" : "Search Knowledge Base"}
                  className={`group p-[7px] flex gap-1.5 items-center text-xs rounded-full transition-colors duration-300 outline-none ${
                    useRag
                      ? "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20"
                      : "bg-transparent text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
                  }`}
                >
                  <BookOpen size={14} />
                  <span className="pr-0.5">{lang === "ko" ? "지식" : "RAG"}</span>
                </button>

                {/* 프롬프트 평가 버튼 */}
                {input.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowEval((v) => !v)}
                    title={t("eval.button")}
                    className={`group p-[7px] flex gap-1.5 items-center text-xs rounded-full transition-colors duration-300 outline-none ${
                      showEval
                        ? "text-accent bg-accent/10 border border-accent/20"
                        : "bg-transparent text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    <Wand2 size={14} />
                    <span className="pr-0.5">{t("eval.button")}</span>
                    {showEval ? <ChevronUp size={11} className="ml-0.5" /> : null}
                  </button>
                )}
              </div>

              {/* 오른쪽: 전송 / 중지 */}
              <div className="self-end flex items-center mr-1">
                {generating ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="bg-surface hover:bg-hover text-text-primary border border-border transition rounded-full p-1.5"
                    title={t("input.stop")}
                  >
                    <StopCircle size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSend}
                    className={`transition rounded-full p-1.5 self-center ${
                      canSend
                        ? "bg-text-primary text-base hover:opacity-90 cursor-pointer"
                        : "text-text-muted bg-hover cursor-not-allowed"
                    }`}
                    title={t("input.sendTitle")}
                  >
                    <ArrowUp size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 키보드 힌트 */}
          <p className="text-center text-xs text-text-muted mt-1 opacity-60 select-none">
            {t("input.hint")}
          </p>
        </div>
      </div>
    </>
  );
}
