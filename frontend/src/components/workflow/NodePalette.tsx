"use client";

import type { DragEvent } from "react";
import { Brain, GitFork, LogIn, LogOut, UserCheck, Wrench } from "lucide-react";

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

export function NodePalette() {
  function onDragStart(e: DragEvent<HTMLDivElement>, item: PaletteItem) {
    e.dataTransfer.setData(
      "application/workflow-node",
      JSON.stringify({ type: item.type, defaultData: item.defaultData }),
    );
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <aside className="w-56 flex-shrink-0 border-r border-border bg-base p-3 flex flex-col gap-1 overflow-y-auto">
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">
        노드 팔레트
      </p>
      {PALETTE_ITEMS.map((item) => (
        <div
          key={item.type}
          draggable
          onDragStart={(e) => onDragStart(e, item)}
          className="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface hover:bg-hover cursor-grab active:cursor-grabbing select-none transition-colors"
        >
          <span
            className="p-1.5 rounded-md bg-elevated flex items-center justify-center"
            style={{ color: item.iconColor }}
          >
            {item.icon}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-text-primary leading-none mb-0.5">{item.label}</p>
            <p className="text-[10px] text-text-muted leading-tight truncate">{item.description}</p>
          </div>
        </div>
      ))}
    </aside>
  );
}
