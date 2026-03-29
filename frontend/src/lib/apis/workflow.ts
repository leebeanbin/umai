"use client";

import { apiFetch } from "@/lib/api/backendClient";
import { API } from "@/lib/api/endpoints";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface WorkflowOut {
  id: string;
  name: string;
  description: string;
  graph: { nodes: AppNode[]; edges: AppEdge[] };
  created_at: string;
  updated_at: string;
}

export interface RunStepOut {
  node_id: string;
  node_type: string;
  status: string;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
}

export interface RunOut {
  run_id: string;
  workflow_id: string;
  status: string; // running | suspended | done | failed
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  context: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
  steps: RunStepOut[];
}

// xyflow 노드/엣지 최소 타입
export interface AppNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface AppEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

// ── API 함수 ─────────────────────────────────────────────────────────────────

export async function apiCreateWorkflow(name: string, description = ""): Promise<WorkflowOut> {
  return apiFetch<WorkflowOut>(API.WORKFLOW.CREATE, {
    method: "POST",
    body: JSON.stringify({ name, description, graph: { nodes: [], edges: [] } }),
  });
}

export async function apiListWorkflows(): Promise<WorkflowOut[]> {
  return apiFetch<WorkflowOut[]>(API.WORKFLOW.LIST);
}

export async function apiGetWorkflow(id: string): Promise<WorkflowOut> {
  return apiFetch<WorkflowOut>(API.WORKFLOW.GET(id));
}

export async function apiUpdateWorkflow(
  id: string,
  patch: { name?: string; description?: string; graph?: { nodes: AppNode[]; edges: AppEdge[] } },
): Promise<WorkflowOut> {
  return apiFetch<WorkflowOut>(API.WORKFLOW.UPDATE(id), {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function apiDeleteWorkflow(id: string): Promise<void> {
  await apiFetch<void>(API.WORKFLOW.DELETE(id), { method: "DELETE" });
}

export async function apiRunWorkflow(
  id: string,
  inputs: Record<string, unknown> = {},
): Promise<RunOut> {
  return apiFetch<RunOut>(API.WORKFLOW.RUN(id), {
    method: "POST",
    body: JSON.stringify({ inputs }),
  });
}

export async function apiGetRun(runId: string): Promise<RunOut> {
  return apiFetch<RunOut>(API.WORKFLOW.RUN_STATUS(runId));
}

export async function apiResumeRun(
  runId: string,
  approved: boolean,
  note = "",
): Promise<RunOut> {
  return apiFetch<RunOut>(API.WORKFLOW.RESUME(runId), {
    method: "POST",
    body: JSON.stringify({ approved, note }),
  });
}
