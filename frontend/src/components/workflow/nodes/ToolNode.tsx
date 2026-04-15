"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Wrench } from "lucide-react";
import { NodeHarness } from "./NodeHarness";

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

/** 도구별 핵심 인자 미리보기 텍스트 */
function argPreview(toolName: string, args: Record<string, unknown>): string | null {
  if (toolName === "web_search" || toolName === "knowledge_search") {
    return (args.query as string) || null;
  }
  if (toolName === "execute_python") {
    const code = (args.code as string) || "";
    const firstLine = code.split("\n")[0];
    return firstLine ? firstLine.slice(0, 40) : null;
  }
  return null;
}

export function ToolNode({ id, data, selected }: NodeProps) {
  const d = data as ToolNodeData;
  const toolName  = d.tool_name || "web_search";
  const toolLabel = d.label || TOOL_LABELS[toolName] || toolName;
  const preview   = argPreview(toolName, d.args || {});

  return (
    <NodeHarness id={id} selected={selected}>
    <div className={`bg-surface rounded-lg border-2 ${statusBorder(d._status)} min-w-[190px] shadow-sm`}>
      <Handle type="target" position={Position.Left} />
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-lg"
        style={{ backgroundColor: "var(--color-node-tool-bg)" }}
      >
        <Wrench size={14} style={{ color: "var(--color-node-tool)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--color-node-tool)" }}>
          {toolLabel}
        </span>
      </div>
      <div className="px-3 py-2 space-y-1 text-xs">
        <span className="font-mono text-text-muted text-[10px] bg-elevated px-1.5 py-0.5 rounded">
          {toolName}
        </span>
        {preview && (
          <p className="text-text-primary truncate max-w-[160px] text-[10px] mt-0.5">
            {preview}
          </p>
        )}
        {d.output_key && (
          <p className="text-[10px] text-text-muted">
            → <code className="font-mono">{d.output_key}</code>
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
    </NodeHarness>
  );
}
