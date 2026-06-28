"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, Clock, Coins, FolderKanban, GitBranch, ListTodo, TerminalSquare, Workflow } from "lucide-react";
import { useRun, type RunDetail } from "./api";
import { Timeline } from "./timeline";
import { StepFocusPanel } from "./step-focus-panel";
import { RunSummary } from "./run-summary";
import { RunControls } from "./run-controls";
import { ConnectionBadge } from "./connection-badge";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatDuration, formatMoney } from "@/lib/format";
import { useRunStream } from "@/lib/realtime/use-run-stream";
import { useRunStreamStore, useRunSteps, useRunConnection, useStepReasoning } from "@/lib/stores/runStream.store";
import { approveStep } from "@/lib/realtime/run-control";
import type { Step, Run, RunId, StepId } from "@/types/domain";
import type { RunProjectContext } from "@/features/projects/types";
import type { LogLineItem } from "@/components/shared/log-stream";

const LIVE_STATUSES = new Set(["queued", "running", "paused", "waiting_approval"]);

function defaultStep(steps: Step[]): string | null {
  if (!steps.length) return null;
  return (
    steps.find((s) => s.status === "failed")?.id ??
    steps.find((s) => s.status === "running")?.id ??
    steps.find((s) => s.status === "pending")?.id ??
    steps[steps.length - 1].id
  );
}

export function RunView({ team, runId }: { team: string; runId: string }) {
  const { data, isLoading, isError, error, refetch } = useRun(team, runId);
  const [selected, setSelected] = useState<string | null>(null);

  const snapshotSteps = useMemo(() => data?.steps ?? [], [data]);
  const isLive = data?.run ? LIVE_STATUSES.has(data.run.status) : false;

  // seed the stream buffer from the REST snapshot before the socket attaches,
  // so the live view is never blank and degrades to the snapshot on disconnect.
  const seed = useRunStreamStore((s) => s.seed);
  useEffect(() => {
    if (data?.run && isLive) {
      seed(runId, { status: data.run.status, steps: data.steps, cost: data.run.cost });
    }
  }, [data, isLive, runId, seed]);

  useRunStream(runId, { enabled: isLive });

  const streamSteps = useRunSteps(runId);
  const connection = useRunConnection(runId);
  const streamState = useRunStreamStore((s) => s.byRun[runId]);

  // live → stream is authoritative; replay → REST snapshot
  const steps = isLive && streamSteps.length ? streamSteps : snapshotSteps;

  const autoSelected = useMemo(() => defaultStep(steps), [steps]);
  const selectedId = selected ?? autoSelected;
  const selectedStep = steps.find((s) => s.id === selectedId) ?? null;
  const liveReasoning = useStepReasoning(runId, selectedId);

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Run" back={{ href: `/${team}/runs`, label: "Runs" }} />
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Run" back={{ href: `/${team}/runs`, label: "Runs" }} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_300px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  // Defensive: a malformed detail (missing run) degrades gracefully instead of crashing.
  if (!data.run) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Run" back={{ href: `/${team}/runs`, label: "Runs" }} />
        <div className="p-8 text-center text-sm text-muted-foreground">This run can&apos;t be displayed.</div>
      </div>
    );
  }

  // overlay live status/cost onto the run for the header + summary
  const run: Run = {
    ...data.run,
    status: (isLive && streamState?.status) || data.run.status,
    cost: (isLive && streamState?.cost) || data.run.cost,
  };
  const stepLogs: LogLineItem[] | undefined =
    isLive && streamState
      ? streamState.logs.filter((l) => !l.stepId || l.stepId === selectedId).map((l) => ({ ts: l.ts, level: l.level, message: l.message }))
      : undefined;

  return (
    <div className="flex min-h-[calc(100dvh-var(--navbar-h)-3rem)] flex-col md:min-h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <RunDetailHeader team={team} run={run} steps={steps} placement={data.placement} isLive={isLive} connection={connection} />

      {data.projectContext ? <ProjectContextStrip team={team} context={data.projectContext} /> : null}
      {data.children?.length ? <ChildRunsStrip team={team} childrenRuns={data.children} /> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 pt-4 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        <div className="min-h-0 rounded-lg border border-border bg-surface lg:sticky lg:top-[calc(var(--navbar-h)+1rem)] lg:max-h-[calc(100dvh-var(--navbar-h)-2rem)]">
          <div className="flex h-10 items-center gap-2 border-b border-border px-3">
            <ListTodo className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-xs font-medium">Execution log</h2>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              {steps.length}
            </span>
          </div>
          <div className="max-h-[calc(100dvh-var(--navbar-h)-5.5rem)] overflow-y-auto p-2">
            <Timeline steps={steps} selectedId={selectedId} onSelect={setSelected} />
          </div>
        </div>

        <div className="min-h-0 rounded-lg border border-border bg-surface p-4">
          {selectedStep ? (
            <StepFocusPanel
              step={selectedStep}
              liveReasoning={isLive ? liveReasoning : undefined}
              logs={stepLogs}
              onDecide={(decision, reason) => approveStep(run.id as RunId, selectedStep.id as StepId, decision, reason)}
            />
          ) : (
            <EmptyOperatorConsole run={run} projectContext={data.projectContext} />
          )}
        </div>

        <div className="lg:sticky lg:top-[calc(var(--navbar-h)+1rem)] lg:self-start">
          <RunSummary team={team} run={run} projectContext={data.projectContext} artifacts={data.artifacts} />
        </div>
      </div>
    </div>
  );
}

function RunDetailHeader({
  team,
  run,
  steps,
  placement,
  isLive,
  connection,
}: {
  team: string;
  run: Run;
  steps: Step[];
  placement?: RunDetail["placement"];
  isLive: boolean;
  connection: ReturnType<typeof useRunConnection>;
}) {
  const SubjectIcon = run.subject.kind === "agent" ? Bot : Workflow;
  const succeeded = steps.filter((step) => step.status === "succeeded").length;
  const placementLabel = placement
    ? [
        placement.runtimeKind,
        placement.daemonName ?? placement.daemonId ?? "any compatible computer",
        placement.pinned ? "pinned" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={`/${team}/runs`}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label="Back to runs"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <SubjectIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-medium">{run.subjectName ?? run.id}</h1>
            <StatusBadge status={run.status} size="sm" />
            {isLive ? <ConnectionBadge state={connection} /> : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{run.id}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {placementLabel ? (
          <span className="inline-flex h-8 max-w-[280px] items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs text-muted-foreground">
            <TerminalSquare className="size-3.5 shrink-0" />
            <span className="truncate">{placementLabel}</span>
          </span>
        ) : null}
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs text-muted-foreground">
          <ListTodo className="size-3.5" />
          <span className="tabular-nums">{succeeded}/{run.stepCount}</span>
        </span>
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs text-muted-foreground">
          <Clock className="size-3.5" />
          <span className="tabular-nums">{formatDuration(run.durationMs)}</span>
        </span>
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs text-muted-foreground">
          <Coins className="size-3.5" />
          <span className="tabular-nums">{formatMoney(run.cost.money)}</span>
        </span>
        <RunControls run={run} />
      </div>
    </header>
  );
}

function ProjectContextStrip({ team, context }: { team: string; context: RunProjectContext }) {
  const primaryResource = context.resources.find((resource) => resource.type === "git_repo") ?? context.resources[0];

  return (
    <section className="mt-3 grid gap-3 rounded-lg border border-border bg-surface p-2 text-sm md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
      <Link href={`/${team}/projects/${context.project.id}`} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-2">
        <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block truncate font-medium">{context.project.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{context.task.title}</span>
        </span>
      </Link>
      <div className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5">
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block truncate font-mono text-xs">{primaryResource?.ref ?? "No resource attached"}</span>
          <span className="block text-xs text-muted-foreground">
            {context.resources.length} resources · {context.workspaces.length} workspaces
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Badge variant="outline">{context.project.type}</Badge>
        <Badge variant="secondary">{context.task.priority}</Badge>
      </div>
    </section>
  );
}

function ChildRunsStrip({
  team,
  childrenRuns,
}: {
  team: string;
  childrenRuns: NonNullable<RunDetail["children"]>;
}) {
  return (
    <section className="mt-3 rounded-lg border border-border bg-surface p-2">
      <div className="flex h-8 items-center gap-2 px-2">
        <Workflow className="size-4 text-muted-foreground" />
        <h2 className="text-xs font-medium">Child runs</h2>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{childrenRuns.length}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {childrenRuns.map((child) => (
          <Link
            key={child.id}
            href={`/${team}/runs/${child.id}`}
            className="min-w-0 rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-surface-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Bot className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{child.agentName ?? child.agentId ?? "Agent"}</span>
              <StatusBadge status={child.status as Run["status"]} size="sm" />
            </div>
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{child.id}</p>
            {child.result || child.error ? (
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {child.error ?? child.result}
              </p>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

function EmptyOperatorConsole({
  run,
  projectContext,
}: {
  run: Run;
  projectContext?: RunProjectContext;
}) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-background px-6 py-10 text-center">
      <TerminalSquare className="mb-3 size-7 text-muted-foreground" />
      <h2 className="text-sm font-semibold">Waiting for runtime output</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
        The run is queued or has not emitted steps yet. When the daemon streams tool calls, reasoning, approvals, or errors, they appear in this operator console.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{run.status}</Badge>
        {projectContext ? <Badge variant="secondary">{projectContext.project.name}</Badge> : null}
        <Badge variant="outline">{run.subjectName ?? run.subject.kind}</Badge>
      </div>
    </div>
  );
}
