"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";

/** A subagent in an orchestrator's roster (with per-edge delegation instruction). */
export type Subagent = {
  agentId: string;
  name: string;
  emoji?: string;
  color?: string;
  role?: string;
  instruction?: string;
  position: number;
};

export interface RosterResponse {
  subagents: Subagent[];
}

/** A single roster entry as sent to PUT /agents/:id/subagents. */
export interface RosterInput {
  agentId: string;
  instruction?: string;
  position?: number;
}

const rosterKey = (team: string, agentId: string) =>
  ["team", team, "agents", agentId, "subagents"] as const;

/** One orchestrator's roster (subagents with per-edge instructions). */
export function useRoster(team: string, agentId: string, enabled = true) {
  return useQuery({
    queryKey: rosterKey(team, agentId),
    queryFn: ({ signal }) =>
      apiFetch<RosterResponse>(`/agents/${agentId}/subagents`, { team, signal }),
    enabled: enabled && Boolean(agentId),
  });
}

/** Replace an orchestrator's roster wholesale (PUT). */
export function useSetRoster(team: string, agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subagents: RosterInput[]) =>
      apiFetch<RosterResponse>(`/agents/${agentId}/subagents`, {
        method: "PUT",
        team,
        body: { subagents },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rosterKey(team, agentId) });
    },
  });
}
