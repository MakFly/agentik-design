"use client";

import type { Step } from "@/types/domain";
import { ActorIcon } from "./actor-icon";
import { formatDuration, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

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
    <ol className="flex flex-col" aria-label="Execution timeline">
      {steps.map((step, i) => {
        const selected = step.id === selectedId;
        const isLast = i === steps.length - 1;
        return (
          <li key={step.id} className="relative">
            {!isLast ? <span className="absolute top-7 left-[0.6875rem] h-[calc(100%-1rem)] w-px bg-border" aria-hidden="true" /> : null}
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "flex w-full items-start gap-3 rounded-md p-2 text-left transition-colors",
                selected ? "bg-accent" : "hover:bg-surface-2",
              )}
            >
              <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", DOT[step.status] ?? "bg-neutral")} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <ActorIcon actor={step.actor} className="size-3.5 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{step.actor.name}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{step.summary}</span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-subtle-foreground tabular-nums" data-tabular>
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
