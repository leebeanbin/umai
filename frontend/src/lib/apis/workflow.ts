// Re-export from backendClient so all workflow API calls share the same
// authenticated fetch instance (apiFetch) and token store.
export type {
  WorkflowOut,
  RunStepOut,
  RunOut,
  RunListItem,
  WorkflowStats,
  AppNode,
  AppEdge,
} from "@/lib/api/backendClient";

export {
  apiCreateWorkflow,
  apiListWorkflows,
  apiGetWorkflow,
  apiUpdateWorkflow,
  apiDeleteWorkflow,
  apiRunWorkflow,
  apiGetRun,
  apiResumeRun,
  apiListRuns,
  apiCancelRun,
  apiGetStats,
} from "@/lib/api/backendClient";
