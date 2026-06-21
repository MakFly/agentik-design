"use client";

import { useState, useMemo, useEffect } from "react";
import { useRun } from "./api";
import { Timeline } from "./timeline";
import { StepFocusPanel } from "./step-focus-panel";
import { RunSummary } from "./run-summary";
import { RunControls } from "./run-controls";
import { ConnectionBadge } from "./connection-badge";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatMoney } from "@/lib/format";
import { useRunStream } from "@/lib/realtime/use-run-stream";
import { useRunStreamStore, useRunSteps, useRunConnection, useStepReasoning } from "@/lib/stores/runStream.store";
import { approveStep } from "@/lib/realtime/run-control";
import type { Step, Run, RunId, StepId } from "@/types/domain";
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
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{run.id}</span>
            <span className="text-muted-foreground">·</span>
            <span>{run.subjectName}</span>
            <StatusBadge status={run.status} size="sm" />
            {isLive ? <ConnectionBadge state={connection} /> : null}
          </span>
        }
        back={{ href: `/${team}/runs`, label: "Runs" }}
        description={
          <span className="tabular-nums" data-tabular>
            {steps.filter((s) => s.status === "succeeded").length}/{run.stepCount} steps · {formatDuration(run.durationMs)} ·{" "}
            {formatMoney(run.cost.money)}
          </span>
        }
        actions={<RunControls run={run} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <div className="rounded-lg border border-border bg-surface p-2 lg:sticky lg:top-[calc(var(--navbar-h)+1rem)] lg:max-h-[calc(100dvh-var(--navbar-h)-2rem)] lg:overflow-y-auto">
          <Timeline steps={steps} selectedId={selectedId} onSelect={setSelected} />
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          {selectedStep ? (
            <StepFocusPanel
              step={selectedStep}
              liveReasoning={isLive ? liveReasoning : undefined}
              logs={stepLogs}
              onDecide={(decision, reason) => approveStep(run.id as RunId, selectedStep.id as StepId, decision, reason)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a step.</p>
          )}
        </div>

        <div className="lg:sticky lg:top-[calc(var(--navbar-h)+1rem)] lg:self-start">
          <RunSummary team={team} run={run} />
        </div>
      </div>
    </div>
  );
}
