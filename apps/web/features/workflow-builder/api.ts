import { useQuery } from "@tanstack/react-query";
import type {
  RunDetail,
  WorkflowDetail,
  WorkflowGraph,
  WorkflowSummary,
} from "@agentik/workflow-schema";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";

export function createWorkflow(team: string, name: string): Promise<WorkflowSummary> {
  return apiFetch<WorkflowSummary>("/workflows", { method: "POST", team, body: { name } });
}

export function saveVersion(
  team: string,
  workflowId: string,
  body: { graph: WorkflowGraph; name?: string; active?: boolean },
): Promise<WorkflowDetail> {
  return apiFetch<WorkflowDetail>(`/workflows/${workflowId}/versions`, {
    method: "PUT",
    team,
    body,
  });
}

export function startRun(
  team: string,
  workflowId: string,
  payload?: unknown,
): Promise<RunDetail> {
  return apiFetch<RunDetail>(`/workflows/${workflowId}/run`, {
    method: "POST",
    team,
    body: { payload },
  });
}

export function fetchWorkflows(team: string): Promise<{ items: WorkflowSummary[] }> {
  return apiFetch<{ items: WorkflowSummary[] }>("/workflows", { team });
}

export function fetchWorkflow(team: string, id: string): Promise<WorkflowDetail> {
  return apiFetch<WorkflowDetail>(`/workflows/${id}`, { team });
}

/**
 * Subscribe to live run status via SSE. Returns an unsubscribe function.
 * EventSource can't send headers, but the engine's stream endpoint reads a run
 * by id without team enforcement, so no `x-team` is needed. The path is `/live`
 * (not `/stream`) to avoid the mock `/runs/:id/stream` route handler that
 * apps/web ships for the run-view demo; `/live` bypasses to the engine.
 */
export function subscribeRun(
  runId: string,
  handlers: { onRun: (run: RunDetail) => void; onError?: (err: unknown) => void; onClose?: () => void },
): () => void {
  const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
  const source = new EventSource(`/api/v1/runs/${runId}/live`);

  source.addEventListener("run", (ev) => {
    try {
      const run = JSON.parse((ev as MessageEvent).data) as RunDetail;
      handlers.onRun(run);
      if (TERMINAL.has(run.status)) {
        source.close();
        handlers.onClose?.();
      }
    } catch (err) {
      handlers.onError?.(err);
    }
  });

  source.addEventListener("error", (ev) => {
    // Network drop or server "error" event — stop and let the caller settle.
    handlers.onError?.(ev);
    source.close();
    handlers.onClose?.();
  });

  return () => source.close();
}

export function useWorkflows(team: string) {
  return useQuery({
    queryKey: qk.workflows.list(team),
    queryFn: ({ signal }) =>
      apiFetch<{ items: WorkflowSummary[] }>("/workflows", { team, signal }),
  });
}
