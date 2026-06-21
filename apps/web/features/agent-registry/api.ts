"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch, qs } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { Paginated } from "@/types/domain";
import type { AgentTaskSnapshot } from "@/lib/agents/presence";
import type { AgentRow } from "./types";

export interface AgentFilters {
  status?: string;
  q?: string;
}

export function useAgents(team: string, filters: AgentFilters = {}) {
  return useQuery({
    queryKey: qk.agents.list(team, filters),
    queryFn: ({ signal }) => apiFetch<Paginated<AgentRow>>(`/agents${qs(filters)}`, { team, signal }),
  });
}

/** Single aggregate backing live agent presence (availability × workload). */
export function useAgentTaskSnapshot(team: string) {
  return useQuery({
    queryKey: qk.agents.snapshot(team),
    queryFn: ({ signal }) => apiFetch<AgentTaskSnapshot>(`/agent-task-snapshot`, { team, signal }),
  });
}
