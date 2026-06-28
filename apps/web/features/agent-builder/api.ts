"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { AgentConfig, AgentId, RunId } from "@/types/domain";
import type { AgentRow } from "@/features/agent-registry/types";
import type { DraftIdentity } from "./validation";
import type { SystemInfo } from "@/features/runtimes/types";

/** Runtimes selectable for a new agent — wired on a connected daemon with the CLI present. */
export function useAvailableRuntimes(team: string) {
  return useQuery({
    queryKey: ["team", team, "system"],
    queryFn: ({ signal }) => apiFetch<{ availableRuntimes?: string[] }>("/system", { team, signal }),
    select: (d) => d.availableRuntimes ?? [],
    staleTime: 5_000,
  });
}

export function useRuntimeSystem(team: string) {
  return useQuery({
    queryKey: ["team", team, "system"],
    queryFn: ({ signal }) => apiFetch<SystemInfo>("/system", { team, signal }),
    staleTime: 5_000,
  });
}

export interface CreateAgentResult {
  id: AgentId;
  draftVersionId: string;
  /** Present when `config` was sent — the server create+publishes atomically. */
  version?: number;
}

/** Body for POST /agents. When `config` is present the server create+publishes in one call. */
export type CreateAgentBody = DraftIdentity & { tags?: string[]; config?: AgentConfig };

export function useCreateAgent(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAgentBody) =>
      apiFetch<CreateAgentResult>("/agents", {
        method: "POST",
        team,
        body,
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.agents.all(team) }),
  });
}

/** PATCH partial identity (+ isOrchestrator + config) on an existing agent. */
export function useUpdateAgent(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, patch }: { agentId: AgentId; patch: Partial<DraftIdentity> & { config?: AgentConfig } }) =>
      apiFetch<AgentRow>(`/agents/${agentId}`, { method: "PATCH", team, body: patch }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.agents.all(team) });
      qc.invalidateQueries({ queryKey: qk.agents.detail(team, vars.agentId) });
    },
  });
}

/** Agent detail carrying the editable config (edit-mode load). Identity avatar +
 * isOrchestrator now live on AgentRow via the Agent model. */
export type AgentEditDetail = AgentRow & { config?: AgentConfig };

/**
 * Load an agent for the builder in edit mode. Reads the existing GET /agents/:id;
 * the rework extends that row with `config` so the builder can hydrate without a
 * separate version fetch.
 */
export function useAgentForEdit(team: string, agentId: string) {
  return useQuery({
    queryKey: qk.agents.detail(team, agentId),
    queryFn: ({ signal }) => apiFetch<AgentEditDetail>(`/agents/${agentId}`, { team, signal }),
  });
}

export interface PublishResult {
  versionId: string;
  version: number;
  status: "published";
}

export function usePublishAgent(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, config, changelog }: { agentId: AgentId; config: AgentConfig; changelog: string }) =>
      apiFetch<PublishResult>(`/agents/${agentId}/publish`, {
        method: "POST",
        team,
        body: { config, changelog },
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.agents.all(team) });
      qc.invalidateQueries({ queryKey: qk.agents.detail(team, vars.agentId) });
    },
  });
}

export interface TestRunResult {
  runId: RunId;
}

/** Start a sandbox test run against the draft config; returns a live run id. */
export function useTestRun(team: string) {
  return useMutation({
    mutationFn: ({ config, input }: { config: AgentConfig; input: string }) =>
      apiFetch<TestRunResult>("/agents/test", {
        method: "POST",
        team,
        // Test on the selected runtime so the harness matches what publish will run.
        body: { config, input, runtime: config.runtimeKind ?? "echo" },
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
  });
}
