"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { UserCheck, Check, X } from "lucide-react";
import { NodeHarness } from "./NodeHarness";

export interface HumanNodeData {
  label?: string;
  question?: string;
  timeout_minutes?: number;
  _status?: string;
  onApprove?: () => void;
  onReject?: () => void;
}

function statusBorder(status?: string) {
  switch (status) {
    case "running":   return "border-accent animate-pulse";
    case "done":      return "border-success";
    case "failed":    return "border-danger";
    case "suspended": return "border-warning animate-pulse";
    default:          return "border-border";
  }
}

export function HumanNode({ id, data, selected }: NodeProps) {
  const d = data as HumanNodeData;
  const isSuspended = d._status === "suspended";
  return (
    <NodeHarness id={id} selected={selected}>
    <div className={`bg-surface rounded-lg border-2 ${statusBorder(d._status)} min-w-[220px] shadow-sm`}>
      <Handle type="target" position={Position.Left} />
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-lg"
        style={{ backgroundColor: "var(--color-node-human-bg)" }}
      >
        <UserCheck size={14} style={{ color: "var(--color-node-human)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--color-node-human)" }}>
          {d.label || "Human Review"}
        </span>
      </div>
      <div className="px-3 py-2 space-y-2">
        <p className="text-xs text-text-primary leading-relaxed">
          {d.question || "계속 진행하시겠습니까?"}
        </p>
        {d.timeout_minutes && (
          <p className="text-[10px] text-text-muted">타임아웃: {d.timeout_minutes}분</p>
        )}
        {isSuspended && d.onApprove && d.onReject && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={d.onApprove}
              className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-success hover:opacity-90 text-white text-xs font-medium transition-opacity"
            >
              <Check size={12} /> 승인
            </button>
            <button
              onClick={d.onReject}
              className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-danger hover:opacity-90 text-white text-xs font-medium transition-opacity"
            >
              <X size={12} /> 거부
            </button>
          </div>
        )}
        {isSuspended && !d.onApprove && (
          <p className="text-[10px] text-warning font-medium">승인 대기 중...</p>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
    </NodeHarness>
  );
}
