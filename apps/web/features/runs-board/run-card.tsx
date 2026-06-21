"use client";

import { memo, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Workflow, Clock, Coins, Webhook, CalendarClock, Hand, Zap } from "lucide-react";
import { useSortable, defaultAnimateLayoutChanges } from "@dnd-kit/sortable";
import type { AnimateLayoutChanges } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Run } from "@/types/domain";
import { cn } from "@/lib/utils";
import { formatDuration, formatMoney, formatRelativeTime, formatElapsed } from "@/lib/format";

const TRIGGER_ICON = {
  webhook: Webhook,
  schedule: CalendarClock,
  manual: Hand,
  api: Zap,
} as const;

/** Live stopwatch for in-flight runs, ticking once a second. */
function LiveElapsed({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums">{formatElapsed(Math.max(0, now - Date.parse(startedAt)))}</span>;
}

export const RunCardContent = memo(function RunCardContent({ run }: { run: Run }) {
  const isAgent = run.subject.kind === "agent";
  const SubjectIcon = isAgent ? Bot : Workflow;
  const TriggerIcon = TRIGGER_ICON[run.trigger.kind];
  const live = run.status === "running" || run.status === "waiting_approval" || run.status === "paused";
  const progress = run.stepCount > 0 ? run.completedSteps / run.stepCount : 0;

  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-3 shadow-[0_3px_6px_-2px_rgba(0,0,0,0.02),0_1px_1px_0_rgba(0,0,0,0.04)] transition-colors group-hover/card:border-accent group-hover/card:bg-accent">
      {/* Row 1: subject + env */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <SubjectIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate text-sm font-medium leading-snug">{run.subjectName ?? run.id}</span>
        </div>
        <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {run.env}
        </span>
      </div>

      {/* Row 2: run id */}
      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{run.id}</p>

      {/* Progress bar */}
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              run.status === "failed" ? "bg-danger" : run.status === "succeeded" ? "bg-success" : "bg-running",
            )}
            style={{ width: `${Math.round((run.status === "succeeded" ? 1 : progress) * 100)}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {run.completedSteps}/{run.stepCount}
        </span>
      </div>

      {run.error && (
        <p className="mt-1.5 line-clamp-1 text-[11px] text-danger">{run.error.message}</p>
      )}

      {/* Meta row */}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <TriggerIcon className="size-3 shrink-0" aria-hidden="true" />
          {formatRelativeTime(run.startedAt)}
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Clock className="size-3 shrink-0" aria-hidden="true" />
          {live ? <LiveElapsed startedAt={run.startedAt} /> : formatDuration(run.durationMs)}
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Coins className="size-3 shrink-0" aria-hidden="true" />
          {formatMoney(run.cost.money)}
        </span>
      </div>
    </div>
  );
});

const animateLayoutChanges: AnimateLayoutChanges = (args) => {
  const { isSorting, wasDragging } = args;
  if (isSorting || wasDragging) return false;
  return defaultAnimateLayoutChanges(args);
};

export const DraggableRunCard = memo(function DraggableRunCard({ run, team }: { run: Run; team: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: run.id,
    data: { status: run.status },
    animateLayoutChanges,
  });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn("group/card", isDragging && "opacity-30")}
    >
      <Link
        href={`/${team}/runs/${run.id}`}
        draggable={false}
        className={cn("block", isDragging && "pointer-events-none")}
      >
        <RunCardContent run={run} />
      </Link>
    </div>
  );
});
