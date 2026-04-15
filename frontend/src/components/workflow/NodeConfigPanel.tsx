"use client";

import { type Node } from "@xyflow/react";
import { X, Plus, Trash2 } from "lucide-react";

interface NodeConfigPanelProps {
  node: Node | null;
  onChange: (nodeId: string, data: Record<string, unknown>) => void;
  onClose: () => void;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-text-muted leading-tight">{hint}</p>}
    </div>
  );
}

const INPUT_CLS =
  "w-full px-3 py-1.5 rounded-lg border border-border bg-elevated text-xs text-text-primary " +
  "placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors";
const TEXTAREA_CLS = INPUT_CLS + " resize-none";
const SELECT_CLS = INPUT_CLS;

const TOOL_OPTIONS = [
  { value: "web_search",       label: "Web Search" },
  { value: "execute_python",   label: "Python" },
  { value: "knowledge_search", label: "Knowledge Search" },
];

const TOOL_DEFAULTS: Record<string, Record<string, unknown>> = {
  web_search:       { query: "{{user_input}}" },
  execute_python:   { code: "" },
  knowledge_search: { query: "{{user_input}}", top_k: 5 },
};

function ToolArgsFields({
  toolName,
  args,
  onUpdate,
}: {
  toolName: string;
  args: Record<string, unknown>;
  onUpdate: (args: Record<string, unknown>) => void;
}) {
  if (toolName === "web_search") {
    return (
      <Field label="검색 쿼리" hint="{{변수명}} 으로 컨텍스트 변수 참조 가능">
        <input
          className={INPUT_CLS}
          placeholder="{{user_input}}"
          value={(args.query as string) || ""}
          onChange={(e) => onUpdate({ ...args, query: e.target.value })}
        />
      </Field>
    );
  }
  if (toolName === "knowledge_search") {
    return (
      <>
        <Field label="검색 쿼리" hint="{{변수명}} 으로 컨텍스트 변수 참조 가능">
          <input
            className={INPUT_CLS}
            placeholder="{{user_input}}"
            value={(args.query as string) || ""}
            onChange={(e) => onUpdate({ ...args, query: e.target.value })}
          />
        </Field>
        <Field label="결과 수 (top_k)">
          <input
            className={INPUT_CLS}
            type="number"
            min={1}
            max={20}
            value={(args.top_k as number) ?? 5}
            onChange={(e) => onUpdate({ ...args, top_k: parseInt(e.target.value) })}
          />
        </Field>
      </>
    );
  }
  if (toolName === "execute_python") {
    return (
      <Field label="파이썬 코드" hint="{{변수명}} 으로 컨텍스트 변수 참조 가능">
        <textarea
          className={TEXTAREA_CLS}
          rows={6}
          placeholder={"# python code\nprint('hello')"}
          value={(args.code as string) || ""}
          onChange={(e) => onUpdate({ ...args, code: e.target.value })}
        />
      </Field>
    );
  }
  return null;
}

const BRANCH_EXAMPLES = [
  "context.score > 0.8",
  'context.language === "ko"',
  "context.items.length > 0",
  "context.approved === true",
];

export function NodeConfigPanel({ node, onChange, onClose }: NodeConfigPanelProps) {
  if (!node) return null;

  const d = node.data as Record<string, unknown>;

  function update(patch: Record<string, unknown>) {
    onChange(node!.id, { ...d, ...patch });
  }

  const llmTools    = (d.tools as string[]) || [];
  const inputFields = (d.fields as { key: string; type: string }[]) || [];
  const toolArgs    = (d.args as Record<string, unknown>) || {};
  const toolName    = (d.tool_name as string) || "web_search";

  return (
    <aside className="w-72 flex-shrink-0 border-l border-border bg-base flex flex-col overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-xs font-semibold text-text-primary capitalize">
          {node.type} 설정
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-hover text-text-muted transition-colors"
          aria-label="닫기"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 공통: 레이블 */}
        <Field label="레이블">
          <input
            className={INPUT_CLS}
            value={(d.label as string) || ""}
            onChange={(e) => update({ label: e.target.value })}
          />
        </Field>

        {/* ── InputNode ─────────────────────────────────────── */}
        {node.type === "input" && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
                입력 필드
              </span>
              <button
                onClick={() =>
                  update({ fields: [...inputFields, { key: "", type: "string" }] })
                }
                className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover transition-colors"
              >
                <Plus size={11} /> 추가
              </button>
            </div>

            {inputFields.length === 0 ? (
              <p className="text-xs text-text-muted italic">
                필드가 없습니다. 추가를 눌러 입력 변수를 정의하세요.
              </p>
            ) : (
              <div className="space-y-2">
                {inputFields.map((f, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <input
                      className={INPUT_CLS + " flex-1 min-w-0"}
                      placeholder="변수명"
                      value={f.key}
                      onChange={(e) => {
                        const newFields = inputFields.map((fi, idx) =>
                          idx === i ? { ...fi, key: e.target.value } : fi,
                        );
                        update({ fields: newFields });
                      }}
                    />
                    <select
                      className="px-2 py-1.5 rounded-lg border border-border bg-elevated text-xs text-text-primary focus:outline-none focus:border-accent transition-colors w-20 flex-shrink-0"
                      value={f.type}
                      onChange={(e) => {
                        const newFields = inputFields.map((fi, idx) =>
                          idx === i ? { ...fi, type: e.target.value } : fi,
                        );
                        update({ fields: newFields });
                      }}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">bool</option>
                      <option value="text">text</option>
                    </select>
                    <button
                      onClick={() =>
                        update({ fields: inputFields.filter((_, idx) => idx !== i) })
                      }
                      className="p-1 rounded hover:bg-hover text-text-muted hover:text-danger transition-colors flex-shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-text-muted leading-tight">
              여기서 정의한 변수는 실행 시 입력폼으로 수집되며,{" "}
              다른 노드에서{" "}
              <code className="font-mono bg-elevated px-0.5 rounded">{"{{변수명}}"}</code>{" "}
              형식으로 참조할 수 있습니다.
            </p>
          </>
        )}

        {/* ── LLMNode ───────────────────────────────────────── */}
        {node.type === "llm" && (
          <>
            <Field label="Provider">
              <select
                className={SELECT_CLS}
                value={(d.provider as string) || "openai"}
                onChange={(e) => update({ provider: e.target.value })}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google</option>
                <option value="xai">xAI</option>
                <option value="ollama">Ollama</option>
              </select>
            </Field>
            <Field label="Model">
              <input
                className={INPUT_CLS}
                value={(d.model as string) || ""}
                placeholder="gpt-4o"
                onChange={(e) => update({ model: e.target.value })}
              />
            </Field>
            <Field label="System Prompt">
              <textarea
                className={TEXTAREA_CLS}
                rows={4}
                value={(d.system_prompt as string) || ""}
                onChange={(e) => update({ system_prompt: e.target.value })}
              />
            </Field>
            <Field
              label="User Message"
              hint="{{변수명}} 으로 컨텍스트 변수 참조 가능"
            >
              <textarea
                className={TEXTAREA_CLS}
                rows={3}
                value={(d.user_message as string) || ""}
                onChange={(e) => update({ user_message: e.target.value })}
              />
            </Field>
            <Field label="출력 키" hint="이 노드의 응답을 저장할 컨텍스트 변수명">
              <input
                className={INPUT_CLS}
                value={(d.output_key as string) || "response"}
                onChange={(e) => update({ output_key: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Temperature">
                <input
                  className={INPUT_CLS}
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={(d.temperature as number) ?? 0.7}
                  onChange={(e) =>
                    update({ temperature: parseFloat(e.target.value) })
                  }
                />
              </Field>
              <Field label="Max Steps">
                <input
                  className={INPUT_CLS}
                  type="number"
                  min={1}
                  max={50}
                  value={(d.max_steps as number) ?? 10}
                  onChange={(e) =>
                    update({ max_steps: parseInt(e.target.value) })
                  }
                />
              </Field>
            </div>
            <Field label="도구 (선택)">
              <div className="space-y-1.5 mt-0.5">
                {TOOL_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      className="rounded border-border accent-accent"
                      checked={llmTools.includes(opt.value)}
                      onChange={(e) => {
                        const newTools = e.target.checked
                          ? [...llmTools, opt.value]
                          : llmTools.filter((t) => t !== opt.value);
                        update({ tools: newTools });
                      }}
                    />
                    <span className="text-xs text-text-primary group-hover:text-accent transition-colors">
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          </>
        )}

        {/* ── ToolNode ──────────────────────────────────────── */}
        {node.type === "tool" && (
          <>
            <Field label="도구">
              <select
                className={SELECT_CLS}
                value={toolName}
                onChange={(e) => {
                  update({
                    tool_name: e.target.value,
                    args: TOOL_DEFAULTS[e.target.value] ?? {},
                  });
                }}
              >
                {TOOL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
            <ToolArgsFields
              toolName={toolName}
              args={toolArgs}
              onUpdate={(newArgs) => update({ args: newArgs })}
            />
            <Field label="출력 키" hint="결과를 저장할 컨텍스트 변수명">
              <input
                className={INPUT_CLS}
                value={(d.output_key as string) || "tool_result"}
                onChange={(e) => update({ output_key: e.target.value })}
              />
            </Field>
          </>
        )}

        {/* ── HumanNode ─────────────────────────────────────── */}
        {node.type === "human" && (
          <>
            <Field label="승인 질문" hint="사람에게 보여줄 질문">
              <textarea
                className={TEXTAREA_CLS}
                rows={3}
                value={(d.question as string) || ""}
                onChange={(e) => update({ question: e.target.value })}
              />
            </Field>
            <Field label="타임아웃 (분)" hint="초과 시 자동 거부 처리">
              <input
                className={INPUT_CLS}
                type="number"
                min={1}
                value={(d.timeout_minutes as number) || 60}
                onChange={(e) =>
                  update({ timeout_minutes: parseInt(e.target.value) })
                }
              />
            </Field>
          </>
        )}

        {/* ── BranchNode ────────────────────────────────────── */}
        {node.type === "branch" && (
          <>
            <Field
              label="조건식"
              hint="JavaScript 표현식. context 객체로 이전 노드 출력 참조 가능"
            >
              <input
                className={INPUT_CLS}
                value={(d.condition as string) || "true"}
                placeholder="context.score > 0.8"
                onChange={(e) => update({ condition: e.target.value })}
              />
            </Field>
            <div className="rounded-lg bg-elevated p-2.5 space-y-1">
              <p className="text-[10px] font-medium text-text-muted uppercase tracking-wide mb-1.5">
                예시 (클릭 시 적용)
              </p>
              {BRANCH_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  className="block w-full text-left text-[10px] font-mono text-accent hover:text-accent-hover transition-colors px-1 py-0.5 rounded hover:bg-hover"
                  onClick={() => update({ condition: ex })}
                >
                  {ex}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="flex items-center gap-1.5 flex-1 px-2.5 py-1.5 rounded-lg border border-success bg-success/10">
                <div className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
                <span className="text-[10px] text-success font-medium">
                  true → 위쪽 연결
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-1 px-2.5 py-1.5 rounded-lg border border-danger bg-danger/10">
                <div className="w-2 h-2 rounded-full bg-danger flex-shrink-0" />
                <span className="text-[10px] text-danger font-medium">
                  false → 아래쪽 연결
                </span>
              </div>
            </div>
          </>
        )}

        {/* ── OutputNode ────────────────────────────────────── */}
        {node.type === "output" && (
          <>
            <Field
              label="출력 컨텍스트 키"
              hint="이전 노드가 저장한 컨텍스트 변수명을 입력하세요"
            >
              <input
                className={INPUT_CLS}
                value={(d.output_key as string) || "result"}
                onChange={(e) => update({ output_key: e.target.value })}
              />
            </Field>
            <p className="text-[10px] text-text-muted leading-relaxed">
              워크플로우 완료 후 이 키의 값이 최종 출력으로 반환됩니다.
            </p>
          </>
        )}

        {/* 실행 출력 인스펙터 */}
        {d._output_data !== null &&
          typeof d._output_data === "object" &&
          Object.keys(d._output_data as Record<string, unknown>).length > 0 && (
            <div className="mt-2 pt-3 border-t border-border">
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-2">
                마지막 실행 출력
              </p>
              <pre className="text-[11px] text-text-primary bg-elevated rounded-lg px-3 py-2 whitespace-pre-wrap font-mono overflow-x-auto max-h-48 overflow-y-auto">
                {JSON.stringify(d._output_data, null, 2)}
              </pre>
            </div>
          )}
      </div>
    </aside>
  );
}
