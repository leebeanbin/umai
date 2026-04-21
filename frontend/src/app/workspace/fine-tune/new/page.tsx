"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, Upload, Info } from "lucide-react";
import {
  apiListDatasets,
  apiCreateDataset,
  apiCreateJob,
  apiListSupportedModels,
  type DatasetOut,
  type SupportedModel,
} from "@/lib/api/fineTuneClient";
import { useAuth } from "@/components/providers/AuthProvider";

const INPUT_CLS =
  "w-full px-3 py-2 rounded-lg border border-border bg-elevated text-sm text-text-primary " +
  "placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors";
const SELECT_CLS = INPUT_CLS;

const FORMAT_EXAMPLES: Record<string, string> = {
  chat: `{"messages": [{"role": "user", "content": "질문"}, {"role": "assistant", "content": "답변"}]}`,
  instruction: `{"instruction": "지시", "input": "입력 (선택)", "output": "출력"}`,
  completion: `{"prompt": "텍스트 시작", "completion": "이어질 텍스트"}`,
};

const METHOD_LABELS = {
  lora:  { label: "LoRA",   desc: "Low-Rank Adaptation. 가장 보편적, 16GB VRAM 권장" },
  qlora: { label: "QLoRA",  desc: "4비트 양자화 LoRA. 8~12GB VRAM으로 학습 가능" },
  full:  { label: "Full",   desc: "전체 파라미터 학습. 소형 모델(3B 이하) 권장" },
};

// ─────────────────────────────────────────────────────────────────────────────

export default function NewFineTunePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [step, setStep] = useState(0); // 0: 데이터셋, 1: 모델, 2: 설정, 3: 확인
  const [saving, setSaving] = useState(false);

  // 데이터셋
  const [datasets, setDatasets]   = useState<DatasetOut[]>([]);
  const [selectedDs, setSelectedDs] = useState<string>(""); // id
  const [newDsName,  setNewDsName]  = useState("");
  const [newDsFormat, setNewDsFormat] = useState<"chat" | "instruction" | "completion">("chat");
  const [newDsRaw,   setNewDsRaw]   = useState("");
  const [dsMode, setDsMode]         = useState<"existing" | "upload">("existing");
  const [uploadingDs, setUploadingDs] = useState(false);

  // 모델
  const [models, setModels]       = useState<SupportedModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [method, setMethod]       = useState<"lora" | "qlora" | "full">("lora");

  // 학습 설정
  const [jobName,   setJobName]   = useState("");
  const [loraRank,  setLoraRank]  = useState(16);
  const [loraAlpha, setLoraAlpha] = useState(32);
  const [epochs,    setEpochs]    = useState(3);
  const [lr,        setLr]        = useState("0.0002");
  const [batchSize, setBatchSize] = useState(4);
  const [maxSeqLen, setMaxSeqLen] = useState(2048);
  const [outputName, setOutputName] = useState("");

  useEffect(() => {
    if (authLoading || !user) return;
    Promise.all([apiListDatasets(), apiListSupportedModels()])
      .then(([d, m]) => { setDatasets(d); setModels(m); })
      .catch(() => {});
  }, [user, authLoading]);

  // ── 데이터셋 업로드 ────────────────────────────────────────────────────────
  function validateJsonl(raw: string): number[] {
    return raw.trim().split("\n").reduce<number[]>((acc, line, i) => {
      try { JSON.parse(line); } catch { acc.push(i + 1); }
      return acc;
    }, []);
  }

  async function handleUploadDataset() {
    if (!newDsName.trim() || !newDsRaw.trim()) return;
    const badLines = validateJsonl(newDsRaw);
    if (badLines.length > 0) {
      alert(`JSONL 형식 오류: ${badLines.slice(0, 5).join(", ")}번 줄을 확인하세요.`);
      return;
    }
    setUploadingDs(true);
    try {
      const ds = await apiCreateDataset({ name: newDsName, format: newDsFormat, raw_data: newDsRaw });
      setDatasets((prev) => [ds, ...prev]);
      setSelectedDs(ds.id);
      setDsMode("existing");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "데이터셋 업로드 실패");
    } finally {
      setUploadingDs(false);
    }
  }

  // ── 최종 제출 ─────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSaving(true);
    try {
      const job = await apiCreateJob({
        name: jobName || `${selectedModelInfo?.name ?? "모델"} 학습`,
        dataset_id: selectedDs,
        base_model: selectedModel,
        method,
        lora_rank:  loraRank,
        lora_alpha: loraAlpha,
        epochs,
        learning_rate: parseFloat(lr),
        batch_size: batchSize,
        max_seq_length: maxSeqLen,
        warmup_ratio: 0.1,
        output_model_name: outputName || undefined,
      });
      router.push(`/workspace/fine-tune/${job.id}`);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "작업 생성 실패");
      setSaving(false);
    }
  }

  const selectedDsInfo    = datasets.find((d) => d.id === selectedDs);
  const selectedModelInfo = models.find((m) => m.id === selectedModel);

  // 각 스텝 완료 조건
  const step0ok = dsMode === "existing" ? !!selectedDs : false;
  const step1ok = !!selectedModel;

  const STEPS = ["데이터셋", "모델 선택", "학습 설정", "확인 & 시작"];

  const modelFamilies = [...new Set(models.map((m) => m.family))];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/workspace/fine-tune")}
          className="p-1.5 rounded-lg hover:bg-hover text-text-muted transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-base font-semibold text-text-primary">새 파인튜닝 작업</h1>
      </div>

      {/* 스텝 인디케이터 */}
      <div className="flex items-center gap-0">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors " +
                  (i < step
                    ? "bg-accent border-accent text-white"
                    : i === step
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border text-text-muted bg-elevated")
                }
              >
                {i < step ? <Check size={12} /> : i + 1}
              </div>
              <span
                className={
                  "text-[10px] font-medium whitespace-nowrap " +
                  (i === step ? "text-accent" : "text-text-muted")
                }
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={
                  "flex-1 h-px mx-2 mb-4 transition-colors " +
                  (i < step ? "bg-accent" : "bg-border")
                }
              />
            )}
          </div>
        ))}
      </div>

      {/* ── Step 0: 데이터셋 ──────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {(["existing", "upload"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setDsMode(m)}
                className={
                  "flex-1 py-2 text-xs font-medium rounded-lg border transition-colors " +
                  (dsMode === m
                    ? "bg-accent/10 border-accent text-accent"
                    : "border-border text-text-muted hover:bg-hover")
                }
              >
                {m === "existing" ? "기존 데이터셋 선택" : "새 데이터셋 업로드"}
              </button>
            ))}
          </div>

          {dsMode === "existing" ? (
            datasets.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">
                데이터셋이 없습니다. 채팅 파인튜닝 모드나 업로드로 먼저 추가하세요.
              </div>
            ) : (
              <div className="space-y-2">
                {datasets.map((ds) => (
                  <label
                    key={ds.id}
                    className={
                      "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors " +
                      (selectedDs === ds.id
                        ? "border-accent bg-accent/5"
                        : "border-border hover:border-border-hover bg-surface")
                    }
                  >
                    <input
                      type="radio"
                      name="dataset"
                      value={ds.id}
                      checked={selectedDs === ds.id}
                      onChange={() => setSelectedDs(ds.id)}
                      className="accent-accent"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text-primary">{ds.name}</p>
                      <p className="text-[11px] text-text-muted">
                        {ds.example_count}개 예제 · {ds.format}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
                  데이터셋 이름
                </label>
                <input
                  className={INPUT_CLS}
                  placeholder="예: 고객 서비스 대화 데이터"
                  value={newDsName}
                  onChange={(e) => setNewDsName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
                  데이터 형식
                </label>
                <select
                  className={SELECT_CLS}
                  value={newDsFormat}
                  onChange={(e) => setNewDsFormat(e.target.value as "chat" | "instruction" | "completion")}
                >
                  <option value="chat">Chat (messages 배열)</option>
                  <option value="instruction">Instruction (instruction/output)</option>
                  <option value="completion">Completion (prompt/completion)</option>
                </select>
              </div>
              <div className="rounded-lg bg-elevated p-3 text-[10px] text-text-muted font-mono">
                <span className="text-text-primary font-semibold block mb-1">예시 형식:</span>
                {FORMAT_EXAMPLES[newDsFormat]}
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
                  JSONL 데이터 (한 줄에 한 예제)
                </label>
                <textarea
                  className={INPUT_CLS + " resize-none font-mono text-xs"}
                  rows={8}
                  placeholder={`${FORMAT_EXAMPLES[newDsFormat]}\n${FORMAT_EXAMPLES[newDsFormat]}`}
                  value={newDsRaw}
                  onChange={(e) => setNewDsRaw(e.target.value)}
                />
              </div>
              <button
                onClick={handleUploadDataset}
                disabled={uploadingDs || !newDsName.trim() || !newDsRaw.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-elevated hover:bg-hover text-sm text-text-primary disabled:opacity-50 transition-colors"
              >
                {uploadingDs ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                데이터셋 업로드
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Step 1: 모델 선택 ─────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          {/* 방법 선택 */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
              학습 방법
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(METHOD_LABELS) as [string, {label: string; desc: string}][]).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setMethod(key as "lora" | "qlora" | "full")}
                  className={
                    "p-3 rounded-xl border text-left transition-colors " +
                    (method === key
                      ? "border-accent bg-accent/5"
                      : "border-border hover:border-border-hover bg-surface")
                  }
                >
                  <p className={`text-xs font-semibold mb-1 ${method === key ? "text-accent" : "text-text-primary"}`}>
                    {val.label}
                  </p>
                  <p className="text-[10px] text-text-muted leading-tight">{val.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 모델 선택 */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
              베이스 모델
            </label>
            {modelFamilies.map((family) => (
              <div key={family} className="space-y-1">
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-1">
                  {family}
                </p>
                {models.filter((m) => m.family === family).map((m) => (
                  <label
                    key={m.id}
                    className={
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors " +
                      (selectedModel === m.id
                        ? "border-accent bg-accent/5"
                        : "border-border hover:border-border-hover bg-surface")
                    }
                  >
                    <input
                      type="radio"
                      name="model"
                      value={m.id}
                      checked={selectedModel === m.id}
                      onChange={() => setSelectedModel(m.id)}
                      className="accent-accent flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-text-primary">{m.name}</p>
                      <p className="text-[10px] text-text-muted font-mono truncate">{m.id}</p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <span className="text-[10px] font-semibold text-text-primary">{m.size}</span>
                      <span className="text-[10px] text-text-muted">{m.vram}</span>
                    </div>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 2: 학습 설정 ─────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">작업 이름</label>
            <input
              className={INPUT_CLS}
              placeholder={`${selectedModelInfo?.name ?? "모델"} 학습`}
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">LoRA Rank</label>
              <input className={INPUT_CLS} type="number" min={4} max={256} value={loraRank} onChange={(e) => setLoraRank(+e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">LoRA Alpha</label>
              <input className={INPUT_CLS} type="number" min={4} max={512} value={loraAlpha} onChange={(e) => setLoraAlpha(+e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">Epochs</label>
              <input className={INPUT_CLS} type="number" min={1} max={20} value={epochs} onChange={(e) => setEpochs(+e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">Learning Rate</label>
              <input className={INPUT_CLS} type="text" value={lr} onChange={(e) => setLr(e.target.value)} placeholder="0.0002" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">Batch Size</label>
              <input className={INPUT_CLS} type="number" min={1} max={64} value={batchSize} onChange={(e) => setBatchSize(+e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">Max Seq Length</label>
              <input className={INPUT_CLS} type="number" min={128} max={8192} value={maxSeqLen} onChange={(e) => setMaxSeqLen(+e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
              출력 모델명 (선택 — Ollama 등록용)
            </label>
            <input
              className={INPUT_CLS}
              placeholder="예: my-llama-ft"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* ── Step 3: 확인 ──────────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">요약</p>
            {[
              ["작업 이름",    jobName || `${selectedModelInfo?.name ?? "모델"} 학습`],
              ["데이터셋",     `${selectedDsInfo?.name} (${selectedDsInfo?.example_count}개 예제)`],
              ["베이스 모델",  selectedModelInfo?.name ?? selectedModel],
              ["학습 방법",    METHOD_LABELS[method].label],
              ["LoRA Rank/Alpha", `${loraRank} / ${loraAlpha}`],
              ["Epochs",       String(epochs)],
              ["Learning Rate", lr],
              ["Batch Size",   String(batchSize)],
              ["Max Seq Length", `${maxSeqLen} tokens`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-text-muted">{k}</span>
                <span className="text-text-primary font-medium text-right max-w-[60%] truncate">{v}</span>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 p-3 rounded-lg bg-elevated text-[11px] text-text-muted">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <p>
              현재는 학습 시뮬레이션으로 실행됩니다. 실제 GPU 학습은 Unsloth / HuggingFace Trainer 연동 후 가능합니다.
            </p>
          </div>
        </div>
      )}

      {/* 네비게이션 버튼 */}
      <div className="flex justify-between pt-2">
        <button
          onClick={() => step > 0 ? setStep(step - 1) : router.push("/workspace/fine-tune")}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border hover:bg-hover text-sm text-text-primary transition-colors"
        >
          <ArrowLeft size={14} /> 이전
        </button>
        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={
              (step === 0 && !step0ok) ||
              (step === 1 && !step1ok)
            }
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40 transition-colors"
          >
            다음 <ArrowRight size={14} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-40 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            학습 시작
          </button>
        )}
      </div>
    </div>
  );
}
