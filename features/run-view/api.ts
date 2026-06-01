"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch, qs } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { Paginated, Run, Step } from "@/types/domain";

export interface RunFilters {
  status?: string;
  env?: string;
}

export interface RunDetail {
  run: Run;
  steps: Step[];
}

export function useRuns(team: string, filters: RunFilters = {}) {
  return useQuery({
    queryKey: qk.runs.list(team, filters),
    queryFn: ({ signal }) => apiFetch<Paginated<Run>>(`/runs${qs(filters)}`, { team, signal }),
  });
}

export function useRun(team: string, runId: string) {
  return useQuery({
    queryKey: qk.runs.detail(team, runId),
    queryFn: ({ signal }) => apiFetch<RunDetail>(`/runs/${runId}`, { team, signal }),
  });
}
