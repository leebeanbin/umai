"use client";

import { useState, type DragEvent } from "react";
import { Brain, GitFork, LogIn, LogOut, UserCheck, Wrench, Zap } from "lucide-react";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "./workflowTemplates";
import type { Node, Edge } from "@xyflow/react";

// ── 팔레트 아이템 정의 ────────────────────────────────────────────────────────

interface PaletteItem {
  type: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  iconColor: string;
  defaultData: Record<string, unknown>;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: "input",
    label: "Input",
    description: "워크플로우 시작 입력",
    icon: <LogIn size={14} />,
    iconColor: "var(--color-node-input)",
    defaultData: { label: "Input", fields: [] },
  },
  {
    type: "llm",
    label: "LLM",
    description: "언어 모델 호출",
    icon: <Brain size={14} />,
    iconColor: "var(--color-node-llm)",
    defaultData: {
      label: "LLM",
      provider: "openai",
      model: "gpt-4o",
      system_prompt: "You are a helpful assistant.",
      user_message: "{{user_input}}",
      tools: [],
      output_key: "response",
      temperature: 0.7,
      max_steps: 10,
    },
  },
  {
    type: "tool",
    label: "Tool",
    description: "웹 검색 / 코드 실행 / 지식 검색",
    icon: <Wrench size={14} />,
    iconColor: "var(--color-node-tool)",
    defaultData: {
      label: "Tool",
      tool_name: "web_search",
      args: { query: "{{user_input}}" },
      output_key: "search_result",
    },
  },
  {
    type: "human",
    label: "Human Review",
    description: "사람 승인 대기",
    icon: <UserCheck size={14} />,
    iconColor: "var(--color-node-human)",
    defaultData: {
      label: "Human Review",
      question: "계속 진행하시겠습니까?",
      timeout_minutes: 60,
    },
  },
  {
    type: "branch",
    label: "Branch",
    description: "조건 분기",
    icon: <GitFork size={14} />,
    iconColor: "var(--color-node-branch)",
    defaultData: {
      label: "Branch",
      condition: "context.score > 0.8",
      true_targets: [],
      false_targets: [],
    },
  },
  {
    type: "output",
    label: "Output",
    description: "워크플로우 최종 결과",
    icon: <LogOut size={14} />,
    iconColor: "var(--color-node-output)",
    defaultData: { label: "Output", output_key: "result" },
  },
];

// ── NodePalette ───────────────────────────────────────────────────────────────

interface NodePaletteProps {
  onLoadTemplate?: (nodes: Node[], edges: Edge[]) => void;
}

export function NodePalette({ onLoadTemplate }: NodePaletteProps) {
  const [tab, setTab] = useState<"nodes" | "templates">("nodes");
  const [previewId, setPreviewId] = useState<string | null>(null);

  function onDragStart(e: DragEvent<HTMLDivElement>, item: PaletteItem) {
    e.dataTransfer.setData(
      "application/workflow-node",
      JSON.stringify({ type: item.type, defaultData: item.defaultData }),
    );
    e.dataTransfer.effectAllowed = "copy";
  }

  function handleLoadTemplate(template: WorkflowTemplate) {
    if (!onLoadTemplate) return;
    onLoadTemplate(template.nodes as Node[], template.edges as Edge[]);
    setPreviewId(null);
  }

  const previewing = WORKFLOW_TEMPLATES.find((t) => t.id === previewId);

  return (
    <aside className="w-56 flex-shrink-0 border-r border-border bg-base flex flex-col overflow-hidden">
      {/* 탭 */}
      <div className="flex border-b border-border flex-shrink-0">
        {(["nodes", "templates"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "flex-1 py-2 text-[11px] font-semibold transition-colors " +
              (tab === t
                ? "text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-primary")
            }
          >
            {t === "nodes" ? "노드" : "템플릿"}
          </button>
        ))}
      </div>

      {/* ── 노드 팔레트 ─────────────────────────────────────────────────── */}
      {tab === "nodes" && (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">
            드래그하여 추가
          </p>
          {PALETTE_ITEMS.map((item) => (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => onDragStart(e, item)}
              className="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface hover:bg-hover cursor-grab active:cursor-grabbing select-none transition-colors"
            >
              <span
                className="p-1.5 rounded-md bg-elevated flex items-center justify-center flex-shrink-0"
                style={{ color: item.iconColor }}
              >
                {item.icon}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-primary leading-none mb-0.5">
                  {item.label}
                </p>
                <p className="text-[10px] text-text-muted leading-tight truncate">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 템플릿 ──────────────────────────────────────────────────────── */}
      {tab === "templates" && !previewing && (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">
            예시 워크플로우
          </p>
          {WORKFLOW_TEMPLATES.map((tmpl) => (
            <div
              key={tmpl.id}
              className="rounded-lg border border-border bg-surface p-2.5 flex flex-col gap-1.5 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{tmpl.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-semibold text-text-primary leading-none">
                      {tmpl.name}
                    </span>
                    {tmpl.advanced && (
                      <Zap size={10} className="text-accent flex-shrink-0" />
                    )}
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-text-muted leading-tight">
                {tmpl.description}
              </p>
              <div className="flex gap-1.5 pt-0.5">
                <button
                  onClick={() => setPreviewId(tmpl.id)}
                  className="flex-1 text-[10px] py-1 rounded border border-border hover:bg-hover text-text-muted transition-colors"
                >
                  미리보기
                </button>
                <button
                  onClick={() => handleLoadTemplate(tmpl)}
                  className="flex-1 text-[10px] py-1 rounded bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
                >
                  로드
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 템플릿 미리보기 ─────────────────────────────────────────────── */}
      {tab === "templates" && previewing && (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          <button
            onClick={() => setPreviewId(null)}
            className="text-[11px] text-text-muted hover:text-text-primary transition-colors text-left"
          >
            ← 목록으로
          </button>

          <div className="flex items-center gap-2">
            <span className="text-xl">{previewing.emoji}</span>
            <div>
              <p className="text-sm font-semibold text-text-primary">{previewing.name}</p>
              <p className="text-[10px] text-text-muted">{previewing.description}</p>
            </div>
          </div>

          {/* 노드 목록 미리보기 */}
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">
              포함 노드 ({previewing.nodes.length}개)
            </p>
            {previewing.nodes.map((n) => {
              const item = PALETTE_ITEMS.find((p) => p.type === n.type);
              const label = (n.data as Record<string, unknown>).label as string;
              return (
                <div
                  key={n.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-elevated"
                >
                  {item && (
                    <span style={{ color: item.iconColor }}>{item.icon}</span>
                  )}
                  <span className="text-[11px] text-text-primary font-medium">{label}</span>
                  <span className="text-[10px] text-text-muted ml-auto capitalize">{n.type}</span>
                </div>
              );
            })}
          </div>

          {/* 연결 수 */}
          <p className="text-[10px] text-text-muted">
            연결: {previewing.edges.length}개 엣지
            {previewing.advanced && (
              <span className="ml-1.5 text-accent font-medium">⚡ 병렬 실행 포함</span>
            )}
          </p>

          <button
            onClick={() => handleLoadTemplate(previewing)}
            className="w-full py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors"
          >
            캔버스에 로드
          </button>
        </div>
      )}
    </aside>
  );
}
