"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import type { AgentHealth, AgentId } from "@/types/domain";

/** A node in the fleet graph (one agent). Object-literal type so it satisfies xyflow's `Record<string,unknown>` node-data bound. */
export type FleetNode = {
  id: string;
  name: string;
  emoji?: string;
  color?: string;
  role?: string;
  isOrchestrator: boolean;
  health: AgentHealth;
};

/** Roster edge: a delegation link from an orchestrator (parent) to a subagent. */
export type RosterEdge = {
  parentAgentId: string;
  subagentId: string;
  instruction?: string;
};

/** Run edge: a live parent→child orchestration run (rendered as a hint, not roster). */
export type RunEdge = {
  parentRunId: string;
  childRunId: string;
};

export interface FleetGraph {
  nodes: FleetNode[];
  rosterEdges: RosterEdge[];
  runEdges: RunEdge[];
}

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

const graphKey = (team: string) => ["team", team, "agents", "graph"] as const;
const rosterKey = (team: string, agentId: string) =>
  ["team", team, "agents", agentId, "subagents"] as const;

/** The whole fleet: nodes + roster edges, for the graph and the list fallback. */
export function useAgentGraph(team: string) {
  return useQuery({
    queryKey: graphKey(team),
    queryFn: ({ signal }) => apiFetch<FleetGraph>("/agents/graph", { team, signal }),
  });
}

/** One orchestrator's roster (subagents with per-edge instructions). */
export function useRoster(team: string, agentId: string, enabled = true) {
  return useQuery({
    queryKey: rosterKey(team, agentId),
    queryFn: ({ signal }) =>
      apiFetch<RosterResponse>(`/agents/${agentId}/subagents`, { team, signal }),
    enabled: enabled && Boolean(agentId),
  });
}

/** Replace an orchestrator's roster wholesale (PUT). Invalidates roster + graph. */
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
      qc.invalidateQueries({ queryKey: graphKey(team) });
    },
  });
}

/**
 * Reassign any parent's roster from the graph (drag-to-link / edge-remove), where
 * the parent id varies per call. Invalidates the graph and that parent's roster.
 */
export function useReassignRoster(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, subagents }: { parentId: string; subagents: RosterInput[] }) =>
      apiFetch<RosterResponse>(`/agents/${parentId}/subagents`, {
        method: "PUT",
        team,
        body: { subagents },
      }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: rosterKey(team, vars.parentId) });
      qc.invalidateQueries({ queryKey: graphKey(team) });
    },
  });
}

export type { AgentId };
