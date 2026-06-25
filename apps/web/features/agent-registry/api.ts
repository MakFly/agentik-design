"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useAgent(team: string, agentId: string) {
  return useQuery({
    queryKey: qk.agents.detail(team, agentId),
    queryFn: ({ signal }) => apiFetch<AgentRow>(`/agents/${agentId}`, { team, signal }),
  });
}

export function useDeleteAgent(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => apiFetch<{ ok: true }>(`/agents/${agentId}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.agents.all(team) }),
  });
}

/** Single aggregate backing live agent presence (availability × workload). */
export function useAgentTaskSnapshot(team: string) {
  return useQuery({
    queryKey: qk.agents.snapshot(team),
    queryFn: ({ signal }) => apiFetch<AgentTaskSnapshot>(`/agent-task-snapshot`, { team, signal }),
  });
}
