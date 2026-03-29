"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Brain } from "lucide-react";

export interface LLMNodeData {
  label?: string;
  provider?: string;
  model?: string;
  system_prompt?: string;
  user_message?: string;
  tools?: string[];
  output_key?: string;
  max_steps?: number;
  temperature?: number;
  _status?: string;
}

function statusBorder(status?: string) {
  switch (status) {
    case "running":   return "border-accent animate-pulse";
    case "done":      return "border-success";
    case "failed":    return "border-danger";
    case "suspended": return "border-warning";
    default:          return "border-border";
  }
}

export function LLMNode({ data }: NodeProps) {
  const d = data as LLMNodeData;
  return (
    <div className={`bg-surface rounded-lg border-2 ${statusBorder(d._status)} min-w-[220px] shadow-sm`}>
      <Handle type="target" position={Position.Left} />
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-lg"
        style={{ backgroundColor: "var(--color-node-llm-bg)" }}
      >
        <Brain size={14} style={{ color: "var(--color-node-llm)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--color-node-llm)" }}>
          {d.label || "LLM"}
        </span>
      </div>
      <div className="px-3 py-2 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-text-muted">Provider</span>
          <span className="text-text-primary font-medium">{d.provider || "openai"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Model</span>
          <span className="text-text-primary font-medium truncate max-w-[120px]">
            {d.model || "gpt-4o"}
          </span>
        </div>
        {d.tools && d.tools.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {d.tools.map((t) => (
              <span key={t} className="px-1.5 py-0.5 bg-elevated rounded text-text-muted text-[10px]">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
