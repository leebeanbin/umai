"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitFork } from "lucide-react";
import { NodeHarness } from "./NodeHarness";

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

export function BranchNode({ id, data, selected }: NodeProps) {
  const d = data as BranchNodeData;
  return (
    <NodeHarness id={id} selected={selected}>
    <div className={`bg-surface rounded-lg border-2 ${statusBorder(d._status)} min-w-[210px] shadow-sm`}>
      <Handle type="target" position={Position.Left} />
      {/* 헤더 */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-lg"
        style={{ backgroundColor: "var(--color-node-branch-bg)" }}
      >
        <GitFork size={14} style={{ color: "var(--color-node-branch)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--color-node-branch)" }}>
          {d.label || "Branch"}
        </span>
      </div>
      {/* 조건식 */}
      <div className="px-3 pt-2 pb-1 text-xs">
        <span className="text-text-muted text-[10px]">조건: </span>
        <code className="font-mono text-text-primary bg-elevated px-1.5 py-0.5 rounded text-[10px] break-all">
          {d.condition || "true"}
        </code>
      </div>
      {/* 출력 행 — 핸들 위치에 맞춘 레이블 */}
      <div className="px-3 pb-2 space-y-1">
        <div className="flex items-center gap-1.5 py-1">
          <div className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
          <span className="text-[10px] font-semibold text-success flex-1">true</span>
        </div>
        <div className="flex items-center gap-1.5 py-1">
          <div className="w-2 h-2 rounded-full bg-danger flex-shrink-0" />
          <span className="text-[10px] font-semibold text-danger flex-1">false</span>
        </div>
      </div>
      {/* true / false 핸들 — 출력 행 중앙에 정렬 */}
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: "66%" }}
        className="!bg-success"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={{ top: "84%" }}
        className="!bg-danger"
      />
    </div>
    </NodeHarness>
  );
}
