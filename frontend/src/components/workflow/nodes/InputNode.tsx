"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { LogIn } from "lucide-react";
import { NodeHarness } from "./NodeHarness";

export interface InputNodeData {
  label?: string;
  fields?: { key: string; type: string }[];
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

export function InputNode({ id, data, selected }: NodeProps) {
  const d = data as InputNodeData;
  return (
    <NodeHarness id={id} selected={selected}>
    <div className={`bg-surface rounded-lg border-2 ${statusBorder(d._status)} min-w-[180px] shadow-sm`}>
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-lg"
        style={{ backgroundColor: "var(--color-node-input-bg)" }}
      >
        <LogIn size={14} style={{ color: "var(--color-node-input)" }} />
        <span
          className="text-xs font-semibold"
          style={{ color: "var(--color-node-input)" }}
        >
          {d.label || "Input"}
        </span>
      </div>
      <div className="px-3 py-2 space-y-1">
        {(d.fields || []).map((f, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-primary font-mono">{f.key || <em className="text-text-muted">unnamed</em>}</span>
            <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-elevated">{f.type}</span>
          </div>
        ))}
        {(!d.fields || d.fields.length === 0) && (
          <p className="text-[10px] text-text-muted italic leading-tight">
            클릭하여 입력 필드를 추가하세요
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
    </NodeHarness>
  );
}
