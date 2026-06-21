"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, Loader2, Plus, Workflow as WorkflowIcon } from "lucide-react";
import { useWorkflows } from "./api";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function WorkflowsList({ team }: { team: string }) {
  const { data, isLoading, isError, refetch } = useWorkflows(team);
  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workflows"
        description="Compose agents, tools, decisions, and human approvals into runnable graphs."
        actions={
          <Button asChild size="sm">
            <Link href={`/${team}/workflows/new`}>
              <Plus className="size-4" /> New workflow
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading workflows…
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Could not load workflows"
          description="The workflow engine did not respond. Check that apps/engine is running."
          action={<Button onClick={() => void refetch()}>Retry</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          description="The visual canvas lets you wire trigger, HTTP, code and agent nodes with typed connections, then run the whole graph live."
          action={
            <Button asChild>
              <Link href={`/${team}/workflows/new`}>
                <Plus className="size-4" /> Create a workflow
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 @container sm:grid-cols-2 xl:grid-cols-3">
          {items.map((wf) => (
            <li key={wf.id}>
              <Link
                href={`/${team}/workflows/${wf.id}`}
                className="group flex h-full min-h-[44px] flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <WorkflowIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{wf.name}</span>
                  </span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                      wf.active
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    <span className={cn("size-1.5 rounded-full", wf.active ? "bg-success" : "bg-muted-foreground/50")} />
                    {wf.active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {wf.description || "No description."}
                </p>
                <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                  <span>{wf.currentVersion ? `v${wf.currentVersion}` : "Draft"}</span>
                  <span>
                    {wf.lastRunAt
                      ? `Ran ${formatDistanceToNow(new Date(wf.lastRunAt), { addSuffix: true })}`
                      : "Never run"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
