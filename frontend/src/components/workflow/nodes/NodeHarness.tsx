"use client";

import { useCallback } from "react";
import { NodeToolbar, Position, useReactFlow } from "@xyflow/react";
import { Trash2, Copy } from "lucide-react";

interface NodeHarnessProps {
  id: string;
  type?: string;
  selected?: boolean;
  children: React.ReactNode;
}

/**
 * Harness 패턴 — 모든 커스텀 노드를 감싸는 공통 래퍼.
 *
 * 노드가 선택(selected)되면 오른쪽 상단에 툴바가 나타나며:
 *  - 복제 (Copy)  : 같은 위치에서 30px 오프셋으로 새 노드 추가
 *  - 삭제 (Trash) : deleteElements()로 노드 + 연결된 엣지 함께 제거
 *
 * 키보드 단축키 (ReactFlow 기본):
 *  - Backspace / Delete : 선택된 노드·엣지 삭제
 */
export function NodeHarness({ id, type, selected, children }: NodeHarnessProps) {
  const { deleteElements, getNode, addNodes } = useReactFlow();

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] });
  }, [deleteElements, id]);

  const handleDuplicate = useCallback(() => {
    const node = getNode(id);
    if (!node) return;
    const newId = `${node.type ?? "node"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    addNodes({
      ...node,
      id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      selected: false,
    });
  }, [getNode, addNodes, id]);

  return (
    <>
      {/* 선택 시에만 표시되는 액션 툴바 */}
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        align="end"
        offset={6}
      >
        <div className="flex gap-0.5 bg-surface border border-border rounded-lg shadow-lg px-1.5 py-1">
          <button
            onPointerDown={(e) => e.stopPropagation()} // drag 방지
            onClick={handleDuplicate}
            className="p-1.5 rounded hover:bg-hover text-text-muted hover:text-accent transition-colors"
            title="복제 (Ctrl+D)"
          >
            <Copy size={12} />
          </button>
          <div className="w-px bg-border mx-0.5" />
          <button
            onPointerDown={(e) => e.stopPropagation()} // drag 방지
            onClick={handleDelete}
            className="p-1.5 rounded hover:bg-hover text-text-muted hover:text-danger transition-colors"
            title="삭제 (Backspace)"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      {children}
    </>
  );
}
