"use client";

import { type Node } from "@xyflow/react";
import { X } from "lucide-react";

interface NodeConfigPanelProps {
  node: Node | null;
  onChange: (nodeId: string, data: Record<string, unknown>) => void;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}

// 기존 Sidebar의 입력 필드 패턴과 동일
const INPUT_CLS =
  "w-full px-3 py-1.5 rounded-lg border border-border bg-elevated text-xs text-text-primary " +
  "placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors";
const TEXTAREA_CLS = INPUT_CLS + " resize-none";
const SELECT_CLS   = INPUT_CLS;

export function NodeConfigPanel({ node, onChange, onClose }: NodeConfigPanelProps) {
  if (!node) return null;

  const d = node.data as Record<string, unknown>;

  function update(patch: Record<string, unknown>) {
    onChange(node!.id, { ...d, ...patch });
  }

  return (
    <aside className="w-72 flex-shrink-0 border-l border-border bg-base flex flex-col overflow-hidden">
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
        {/* 공통: 라벨 */}
        <Field label="레이블">
          <input
            className={INPUT_CLS}
            value={(d.label as string) || ""}
            onChange={(e) => update({ label: e.target.value })}
          />
        </Field>

        {/* LLMNode */}
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
            <Field label="User Message ({{key}} 변수 가능)">
              <textarea
                className={TEXTAREA_CLS}
                rows={3}
                value={(d.user_message as string) || ""}
                onChange={(e) => update({ user_message: e.target.value })}
              />
            </Field>
            <Field label="출력 키">
              <input
                className={INPUT_CLS}
                value={(d.output_key as string) || "response"}
                onChange={(e) => update({ output_key: e.target.value })}
              />
            </Field>
            <Field label="Temperature">
              <input
                className={INPUT_CLS}
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={(d.temperature as number) ?? 0.7}
                onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
              />
            </Field>
          </>
        )}

        {/* ToolNode */}
        {node.type === "tool" && (
          <>
            <Field label="도구">
              <select
                className={SELECT_CLS}
                value={(d.tool_name as string) || "web_search"}
                onChange={(e) => update({ tool_name: e.target.value })}
              >
                <option value="web_search">web_search</option>
                <option value="execute_python">execute_python</option>
                <option value="knowledge_search">knowledge_search</option>
              </select>
            </Field>
            <Field label="쿼리 ({{key}} 변수 가능)">
              <input
                className={INPUT_CLS}
                value={((d.args as Record<string, unknown>)?.query as string) || ""}
                onChange={(e) =>
                  update({ args: { ...(d.args as object), query: e.target.value } })
                }
              />
            </Field>
            <Field label="출력 키">
              <input
                className={INPUT_CLS}
                value={(d.output_key as string) || "tool_result"}
                onChange={(e) => update({ output_key: e.target.value })}
              />
            </Field>
          </>
        )}

        {/* HumanNode */}
        {node.type === "human" && (
          <>
            <Field label="승인 질문">
              <textarea
                className={TEXTAREA_CLS}
                rows={3}
                value={(d.question as string) || ""}
                onChange={(e) => update({ question: e.target.value })}
              />
            </Field>
            <Field label="타임아웃 (분)">
              <input
                className={INPUT_CLS}
                type="number"
                min={1}
                value={(d.timeout_minutes as number) || 60}
                onChange={(e) => update({ timeout_minutes: parseInt(e.target.value) })}
              />
            </Field>
          </>
        )}

        {/* BranchNode */}
        {node.type === "branch" && (
          <>
            <Field label="조건식 (JS, context 변수 참조 가능)">
              <input
                className={INPUT_CLS}
                value={(d.condition as string) || "true"}
                placeholder="context.score > 0.8"
                onChange={(e) => update({ condition: e.target.value })}
              />
            </Field>
          </>
        )}

        {/* OutputNode */}
        {node.type === "output" && (
          <>
            <Field label="출력 컨텍스트 키">
              <input
                className={INPUT_CLS}
                value={(d.output_key as string) || "result"}
                onChange={(e) => update({ output_key: e.target.value })}
              />
            </Field>
          </>
        )}

        {node.type === "input" && (
          <p className="text-xs text-text-muted">
            워크플로우 실행 시 입력값은 context에 자동으로 주입됩니다.
          </p>
        )}
      </div>
    </aside>
  );
}
