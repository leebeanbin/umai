"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitFork } from "lucide-react";

export interface BranchNodeData {
  label?: string;
  condition?: string;
  true_targets?: string[];
  false_targets?: string[];
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

export function BranchNode({ data }: NodeProps) {
  const d = data as BranchNodeData;
  return (
    <div className={`bg-surface rounded-lg border-2 ${statusBorder(d._status)} min-w-[200px] shadow-sm`}>
      <Handle type="target" position={Position.Left} />
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-lg"
        style={{ backgroundColor: "var(--color-node-branch-bg)" }}
      >
        <GitFork size={14} style={{ color: "var(--color-node-branch)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--color-node-branch)" }}>
          {d.label || "Branch"}
        </span>
      </div>
      <div className="px-3 py-2 text-xs">
        <span className="text-text-muted">조건: </span>
        <code className="font-mono text-text-primary bg-elevated px-1 rounded">
          {d.condition || "true"}
        </code>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: "35%" }}
        className="!bg-success"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={{ top: "65%" }}
        className="!bg-danger"
      />
    </div>
  );
}
