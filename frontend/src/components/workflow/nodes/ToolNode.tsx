"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Wrench } from "lucide-react";

export interface ToolNodeData {
  label?: string;
  tool_name?: string;
  args?: Record<string, unknown>;
  output_key?: string;
  _status?: string;
}

function statusBorder(status?: string) {
  switch (status) {
    case "running":   return "border-accent animate-pulse";
    case "done":      return "border-success";
    case "failed":    return "border-danger";
    default:          return "border-border";
  }
}

const TOOL_LABELS: Record<string, string> = {
  web_search:       "Web Search",
  execute_python:   "Python",
  knowledge_search: "Knowledge",
};

export function ToolNode({ data }: NodeProps) {
  const d = data as ToolNodeData;
  const toolLabel = TOOL_LABELS[d.tool_name || ""] || d.tool_name || "Tool";
  return (
    <div className={`bg-surface rounded-lg border-2 ${statusBorder(d._status)} min-w-[180px] shadow-sm`}>
      <Handle type="target" position={Position.Left} />
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-lg"
        style={{ backgroundColor: "var(--color-node-tool-bg)" }}
      >
        <Wrench size={14} style={{ color: "var(--color-node-tool)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--color-node-tool)" }}>
          {d.label || toolLabel}
        </span>
      </div>
      <div className="px-3 py-2 text-xs text-text-muted">
        <span className="font-mono">{d.tool_name || "—"}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
