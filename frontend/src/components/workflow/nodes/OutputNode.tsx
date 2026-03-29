"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { LogOut } from "lucide-react";

export interface OutputNodeData {
  label?: string;
  output_key?: string;
  _status?: string;
}

function statusBorder(status?: string) {
  switch (status) {
    case "running":  return "border-accent animate-pulse";
    case "done":     return "border-success";
    case "failed":   return "border-danger";
    default:         return "border-border";
  }
}

export function OutputNode({ data }: NodeProps) {
  const d = data as OutputNodeData;
  return (
    <div className={`bg-surface rounded-lg border-2 ${statusBorder(d._status)} min-w-[180px] shadow-sm`}>
      <Handle type="target" position={Position.Left} />
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-lg"
        style={{ backgroundColor: "var(--color-node-output-bg)" }}
      >
        <LogOut size={14} style={{ color: "var(--color-node-output)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--color-node-output)" }}>
          {d.label || "Output"}
        </span>
      </div>
      <div className="px-3 py-2 text-xs text-text-muted">
        Key: <code className="font-mono text-text-primary">{d.output_key || "result"}</code>
      </div>
    </div>
  );
}
