"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp, StopCircle, Trash2, FlaskConical, ChevronDown, Sliders,
  Copy, RefreshCw, Download, Check, ImageIcon, Loader2, ZoomIn, X,
} from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { type TranslationKey } from "@/lib/i18n";
import { loadModels, type DynamicModel } from "@/lib/appStore";
import { useChat } from "@/lib/hooks/useChat";
import { streamChat } from "@/lib/apis/chat";
import { getStoredToken } from "@/lib/api/backendClient";
import ModelSelect from "@/components/common/ModelSelect";
import type { Message } from "@/components/chat/MessageList";

type Tab = "chat" | "completions" | "images";
type TFn = (key: TranslationKey) => string;

export default function PlaygroundPage() {
  const { t }       = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>("chat");

  const tabLabel = (tab: Tab): string => {
    if (tab === "chat")        return t("playground.tab.chat");
    if (tab === "completions") return t("playground.tab.completions");
    return t("playground.tab.images");
  };

  return (
    <div className="flex flex-col h-full bg-base overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border-subtle bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-accent" />
          <h1 className="text-sm font-semibold text-text-primary">{t("playground.title")}</h1>
        </div>
        <div className="flex items-center gap-1 ml-2">
          {(["chat", "completions", "images"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === tab
                  ? "bg-hover text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "chat"        && <ChatPlayground t={t} />}
        {activeTab === "completions" && <CompletionsPlayground t={t} />}
        {activeTab === "images"      && <ImagesPlayground />}
      </div>
    </div>
  );
}

// ── Images Playground ─────────────────────────────────────────────────────────

type ImageModel = "dall-e-3" | "dall-e-2";
type ImageSize3 = "1024x1024" | "1792x1024" | "1024x1792";
type ImageSize2 = "256x256" | "512x512" | "1024x1024";
type ImageQuality = "standard" | "hd";
type ImageStyle = "vivid" | "natural";

type GeneratedImage = {
  url: string;
  revised_prompt?: string;
  prompt: string;
  model: ImageModel;
  timestamp: number;
};

const DALLE3_SIZES: { value: ImageSize3; label: string }[] = [
  { value: "1024x1024", label: "1:1  (1024×1024)" },
  { value: "1792x1024", label: "16:9 (1792×1024)" },
  { value: "1024x1792", label: "9:16 (1024×1792)" },
];
const DALLE2_SIZES: { value: ImageSize2; label: string }[] = [
  { value: "1024x1024", label: "1024×1024" },
  { value: "512x512",   label: "512×512" },
  { value: "256x256",   label: "256×256" },
];

function ImagesPlayground() {
  const [model, setModel]       = useState<ImageModel>("dall-e-3");
  const [size, setSize]         = useState<string>("1024x1024");
  const [quality, setQuality]   = useState<ImageQuality>("standard");
  const [style, setStyle]       = useState<ImageStyle>("vivid");
  const [n, setN]               = useState(1);
  const [prompt, setPrompt]     = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [history, setHistory]   = useState<GeneratedImage[]>([]);
  const [preview, setPreview]   = useState<GeneratedImage | null>(null);
  const [hasKey, setHasKey]     = useState<boolean | null>(null);

  // Check if server has OpenAI key
  useEffect(() => {
    fetch("/api/image")
      .then((r) => r.json())
      .then((d: { openai: boolean }) => setHasKey(d.openai))
      .catch(() => setHasKey(false));
  }, []);

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setError(null);
    setGenerating(true);
    try {
      const token = getStoredToken();
      const res = await fetch("/api/image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          provider: "openai",
          model,
          prompt: prompt.trim(),
          size,
          quality: model === "dall-e-3" ? quality : undefined,
          style:   model === "dall-e-3" ? style   : undefined,
          n:       model === "dall-e-3" ? 1 : n,
        }),
      });
      const data = await res.json() as { images?: { url: string; revised_prompt?: string }[]; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? `Error ${res.status}`);
        return;
      }
      const newImages: GeneratedImage[] = (data.images ?? []).map((img) => ({
        url: img.url,
        revised_prompt: img.revised_prompt,
        prompt: prompt.trim(),
        model,
        timestamp: Date.now(),
      }));
      setHistory((prev) => [...newImages, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownload(img: GeneratedImage) {
    try {
      const res = await fetch(img.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `image-${img.timestamp}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(img.url, "_blank");
    }
  }

  const sizes = model === "dall-e-3" ? DALLE3_SIZES : DALLE2_SIZES;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: config panel */}
      <div className="w-64 shrink-0 border-r border-border-subtle bg-surface flex flex-col overflow-y-auto">
        <div className="p-4 flex flex-col gap-4">

          {/* Model */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">Model</label>
            <div className="flex gap-1.5">
              {(["dall-e-3", "dall-e-2"] as ImageModel[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setModel(m); setSize("1024x1024"); }}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    model === m
                      ? "bg-accent/10 border-accent/30 text-accent"
                      : "border-border text-text-secondary hover:bg-hover"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Size */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">Size</label>
            <div className="flex flex-col gap-1">
              {sizes.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setSize(value)}
                  className={`text-left px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                    size === value
                      ? "bg-accent/10 border-accent/30 text-accent"
                      : "border-border text-text-secondary hover:bg-hover"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* DALL-E 3 exclusive options */}
          {model === "dall-e-3" && (
            <>
              {/* Quality */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">Quality</label>
                <div className="flex gap-1.5">
                  {(["standard", "hd"] as ImageQuality[]).map((q) => (
                    <button
                      key={q}
                      onClick={() => setQuality(q)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        quality === q
                          ? "bg-accent/10 border-accent/30 text-accent"
                          : "border-border text-text-secondary hover:bg-hover"
                      }`}
                    >
                      {q === "hd" ? "HD" : "Standard"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Style */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">Style</label>
                <div className="flex gap-1.5">
                  {(["vivid", "natural"] as ImageStyle[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStyle(s)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors border ${
                        style === s
                          ? "bg-accent/10 border-accent/30 text-accent"
                          : "border-border text-text-secondary hover:bg-hover"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-text-muted mt-1.5">
                  {style === "vivid" ? "Hyper-real & dramatic" : "Natural & less dramatic"}
                </p>
              </div>
            </>
          )}

          {/* DALL-E 2: number of images */}
          {model === "dall-e-2" && (
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-xs font-medium text-text-secondary">Count</label>
                <span className="text-xs font-mono text-accent">{n}</span>
              </div>
              <input
                type="range" min={1} max={4} step={1} value={n}
                onChange={(e) => setN(Number(e.target.value))}
                className="w-full h-1.5 rounded-full cursor-pointer accent-accent"
                style={{ background: `linear-gradient(to right, #7c6af5 ${((n - 1) / 3) * 100}%, var(--color-border) ${((n - 1) / 3) * 100}%)` }}
              />
              <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
                <span>1</span><span>4</span>
              </div>
            </div>
          )}
        </div>

        {/* Clear history */}
        {history.length > 0 && (
          <div className="mt-auto p-4 border-t border-border-subtle">
            <button
              onClick={() => setHistory([])}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs text-text-muted hover:bg-hover hover:text-text-secondary transition-colors"
            >
              <Trash2 size={13} />Clear History
            </button>
          </div>
        )}
      </div>

      {/* Right: prompt + gallery */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* No API key warning */}
        {hasKey === false && (
          <div className="mx-4 mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-warning/10 border border-warning/20 text-xs text-warning">
            <ImageIcon size={13} className="shrink-0" />
            <span>
              <strong>OPENAI_API_KEY</strong> 환경변수가 설정되지 않았습니다. 이미지 생성을 사용하려면 서버에 키를 설정하세요.
            </span>
          </div>
        )}

        {/* Prompt input area */}
        <div className="shrink-0 px-4 pt-4 pb-3">
          <div className="flex flex-col gap-2 p-3 rounded-2xl border border-border bg-surface">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey) handleGenerate();
              }}
              placeholder="Describe the image you want to generate... (⌘+Enter to generate)"
              rows={3}
              className="resize-none bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none leading-relaxed"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted">
                {model === "dall-e-3" && quality === "hd" && "HD quality uses 2× credits"}
              </span>
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim() || generating || hasKey === false}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-colors ${
                  prompt.trim() && !generating && hasKey !== false
                    ? "bg-accent hover:bg-accent-hover text-white"
                    : "bg-hover text-text-muted cursor-not-allowed"
                }`}
              >
                {generating ? (
                  <><Loader2 size={13} className="animate-spin" />Generating...</>
                ) : (
                  <><ImageIcon size={13} />Generate</>
                )}
              </button>
            </div>
          </div>
          {error && (
            <p className="mt-2 text-xs text-danger bg-danger/10 border border-danger/20 px-3 py-2 rounded-xl">
              {error}
            </p>
          )}
        </div>

        {/* Gallery */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {history.length === 0 && !generating ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted">
              <ImageIcon size={36} className="opacity-20" />
              <p className="text-sm">Generate an image to see it here</p>
            </div>
          ) : (
            <div className="columns-2 gap-3 space-y-3">
              {/* Generating placeholder */}
              {generating && (
                <div className="break-inside-avoid rounded-2xl border border-border bg-surface aspect-square flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3 text-text-muted">
                    <Loader2 size={24} className="animate-spin opacity-50" />
                    <p className="text-xs">Generating...</p>
                  </div>
                </div>
              )}
              {history.map((img) => (
                <ImageCard
                  key={img.timestamp}
                  img={img}
                  onPreview={() => setPreview(img)}
                  onDownload={() => handleDownload(img)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox preview */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative max-w-3xl w-full bg-surface rounded-2xl overflow-hidden shadow-2xl border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt={preview.prompt} loading="lazy" className="w-full object-contain max-h-[70vh]" />
            <div className="p-4 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text-secondary mb-0.5">
                  {preview.model} · {new Date(preview.timestamp).toLocaleTimeString()}
                </p>
                {preview.revised_prompt && preview.revised_prompt !== preview.prompt ? (
                  <>
                    <p className="text-xs text-text-muted mb-1">Original: {preview.prompt}</p>
                    <p className="text-xs text-text-primary leading-relaxed">Revised: {preview.revised_prompt}</p>
                  </>
                ) : (
                  <p className="text-xs text-text-primary leading-relaxed">{preview.prompt}</p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleDownload(preview)}
                  className="p-2 rounded-xl border border-border text-text-secondary hover:bg-hover transition-colors"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => setPreview(null)}
                  className="p-2 rounded-xl border border-border text-text-secondary hover:bg-hover transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImageCard({
  img,
  onPreview,
  onDownload,
}: {
  img: GeneratedImage;
  onPreview: () => void;
  onDownload: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="break-inside-avoid relative rounded-2xl overflow-hidden border border-border bg-surface cursor-pointer group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.url}
        alt={img.prompt}
        className="w-full object-cover"
        loading="lazy"
      />
      {hovered && (
        <div className="absolute inset-0 bg-black/50 flex flex-col justify-between p-3 transition-opacity">
          <div className="flex justify-end gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); onPreview(); }}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ZoomIn size={13} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDownload(); }}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <Download size={13} />
            </button>
          </div>
          <p className="text-[10px] text-white/80 line-clamp-2 leading-relaxed">
            {img.revised_prompt ?? img.prompt}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Shared parameter panel ────────────────────────────────────────────────────

type ParamState = {
  temperature: number;
  maxTokens: number;
  topP: number;
};

function ParameterPanel({
  model, setModel,
  params, setParams,
  showSystem, setShowSystem,
  systemPrompt, setSystem,
  showParams, setShowParams,
  t,
}: {
  model: DynamicModel;
  setModel: (m: DynamicModel) => void;
  params: ParamState;
  setParams: (p: ParamState) => void;
  showSystem: boolean;
  setShowSystem: (v: boolean) => void;
  systemPrompt: string;
  setSystem: (v: string) => void;
  showParams: boolean;
  setShowParams: (v: boolean) => void;
  t: TFn;
}) {
  const set = (key: keyof ParamState) => (value: number) =>
    setParams({ ...params, [key]: value });

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Model selector */}
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-2">{t("playground.model")}</label>
        <ModelSelect value={model} onChange={setModel} showTuning={false} />
      </div>

      {/* System prompt */}
      <div>
        <button
          onClick={() => setShowSystem(!showSystem)}
          className="flex items-center justify-between w-full text-xs font-medium text-text-secondary mb-1.5"
        >
          <span>{t("playground.systemPrompt")}</span>
          <ChevronDown size={11} className={`text-text-muted transition-transform ${showSystem ? "rotate-180" : ""}`} />
        </button>
        {showSystem && (
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystem(e.target.value)}
            rows={5}
            placeholder={t("playground.systemPromptPh")}
            className="w-full resize-none px-3 py-2.5 rounded-xl bg-elevated border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors leading-relaxed"
          />
        )}
      </div>

      {/* Parameters */}
      <div>
        <button
          onClick={() => setShowParams(!showParams)}
          className="flex items-center justify-between w-full text-xs font-medium text-text-secondary mb-1.5"
        >
          <span className="flex items-center gap-1.5"><Sliders size={11} />{t("playground.parameters")}</span>
          <ChevronDown size={11} className={`text-text-muted transition-transform ${showParams ? "rotate-180" : ""}`} />
        </button>
        {showParams && (
          <div className="flex flex-col gap-3">
            {/* Temperature */}
            <SliderField
              label={t("navbar.temperature")}
              value={params.temperature}
              min={0} max={2} step={0.05}
              onChange={set("temperature")}
              display={params.temperature.toFixed(2)}
              leftLabel={t("navbar.deterministic")}
              rightLabel={t("navbar.creative")}
            />
            {/* Max Tokens */}
            <SliderField
              label="Max Tokens"
              value={params.maxTokens}
              min={256} max={8192} step={256}
              onChange={set("maxTokens")}
              display={String(params.maxTokens)}
            />
            {/* Top-p */}
            <SliderField
              label="Top-p"
              value={params.topP}
              min={0} max={1} step={0.05}
              onChange={set("topP")}
              display={params.topP.toFixed(2)}
              leftLabel="Focused"
              rightLabel="Diverse"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SliderField({
  label, value, min, max, step, onChange, display, leftLabel, rightLabel,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display: string;
  leftLabel?: string; rightLabel?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs text-text-secondary">{label}</span>
        <span className="text-xs font-mono text-accent">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full cursor-pointer accent-accent"
        style={{ background: `linear-gradient(to right, #7c6af5 ${pct}%, var(--color-border) ${pct}%)` }}
      />
      {(leftLabel || rightLabel) && (
        <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
          <span>{leftLabel ?? ""}</span><span>{rightLabel ?? ""}</span>
        </div>
      )}
    </div>
  );
}

// ── Chat Playground ───────────────────────────────────────────────────────────

function ChatPlayground({ t }: { t: TFn }) {
  const [model, setModel]           = useState<DynamicModel>(() => loadModels()[0]);
  const [systemPrompt, setSystem]   = useState("");
  const [showSystem, setShowSystem] = useState(true);
  const [showParams, setShowParams] = useState(false);
  const [params, setParams]         = useState<ParamState>({ temperature: 0.8, maxTokens: 2048, topP: 1.0 });
  const [input, setInput]           = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, generating, send, stop, clear, regenerate } = useChat();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    if (!input.trim() || generating) return;
    const content = input.trim();
    setInput("");
    send(content, [], { model: model.id, temperature: params.temperature, maxTokens: params.maxTokens, topP: params.topP });
  }

  function handleExport() {
    const lines = messages.map((m) =>
      `**${m.role === "user" ? "User" : "Assistant"}**\n\n${m.content}`
    );
    const md = lines.join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playground-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: config panel */}
      <div className="w-64 shrink-0 border-r border-border-subtle bg-surface flex flex-col overflow-y-auto">
        <ParameterPanel
          model={model} setModel={setModel}
          params={params} setParams={setParams}
          showSystem={showSystem} setShowSystem={setShowSystem}
          systemPrompt={systemPrompt} setSystem={setSystem}
          showParams={showParams} setShowParams={setShowParams}
          t={t}
        />
        <div className="mt-auto p-4 border-t border-border-subtle flex flex-col gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleExport}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs text-text-muted hover:bg-hover hover:text-text-secondary transition-colors"
            >
              <Download size={13} />Export Markdown
            </button>
          )}
          <button
            onClick={clear}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs text-text-muted hover:bg-hover hover:text-text-secondary transition-colors"
          >
            <Trash2 size={13} />{t("playground.clear")}
          </button>
        </div>
      </div>

      {/* Right: chat area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-text-muted">
              <FlaskConical size={28} className="opacity-30" />
              <p className="text-sm">{t("playground.empty")}</p>
            </div>
          ) : messages.map((m) => (
            <PlaygroundMessage
              key={m.id}
              message={m}
              onRegenerate={m.role === "assistant" ? () => regenerate(m.id) : undefined}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-4 pb-4">
          <div className="flex items-end gap-2 p-3 rounded-2xl border border-border bg-surface">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t("playground.inputPh")}
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none leading-relaxed"
              style={{ maxHeight: "120px" }}
            />
            {generating ? (
              <button onClick={stop} className="p-1.5 rounded-full bg-danger/15 text-danger hover:bg-danger/25 transition-colors shrink-0">
                <StopCircle size={16} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className={`p-1.5 rounded-full shrink-0 transition-colors ${
                  input.trim() ? "bg-accent hover:bg-accent-hover text-white" : "bg-hover text-text-muted cursor-not-allowed"
                }`}
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Completions Playground ────────────────────────────────────────────────────

function CompletionsPlayground({ t }: { t: TFn }) {
  const [model, setModel]           = useState<DynamicModel>(() => loadModels()[0]);
  const [showSystem, setShowSystem] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [systemPrompt, setSystem]   = useState("");
  const [params, setParams]         = useState<ParamState>({ temperature: 0.8, maxTokens: 1024, topP: 1.0 });
  const [prompt, setPrompt]         = useState("");
  const [output, setOutput]         = useState("");
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handleComplete() {
    if (!prompt.trim() || generating) return;
    setOutput("");
    setGenerating(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    await streamChat({
      messages: [{ role: "user", content: prompt }],
      signal: ctrl.signal,
      modelOverride: model.id,
      temperatureOverride: params.temperature,
      maxTokensOverride: params.maxTokens,
      topPOverride: params.topP,
      onChunk: (chunk) => setOutput((prev) => prev + chunk),
      onDone: () => { setGenerating(false); abortRef.current = null; },
      onError: (err) => { setOutput(`Error: ${err}`); setGenerating(false); abortRef.current = null; },
    });
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
  }

  function handleClear() {
    setPrompt("");
    setOutput("");
  }

  function handleExport() {
    const md = `## Prompt\n\n${prompt}\n\n## Completion\n\n${output}`;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `completion-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: config */}
      <div className="w-64 shrink-0 border-r border-border-subtle bg-surface flex flex-col overflow-y-auto">
        <ParameterPanel
          model={model} setModel={setModel}
          params={params} setParams={setParams}
          showSystem={showSystem} setShowSystem={setShowSystem}
          systemPrompt={systemPrompt} setSystem={setSystem}
          showParams={showParams} setShowParams={setShowParams}
          t={t}
        />
        <div className="mt-auto p-4 border-t border-border-subtle flex flex-col gap-1">
          {output && (
            <button
              onClick={handleExport}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs text-text-muted hover:bg-hover hover:text-text-secondary transition-colors"
            >
              <Download size={13} />Export Markdown
            </button>
          )}
          <button
            onClick={handleClear}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs text-text-muted hover:bg-hover hover:text-text-secondary transition-colors"
          >
            <Trash2 size={13} />Clear
          </button>
        </div>
      </div>

      {/* Right: editor */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Prompt */}
        <div className="flex-1 flex flex-col border-b border-border-subtle overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle">
            <span className="text-xs font-medium text-text-secondary">Prompt</span>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter your prompt here..."
            className="flex-1 resize-none px-4 py-3 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none leading-relaxed"
          />
        </div>

        {/* Completion output */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle">
            <span className="text-xs font-medium text-text-secondary">Completion</span>
            {output && !generating && (
              <CopyButton text={output} />
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {output ? (
              <pre className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed font-sans">
                {output}
                {generating && (
                  <span className="inline-flex gap-0.5 ml-1 align-middle">
                    <span className="size-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="size-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="size-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                )}
              </pre>
            ) : (
              <div className="h-full flex items-center justify-center text-text-muted">
                <p className="text-sm">Completion will appear here</p>
              </div>
            )}
          </div>
        </div>

        {/* Action bar */}
        <div className="shrink-0 px-4 pb-4 pt-2 border-t border-border-subtle flex gap-2">
          {generating ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-danger/15 text-danger hover:bg-danger/25 transition-colors"
            >
              <StopCircle size={14} />Stop
            </button>
          ) : (
            <button
              onClick={handleComplete}
              disabled={!prompt.trim()}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                prompt.trim()
                  ? "bg-accent hover:bg-accent-hover text-white"
                  : "bg-hover text-text-muted cursor-not-allowed"
              }`}
            >
              <ArrowUp size={14} />Complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Playground Message ────────────────────────────────────────────────────────

function PlaygroundMessage({
  message,
  onRegenerate,
}: {
  message: Message;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === "user";
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className={`size-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
        isUser ? "bg-accent text-white" : "bg-surface border border-border text-text-secondary"
      }`}>
        {isUser ? "Y" : "A"}
      </div>

      <div className="flex flex-col gap-1 max-w-[75%]">
        <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-accent/15 border border-accent/20 text-text-primary"
            : "bg-surface border border-border text-text-primary"
        }`}>
          {message.error ? (
            <span className="text-danger text-xs">{message.error}</span>
          ) : message.streaming && !message.content ? (
            <span className="inline-flex gap-1">
              <span className="size-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="size-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="size-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>

        {/* Action buttons (hover) */}
        {!message.streaming && !message.error && showActions && (
          <div className={`flex gap-1 ${isUser ? "justify-end" : "justify-start"}`}>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? "Copied" : "Copy"}
            </button>
            {!isUser && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
              >
                <RefreshCw size={10} />Regenerate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
