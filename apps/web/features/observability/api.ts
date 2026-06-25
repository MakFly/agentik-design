"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch, qs } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { TraceDetail, TracesResponse } from "@/types/observability";

export interface TraceFilters {
  env?: string;
  status?: string;
  q?: string;
}

export function useTraces(team: string, filters: TraceFilters = {}) {
  return useQuery({
    queryKey: qk.observability.traces(team, filters),
    queryFn: ({ signal }) => apiFetch<TracesResponse>(`/observability/traces${qs(filters)}`, { team, signal }),
  });
}

export function useTrace(team: string, traceId: string) {
  return useQuery({
    queryKey: qk.observability.trace(team, traceId),
    queryFn: ({ signal }) => apiFetch<TraceDetail>(`/observability/traces/${traceId}`, { team, signal }),
  });
}
