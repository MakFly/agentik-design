"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch, qs } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { Paginated, Run, Step } from "@/types/domain";
import type { RunProjectContext } from "@/features/projects/types";

export interface RunFilters {
  status?: string;
  env?: string;
}

export interface RunDetail {
  run: Run;
  steps: Step[];
  children?: RunChildSummary[];
  placement?: {
    runtimeKind: string;
    runtimeId: string | null;
    daemonId: string | null;
    daemonName: string | null;
    pinned: boolean;
  };
  projectContext?: RunProjectContext;
  artifacts?: {
    summary: string;
    changedFiles: string[];
    fileChanges: Array<{
      path: string;
      status: string;
      additions: number;
      deletions: number;
    }>;
    tests: Array<{ name: string; status: string; output?: string }>;
  };
}

export interface RunChildSummary {
  id: string;
  parentRunId: string;
  agentId: string | null;
  agentName: string | null;
  status: string;
  kind: string | null;
  startedAt: string;
  endedAt: string | null;
  result: string | null;
  error: string | null;
}

export function useRuns(team: string, filters: RunFilters = {}) {
  return useQuery({
    queryKey: qk.runs.list(team, filters),
    queryFn: ({ signal }) =>
      apiFetch<Paginated<Run>>(`/runs${qs(filters)}`, { team, signal }),
  });
}

export function useRun(
  team: string,
  runId: string,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: qk.runs.detail(team, runId),
    enabled: opts.enabled ?? Boolean(runId),
    queryFn: ({ signal }) =>
      apiFetch<RunDetail>(`/runs/${runId}`, { team, signal }),
  });
}

export interface RunControlResponse {
  ok: boolean;
}

export function pauseRunHttp(team: string, runId: string, reason?: string) {
  return apiFetch<RunControlResponse>(`/runs/${runId}/pause`, {
    team,
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function resumeRunHttp(team: string, runId: string, reason?: string) {
  return apiFetch<RunControlResponse>(`/runs/${runId}/resume`, {
    team,
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function requestRunApprovalHttp(
  team: string,
  runId: string,
  message: string,
  context?: Record<string, unknown>,
) {
  return apiFetch<RunControlResponse>(`/runs/${runId}/approval/request`, {
    team,
    method: "POST",
    body: JSON.stringify({ message, context }),
  });
}

export function approveRunHttp(team: string, runId: string, reason?: string) {
  return apiFetch<RunControlResponse>(`/runs/${runId}/approve`, {
    team,
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function rejectRunHttp(team: string, runId: string, reason?: string) {
  return apiFetch<RunControlResponse>(`/runs/${runId}/reject`, {
    team,
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
