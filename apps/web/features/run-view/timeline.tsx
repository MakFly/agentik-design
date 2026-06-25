"use client";

import type { Step } from "@/types/domain";
import { ActorIcon } from "./actor-icon";
import { formatDuration, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/status-badge";

const DOT: Record<string, string> = {
  succeeded: "bg-success",
  running: "bg-running animate-pulse",
  failed: "bg-danger",
  pending: "bg-surface-3 ring-1 ring-border-strong",
  skipped: "bg-neutral",
  retrying: "bg-warning",
};

/** Ordered step list. The running/failed step is the selection focus (docs/01 §4.4). */
export function Timeline({
  steps,
  selectedId,
  onSelect,
}: {
  steps: Step[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ol className="flex flex-col gap-1" aria-label="Execution timeline">
      {steps.map((step, i) => {
        const selected = step.id === selectedId;
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "group flex w-full items-start gap-2 rounded-md border border-transparent p-2 text-left transition-colors",
                selected ? "bg-accent" : "hover:bg-surface-2",
                selected && "border-border",
              )}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[step.status] ?? "bg-neutral")} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <ActorIcon actor={step.actor} className="size-3.5 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{step.actor.name}</span>
                  <span className="ml-auto hidden shrink-0 group-hover:inline-flex">
                    <StatusBadge status={step.status} size="sm" iconOnly />
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{step.summary}</span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-subtle-foreground tabular-nums" data-tabular>
                  <span>#{i + 1}</span>
                  {step.durationMs != null ? <span>{formatDuration(step.durationMs)}</span> : <span>running…</span>}
                  {step.cost.money.amountCents > 0 ? <span>· {formatMoney(step.cost.money)}</span> : null}
                  {step.attempt > 1 ? <span className="text-warning">· attempt {step.attempt}</span> : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
