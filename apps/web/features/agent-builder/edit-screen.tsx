"use client";
import { useAgentsBase } from "@/lib/agents/use-agents-base";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/layout/page-header";
import { AgentBuilder } from "./agent-builder";
import { useAgentForEdit } from "./api";
import { defaultAgentConfig } from "./default-config";
import type { DraftIdentity } from "./validation";

/**
 * Edit-mode entry: loads the agent's live config + identity, then mounts the
 * builder seeded with them. A locally-saved draft (autosave) still wins inside
 * the builder, so unpublished edits survive reload.
 */
export function AgentEditScreen({ team, agentId }: { team: string; agentId: string }) {
  const base = useAgentsBase(team);
  const query = useAgentForEdit(team, agentId);
  const agent = query.data;

  if (query.isLoading || (!agent && query.isFetching)) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,360px)]">
          <Skeleton className="h-72" />
          <Skeleton className="h-96" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (query.isError || !agent) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Edit agent"
          back={{ href: `${base}/${agentId}`, label: "Agent" }}
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/${agentId}`}>
                <ArrowLeft className="size-4" />
                Back
              </Link>
            </Button>
          }
        />
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  }

  const initialIdentity: Partial<DraftIdentity> = {
    name: agent.name,
    role: agent.role,
    goal: agent.goal,
    description: agent.description,
    emoji: agent.emoji,
    color: agent.color,
    isOrchestrator: agent.isOrchestrator,
  };

  return (
    <AgentBuilder
      team={team}
      mode="edit"
      agentId={agentId}
      initialIdentity={initialIdentity}
      initialConfig={agent.config ?? defaultAgentConfig()}
    />
  );
}
