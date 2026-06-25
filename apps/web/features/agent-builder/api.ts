"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { AgentConfig, AgentId, RunId } from "@/types/domain";
import type { DraftIdentity } from "./validation";

/** Runtimes selectable for a new agent — wired on a connected daemon with the CLI present. */
export function useAvailableRuntimes(team: string) {
  return useQuery({
    queryKey: ["team", team, "system"],
    queryFn: ({ signal }) => apiFetch<{ availableRuntimes?: string[] }>("/system", { team, signal }),
    select: (d) => d.availableRuntimes ?? [],
    staleTime: 5_000,
  });
}

export interface CreateAgentResult {
  id: AgentId;
  draftVersionId: string;
}

export function useCreateAgent(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DraftIdentity & { tags?: string[] }) =>
      apiFetch<CreateAgentResult>("/agents", {
        method: "POST",
        team,
        body,
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.agents.all(team) }),
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
