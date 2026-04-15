import { apiFetch } from "./backendClient";

const BASE = "/api/v1/fine-tune";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DatasetOut = {
  id: string;
  name: string;
  description: string;
  format: "chat" | "instruction" | "completion";
  example_count: number;
  created_at: string;
};

export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export type JobMetrics = {
  steps: number[];
  train_loss: number[];
  val_loss: number[];
  learning_rate: number[];
};

export type JobOut = {
  id: string;
  name: string;
  dataset_id: string | null;
  base_model: string;
  method: "lora" | "qlora" | "full";
  config: {
    lora_rank: number;
    lora_alpha: number;
    epochs: number;
    learning_rate: number;
    batch_size: number;
    max_seq_length: number;
    warmup_ratio: number;
  };
  status: JobStatus;
  progress: number;
  current_step: number;
  total_steps: number;
  metrics: JobMetrics;
  output_model_name: string | null;
  error_message: string | null;
  logs: string[];
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type SupportedModel = {
  id: string;
  name: string;
  family: string;
  size: string;
  vram: string;
};

// ── Dataset API ───────────────────────────────────────────────────────────────

export async function apiListDatasets(): Promise<DatasetOut[]> {
  return apiFetch<DatasetOut[]>(`${BASE}/datasets`);
}

export async function apiCreateDataset(body: {
  name: string;
  description?: string;
  format: string;
  raw_data: string;
}): Promise<DatasetOut> {
  return apiFetch<DatasetOut>(`${BASE}/datasets`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function apiDeleteDataset(id: string): Promise<void> {
  await apiFetch<void>(`${BASE}/datasets/${id}`, { method: "DELETE" });
}

// ── Job API ───────────────────────────────────────────────────────────────────

export async function apiListJobs(): Promise<JobOut[]> {
  return apiFetch<JobOut[]>(`${BASE}/jobs`);
}

export async function apiGetJob(id: string): Promise<JobOut> {
  return apiFetch<JobOut>(`${BASE}/jobs/${id}`);
}

export async function apiCreateJob(body: {
  name: string;
  dataset_id: string;
  base_model: string;
  method: string;
  lora_rank: number;
  lora_alpha: number;
  epochs: number;
  learning_rate: number;
  batch_size: number;
  max_seq_length: number;
  warmup_ratio: number;
  output_model_name?: string;
}): Promise<JobOut> {
  return apiFetch<JobOut>(`${BASE}/jobs`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function apiCancelJob(id: string): Promise<JobOut> {
  return apiFetch<JobOut>(`${BASE}/jobs/${id}/cancel`, { method: "POST" });
}

export async function apiListSupportedModels(): Promise<SupportedModel[]> {
  return apiFetch<SupportedModel[]>(`${BASE}/models`);
}
