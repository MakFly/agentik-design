import { formatDuration, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ObsMetrics } from "@/types/observability";
import { categoryMeta } from "./span-color";

/** Top operations ranked by P95 latency — the usual "where's the time going" panel. */
export function ServiceBreakdown({ metrics: m }: { metrics: ObsMetrics }) {
  const maxP95 = Math.max(1, ...m.topOperations.map((o) => o.p95Ms));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">Top operations</h3>
        <span className="text-xs text-muted-foreground">by P95 latency</span>
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {m.topOperations.map((op) => {
          const meta = categoryMeta(op.category);
          const Icon = meta.Icon;
          return (
            <li key={op.name} className="flex items-center gap-3 py-2">
              <div className="flex w-[42%] min-w-0 items-center gap-1.5 sm:w-[34%]">
                <Icon className={cn("size-3.5 shrink-0", meta.text)} aria-hidden="true" />
                <span className="truncate font-mono text-xs font-medium text-foreground">{op.name}</span>
              </div>

              <div className="h-1.5 grow overflow-hidden rounded-full bg-surface-3">
                <div className={cn("h-full rounded-full", meta.bar)} style={{ width: `${(op.p95Ms / maxP95) * 100}%` }} />
              </div>

              <span className="w-14 shrink-0 text-right text-xs font-medium text-foreground tabular-nums" data-tabular>
                {formatDuration(op.p95Ms)}
              </span>
              <span className="hidden w-16 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums sm:inline" data-tabular>
                {op.count}×
                {op.errorRate > 0 ? <span className="ml-1 text-danger">{formatPercent(op.errorRate, 0)}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
