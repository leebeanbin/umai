"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { useParams } from "next/navigation";
import {
  ReactFlow,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Connection,
  type Node,
  type Edge,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { NodePalette } from "@/components/workflow/NodePalette";
import { NodeConfigPanel } from "@/components/workflow/NodeConfigPanel";
import { InputNode }  from "@/components/workflow/nodes/InputNode";
import { LLMNode }    from "@/components/workflow/nodes/LLMNode";
import { ToolNode }   from "@/components/workflow/nodes/ToolNode";
import { HumanNode }  from "@/components/workflow/nodes/HumanNode";
import { BranchNode } from "@/components/workflow/nodes/BranchNode";
import { OutputNode } from "@/components/workflow/nodes/OutputNode";
import {
  apiGetWorkflow,
  apiUpdateWorkflow,
  apiRunWorkflow,
  apiGetRun,
  apiResumeRun,
  type RunOut,
  type AppNode,
  type AppEdge,
} from "@/lib/api/backendClient";
// useWorkflowSocket: task:{user_id} 채널의 모든 이벤트 수신
// (useTaskSocket은 task_done 만 필터링하므로 workflow_* 이벤트 수신 불가)
import { useWorkflowSocket } from "@/lib/hooks/useWebSocket";
import { useRouter } from "next/navigation";
import { Play, Save, Loader2, CheckCircle2, XCircle, PauseCircle, History, X } from "lucide-react";

// ── 노드 타입 등록 ────────────────────────────────────────────────────────────

const NODE_TYPES = {
  input:  InputNode,
  llm:    LLMNode,
  tool:   ToolNode,
  human:  HumanNode,
  branch: BranchNode,
  output: OutputNode,
} as const;

// ── ID 생성 ───────────────────────────────────────────────────────────────────

function newNodeId(type: string) {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── 실행 상태 배지 ────────────────────────────────────────────────────────────

function RunStatusBadge({ run }: { run: RunOut | null }) {
  const { t } = useLanguage();
  if (!run) return null;
  const map: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    running:   { icon: <Loader2 size={12} className="animate-spin" />, label: t("workflow.status.running"),   cls: "text-accent" },
    suspended: { icon: <PauseCircle size={12} />,                      label: t("workflow.status.suspended"), cls: "text-warning" },
    done:      { icon: <CheckCircle2 size={12} />,                     label: t("workflow.status.done"),      cls: "text-success" },
    failed:    { icon: <XCircle size={12} />,                          label: t("workflow.status.failed"),    cls: "text-danger"  },
  };
  const info = map[run.status] ?? { icon: null, label: run.status, cls: "text-text-muted" };
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${info.cls}`}>
      {info.icon} {info.label}
    </span>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function WorkflowCanvas({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [workflowName, setWorkflowName] = useState("New Workflow");
  const [run, setRun] = useState<RunOut | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  // run input modal
  const [runModal, setRunModal] = useState<{ fields: { key: string; type: string }[] } | null>(null);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // unmount 시 pending 타이머 정리 — "state update on unmounted component" 방지
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);
  // run을 ref로도 유지 — WS 콜백 클로저 내에서 최신값 참조
  const runRef = useRef<RunOut | null>(null);
  useEffect(() => { runRef.current = run; }, [run]);

  const { user, loading: authLoading } = useAuth();

  // ── 로드 ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading || !user) return;
    apiGetWorkflow(workflowId).then((wf) => {
      setWorkflowName(wf.name);
      if (wf.graph?.nodes) setNodes(wf.graph.nodes as Node[]);
      if (wf.graph?.edges) setEdges(wf.graph.edges as Edge[]);
    }).catch(() => {});
  }, [workflowId, user, authLoading, setNodes, setEdges]);

  // ── 자동 저장 (debounce 1.5초) ────────────────────────────────────────────
  const debounceSave = useCallback(
    (newNodes: Node[], newEdges: typeof edges) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        setSaving(true);
        try {
          await apiUpdateWorkflow(workflowId, {
            graph: { nodes: newNodes as AppNode[], edges: newEdges as AppEdge[] },
          });
        } finally {
          if (mountedRef.current) setSaving(false);
        }
      }, 1500);
    },
    [workflowId],
  );

  // ── 연결 ──────────────────────────────────────────────────────────────────
  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdges = addEdge(connection, edges);
      setEdges(newEdges);
      debounceSave(nodes, newEdges);
    },
    [edges, nodes, setEdges, debounceSave],
  );

  // ── 드롭 (팔레트 → 캔버스) ───────────────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/workflow-node");
      if (!raw) return;
      const { type, defaultData } = JSON.parse(raw) as {
        type: string;
        defaultData: Record<string, unknown>;
      };
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      const position = bounds
        ? { x: e.clientX - bounds.left - 80, y: e.clientY - bounds.top - 40 }
        : { x: 100, y: 100 };

      const newNode: Node = { id: newNodeId(type), type, position, data: { ...defaultData } };
      const newNodes = [...nodes, newNode];
      setNodes(newNodes);
      debounceSave(newNodes, edges);
    },
    [nodes, edges, setNodes, debounceSave],
  );

  // ── 노드 데이터 변경 (설정 패널) ─────────────────────────────────────────
  const onNodeDataChange = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      const newNodes = nodes.map((n) =>
        n.id === nodeId ? { ...n, data: newData } : n,
      );
      setNodes(newNodes);
      setSelectedNode((prev) => (prev?.id === nodeId ? { ...prev, data: newData } : prev));
      debounceSave(newNodes, edges);
    },
    [nodes, edges, setNodes, debounceSave],
  );

  // ── Human 승인/거부 ───────────────────────────────────────────────────────
  const handleResume = useCallback(
    async (runId: string, approved: boolean) => {
      try {
        const updated = await apiResumeRun(runId, approved);
        setRun(updated);
      } catch (err) {
        console.error("Resume failed", err);
      }
    },
    [],
  );

  // ── 노드 상태 업데이트 헬퍼 ───────────────────────────────────────────────
  const applyRunToNodes = useCallback(
    (latest: RunOut) => {
      setNodes((prev) =>
        prev.map((n) => {
          const step = latest.steps.find((s) => s.node_id === n.id);
          if (!step) return n;
          // Optimistic: 현재 이미 이 status면 리렌더 방지
          if ((n.data as Record<string, unknown>)._status === step.status && step.status !== "suspended") return n;
          return {
            ...n,
            data: {
              ...n.data,
              _status: step.status,
              // 완료된 노드의 출력 데이터 주입 → NodeConfigPanel에서 인스펙터로 표시
              _output_data: step.output_data,
              // HumanNode suspended → 승인/거부 콜백을 fresh 참조로 주입
              ...(step.status === "suspended" && n.type === "human"
                ? {
                    onApprove: () => handleResume(latest.run_id, true),
                    onReject:  () => handleResume(latest.run_id, false),
                  }
                : { onApprove: undefined, onReject: undefined }),
            },
          };
        }),
      );
    },
    [setNodes, handleResume],
  );

  // ── WebSocket: 실행 이벤트 수신 ──────────────────────────────────────────
  // useWorkflowSocket 사용 — task:{user_id} 채널의 모든 이벤트를 그대로 수신
  // (useTaskSocket은 event.type === "task_done" 만 콜백으로 전달하므로 부적합)
  const handleWsEvent = useCallback(
    async (event: Record<string, unknown> & { type: string }) => {
      if (!["workflow_step_done", "workflow_suspended", "workflow_done", "workflow_failed"]
        .includes(event.type)) return;

      // run이 null이면 event.run_id로 로드 (첫 이벤트가 run 설정 전에 도착하는 경쟁 조건 방어)
      const targetRunId = (event.run_id as string | undefined) ?? runRef.current?.run_id;
      if (!targetRunId) return;
      if (runRef.current && event.run_id !== runRef.current.run_id) return;

      // Optimistic: step_done이면 해당 노드만 먼저 done으로 표시 (폴링 지연 중 깜빡임 방지)
      if (event.type === "workflow_step_done" && event.node_id) {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === (event.node_id as string)
              ? { ...n, data: { ...n.data, _status: "done" } }
              : n,
          ),
        );
      }

      // 실패 이벤트: 에러 메시지 표시
      if (event.type === "workflow_failed" && event.error) {
        const nodeLabel = event.node_id ? ` (노드: ${event.node_id})` : "";
        setRunError(`실행 실패${nodeLabel}: ${event.error as string}`);
      }

      // 최신 실행 상태 fetch → 전체 동기화
      try {
        const latest = await apiGetRun(targetRunId);
        setRun(latest);
        applyRunToNodes(latest);
      } catch {
        /* 폴링 실패는 무시 — 다음 이벤트에서 재시도 */
      }
    },
    [setNodes, applyRunToNodes],
  );

  useWorkflowSocket(handleWsEvent);

  // ── 실행 (내부) ──────────────────────────────────────────────────────────
  const doRun = useCallback(
    async (inputs: Record<string, unknown>) => {
      setRunning(true);
      setRunError(null);
      setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, _status: undefined } })));
      try {
        const runOut = await apiRunWorkflow(workflowId, inputs);
        setRun(runOut);
      } catch (err) {
        console.error("Run failed", err);
      } finally {
        setRunning(false);
      }
    },
    [workflowId, setNodes],
  );

  // ── 실행 버튼 클릭 — InputNode 필드가 있으면 입력 모달 표시 ──────────────
  const handleRun = useCallback(() => {
    const inputNode = nodes.find((n) => n.type === "input");
    const fields = (inputNode?.data?.fields as { key: string; type: string }[]) || [];
    if (fields.length > 0) {
      // 이전 값을 기본으로 유지하면서 모달 열기
      setRunInputs((prev) => {
        const defaults: Record<string, string> = {};
        for (const f of fields) {
          defaults[f.key] = prev[f.key] ?? "";
        }
        return defaults;
      });
      setRunModal({ fields });
    } else {
      doRun({});
    }
  }, [nodes, doRun]);

  // ── 템플릿 로드 ──────────────────────────────────────────────────────────
  const handleLoadTemplate = useCallback(
    (templateNodes: Node[], templateEdges: Edge[]) => {
      if (
        nodes.length > 0 &&
        !window.confirm(t("workflow.confirmClear"))
      ) {
        return;
      }
      // 기존 노드 ID → 새 ID 매핑 (충돌 방지)
      const idMap: Record<string, string> = {};
      const newNodes = templateNodes.map((n) => {
        const newId = `${n.type ?? "node"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        idMap[n.id] = newId;
        return { ...n, id: newId, selected: false } as Node;
      });
      const newEdges = templateEdges.map((e) => ({
        ...e,
        id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source: idMap[e.source] ?? e.source,
        target: idMap[e.target] ?? e.target,
      })) as Edge[];
      setNodes(newNodes);
      setEdges(newEdges);
      setSelectedNode(null);
      debounceSave(newNodes, newEdges);
    },
    [nodes.length, setNodes, setEdges, debounceSave],
  );

  // ── 수동 저장 버튼 ────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await apiUpdateWorkflow(workflowId, {
        name: workflowName,
        graph: { nodes: nodes as AppNode[], edges: edges as AppEdge[] },
      });
    } finally {
      setSaving(false);
    }
  }, [workflowId, workflowName, nodes, edges]);

  const INPUT_CLS =
    "w-full px-3 py-2 rounded-lg border border-border bg-elevated text-sm text-text-primary " +
    "placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors";

  return (
    <div className="flex h-full bg-base overflow-hidden">
      {/* 실행 입력 모달 */}
      {runModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <span className="text-sm font-semibold text-text-primary">{t("workflow.runInputTitle")}</span>
              <button
                onClick={() => setRunModal(null)}
                className="p-1 rounded hover:bg-hover text-text-muted transition-colors"
              >
                <X size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {runModal.fields.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-text-muted uppercase tracking-wide">
                    {f.key}
                    <span className="ml-1.5 font-normal normal-case text-text-muted opacity-60">
                      ({f.type})
                    </span>
                  </label>
                  {f.type === "text" ? (
                    <textarea
                      className={INPUT_CLS + " resize-none"}
                      rows={3}
                      value={runInputs[f.key] ?? ""}
                      onChange={(e) =>
                        setRunInputs((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <input
                      className={INPUT_CLS}
                      type={f.type === "number" ? "number" : f.type === "boolean" ? "text" : "text"}
                      placeholder={f.type === "boolean" ? "true / false" : ""}
                      value={runInputs[f.key] ?? ""}
                      onChange={(e) =>
                        setRunInputs((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button
                onClick={() => setRunModal(null)}
                className="px-4 py-1.5 rounded-lg border border-border hover:bg-hover text-sm text-text-primary transition-colors"
              >
                {t("workflow.cancel")}
              </button>
              <button
                onClick={() => {
                  setRunModal(null);
                  // 타입 변환: number/boolean 필드를 적절히 파싱
                  const parsed: Record<string, unknown> = {};
                  for (const f of runModal.fields) {
                    const raw = runInputs[f.key] ?? "";
                    if (f.type === "number") parsed[f.key] = Number(raw);
                    else if (f.type === "boolean") parsed[f.key] = raw.toLowerCase() === "true";
                    else parsed[f.key] = raw;
                  }
                  doRun(parsed);
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
              >
                <Play size={13} /> {t("workflow.run")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 왼쪽: 노드 팔레트 */}
      <NodePalette onLoadTemplate={handleLoadTemplate} />

      {/* 중앙: ReactFlow 캔버스 */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* 상단 툴바 */}
        <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-base flex-shrink-0">
          <input
            className="flex-1 min-w-0 text-sm font-semibold text-text-primary bg-transparent focus:outline-none"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            onBlur={handleSave}
          />
          {saving && <span className="text-[11px] text-text-muted">저장 중...</span>}
          <RunStatusBadge run={run} />
          <button
            onClick={() => router.push(`/workflow/${workflowId}/runs`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border hover:bg-hover text-xs font-medium text-text-primary transition-colors"
          >
            <History size={13} /> 기록
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border hover:bg-hover text-xs font-medium text-text-primary transition-colors"
          >
            <Save size={13} /> 저장
          </button>
          <button
            onClick={handleRun}
            disabled={running || run?.status === "running"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-medium transition-colors"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            실행
          </button>
        </header>

        {/* 실행 에러 배너 */}
        {runError && (
          <div className="mx-4 mt-2 flex items-start justify-between gap-2 px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs">
            <span className="flex-1">{runError}</span>
            <button onClick={() => setRunError(null)} className="flex-shrink-0 hover:opacity-70">✕</button>
          </div>
        )}

        {/* ReactFlow */}
        <div ref={reactFlowWrapper} className="flex-1 min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              if (changes.some((c) => c.type === "position" && c.dragging === false)) {
                debounceSave(nodes, edges);
              }
            }}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={(_, node) => setSelectedNode(node)}
            onPaneClick={() => setSelectedNode(null)}
            onNodesDelete={(deleted) => {
              // 삭제된 노드가 현재 선택 패널에 열려 있으면 닫기
              if (deleted.some((n) => n.id === selectedNode?.id)) {
                setSelectedNode(null);
              }
            }}
            fitView
            deleteKeyCode={["Delete", "Backspace"]}
          >
            <Background gap={16} size={1} />
            <Controls />
            <MiniMap nodeStrokeWidth={2} pannable zoomable />
          </ReactFlow>
        </div>

        {/* 하단: 출력 결과 패널 */}
        {run?.status === "done" && Object.keys(run.outputs).length > 0 && (
          <div className="border-t border-border bg-surface p-3 max-h-40 overflow-y-auto flex-shrink-0">
            <p className="text-[11px] font-semibold text-text-muted uppercase mb-2">실행 결과</p>
            <pre className="text-xs text-text-primary whitespace-pre-wrap">
              {JSON.stringify(run.outputs, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* 오른쪽: 노드 설정 패널 */}
      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onChange={onNodeDataChange}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

export default function WorkflowPage() {
  const params = useParams();
  const workflowId = params?.id as string;
  if (!workflowId) return null;

  return (
    <ReactFlowProvider>
      <WorkflowCanvas workflowId={workflowId} />
    </ReactFlowProvider>
  );
}
