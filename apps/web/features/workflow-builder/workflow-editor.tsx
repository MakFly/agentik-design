"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { fetchWorkflow } from "./api";
import { fromGraph } from "./serialize";
import { createInitialNodes } from "./utils";
import { WorkflowBuilder } from "./workflow-builder";
import type { WorkflowSnapshot } from "./store";
import { qk } from "@/lib/api/queryKeys";

export function WorkflowEditor({ team, workflowId }: { team: string; workflowId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.workflows.detail(team, workflowId),
    queryFn: () => fetchWorkflow(team, workflowId),
  });

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading workflow…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <AlertCircle className="size-6 text-destructive" />
        This workflow could not be loaded.
      </div>
    );
  }

  const base = data.graph ? fromGraph(data.graph) : createInitialNodes();
  const snapshot: WorkflowSnapshot = {
    name: data.name,
    active: data.active,
    nodes: base.nodes,
    edges: base.edges,
  };

  return <WorkflowBuilder team={team} workflowId={workflowId} initialSnapshot={snapshot} />;
}
