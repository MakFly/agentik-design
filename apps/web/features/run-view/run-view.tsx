"use client";

import { useMemo, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, ChevronRight, Clock, Coins, ListTodo, TerminalSquare, Workflow } from "lucide-react";
import { useRun, useRuns, type RunDetail } from "./api";
import { RunTranscript } from "./run-transcript";
import { RunSummary } from "./run-summary";
import { RunControls } from "./run-controls";
import { ConnectionBadge } from "./connection-badge";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatMoney, formatRelativeTime, formatShortId, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRunStream } from "@/lib/realtime/use-run-stream";
import { useRunStreamStore, useRunSteps, useRunConnection, useStepReasoning } from "@/lib/stores/runStream.store";
import { approveStep } from "@/lib/realtime/run-control";
import type { Step, Run, RunId, StepId } from "@/types/domain";
import type { LogLineItem } from "@/components/shared/log-stream";

const LIVE_STATUSES = new Set(["queued", "running", "paused", "waiting_approval"]);
const NO_TASK = "__no_task__";

interface RunNavTaskGroup {
  key: string;
  title: string | null;
  runs: Run[];
}

export function RunView({ team, runId }: { team: string; runId: string }) {
  const { data, isLoading, isError, error, refetch } = useRun(team, runId);
  const runsQuery = useRuns(team);

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

  const runningStepId = useMemo(() => steps.find((s) => s.status === "running")?.id ?? null, [steps]);
  const liveReasoning = useStepReasoning(runId, runningStepId);

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Run" back={{ href: `/${team}/platform/runs`, label: "Runs" }} />
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Run" back={{ href: `/${team}/platform/runs`, label: "Runs" }} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_300px]">
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
        <PageHeader title="Run" back={{ href: `/${team}/platform/runs`, label: "Runs" }} />
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
      ? streamState.logs.filter((l) => !l.stepId || l.stepId === runningStepId).map((l) => ({ ts: l.ts, level: l.level, message: l.message }))
      : undefined;

  return (
    <div className="flex min-h-[calc(100dvh-var(--navbar-h)-3rem)] flex-col md:min-h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <RunDetailHeader team={team} run={run} steps={steps} placement={data.placement} isLive={isLive} connection={connection} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 pt-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
        <RunNavigator
          team={team}
          currentRun={run}
          runs={runsQuery.data?.items ?? []}
          isLoading={runsQuery.isLoading}
        />

        {/* Operator console: the run read top-to-bottom. */}
        <div className="min-h-0">
          <div className="mb-2 flex h-8 items-center gap-2">
            <ListTodo className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-xs font-medium">Execution transcript</h2>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">{steps.length}</span>
          </div>
          <RunTranscript
            steps={steps}
            runningStepId={runningStepId}
            liveReasoning={isLive ? liveReasoning : undefined}
            logs={stepLogs}
            isLive={isLive}
            onDecide={(stepId, decision, reason) =>
              approveStep(run.id as RunId, stepId as StepId, decision, reason)
            }
          />
        </div>

        {/* Details rail: collapses below the transcript on mobile. */}
        <aside className="lg:sticky lg:top-[calc(var(--navbar-h)+1rem)] lg:max-h-[calc(100dvh-var(--navbar-h)-2rem)] lg:self-start lg:overflow-y-auto">
          <RunSummary team={team} run={run} projectContext={data.projectContext} />
          {data.children?.length ? <ChildRunsSection team={team} childrenRuns={data.children} /> : null}
        </aside>
      </div>
    </div>
  );
}

function subjectNavKey(run: Run): string {
  if (run.subject.kind === "agent") return `agent:${run.subject.agentId}`;
  if (run.subject.kind === "workflow") return `workflow:${run.subject.workflowId}`;
  return `orchestration:${run.subject.runId}`;
}

function byStartedDesc(a: Run, b: Run): number {
  const left = a.startedAt ?? "";
  const right = b.startedAt ?? "";
  return left > right ? -1 : left < right ? 1 : 0;
}

function buildRunNavGroups(runs: Run[], currentRun: Run): RunNavTaskGroup[] {
  const currentKey = subjectNavKey(currentRun);
  const unique = new Map<string, Run>();
  unique.set(currentRun.id, currentRun);
  for (const run of runs) {
    if (subjectNavKey(run) === currentKey) unique.set(run.id, run);
  }

  const sorted = Array.from(unique.values()).sort(byStartedDesc);
  const taskMap = new Map<string, RunNavTaskGroup>();
  for (const run of sorted) {
    const key = run.taskId ?? NO_TASK;
    let group = taskMap.get(key);
    if (!group) {
      group = { key, title: run.taskTitle ?? null, runs: [] };
      taskMap.set(key, group);
    }
    group.runs.push(run);
  }

  return Array.from(taskMap.values()).sort((a, b) => byStartedDesc(a.runs[0]!, b.runs[0]!));
}

function RunNavigator({
  team,
  currentRun,
  runs,
  isLoading,
}: {
  team: string;
  currentRun: Run;
  runs: Run[];
  isLoading: boolean;
}) {
  const groups = useMemo(() => buildRunNavGroups(runs, currentRun), [runs, currentRun]);
  const total = groups.reduce((sum, group) => sum + group.runs.length, 0);
  const Icon = currentRun.subject.kind === "workflow" ? Workflow : Bot;

  return (
    <aside className="min-w-0 lg:sticky lg:top-[calc(var(--navbar-h)+1rem)] lg:max-h-[calc(100dvh-var(--navbar-h)-2rem)] lg:self-start lg:overflow-y-auto">
      <section className="rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="truncate text-xs font-medium">Run navigator</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {currentRun.subjectName ?? "Current subject"}
            </p>
          </div>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">{total}</span>
        </div>

        <div className="flex max-h-72 gap-2 overflow-auto p-2 lg:max-h-none lg:flex-col lg:overflow-x-visible lg:overflow-y-visible">
          {isLoading ? (
            <>
              <Skeleton className="h-16 min-w-64 flex-1 lg:min-w-0" />
              <Skeleton className="h-16 min-w-64 flex-1 lg:min-w-0" />
            </>
          ) : (
            groups.map((group) => (
              <RunNavGroup
                key={group.key}
                team={team}
                group={group}
                currentRunId={currentRun.id}
              />
            ))
          )}
        </div>
      </section>
    </aside>
  );
}

function RunNavGroup({
  team,
  group,
  currentRunId,
}: {
  team: string;
  group: RunNavTaskGroup;
  currentRunId: string;
}) {
  return (
    <div className="flex min-w-72 flex-col gap-1 rounded-md border border-border/70 bg-background p-2 lg:min-w-0">
      <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground">
        <ListTodo className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{group.title ?? "Ad-hoc run"}</span>
        <span className="ml-auto font-mono tabular-nums text-muted-foreground/70">{group.runs.length}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {group.runs.map((run, index) => {
          const current = run.id === currentRunId;
          return (
            <Link
              key={run.id}
              href={`/${team}/platform/runs/${run.id}`}
              aria-current={current ? "page" : undefined}
              className={cn(
                "group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                current ? "bg-accent text-accent-foreground" : "hover:bg-surface-2",
              )}
            >
              <StatusBadge status={run.status} size="sm" iconOnly />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-mono text-xs">{formatShortId(run.id)}</span>
                  {index === 0 ? (
                    <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground group-aria-[current=page]:bg-background/70">
                      latest
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{run.startedAt ? formatRelativeTime(run.startedAt) : "En queue"}</span>
                  <span aria-hidden="true">/</span>
                  <span className="tabular-nums">{formatDuration(run.durationMs)}</span>
                </div>
              </div>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-60" aria-hidden="true" />
            </Link>
          );
        })}
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
          href={`/${team}/platform/runs`}
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
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs text-muted-foreground">
          <TerminalSquare className="size-3.5" />
          <span className="tabular-nums">{formatTokens(run.cost.tokens)} tok</span>
        </span>
        <RunControls run={run} />
      </div>
    </header>
  );
}

function ChildRunsSection({
  team,
  childrenRuns,
}: {
  team: string;
  childrenRuns: NonNullable<RunDetail["children"]>;
}) {
  return (
    <section className="mt-4 rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <Workflow className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Child runs</h3>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">{childrenRuns.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {childrenRuns.map((child) => (
          <Link
            key={child.id}
            href={`/${team}/platform/runs/${child.id}`}
            className="min-w-0 rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-surface-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Bot className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{child.agentName ?? child.agentId ?? "Agent"}</span>
              <StatusBadge status={child.status as Run["status"]} size="sm" />
            </div>
            {child.result || child.error ? (
              <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {child.error ?? child.result}
              </p>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
