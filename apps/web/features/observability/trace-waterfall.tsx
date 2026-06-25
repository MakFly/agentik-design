"use client";

import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Span } from "@/types/observability";
import { buildWaterfallRows, rulerTicks } from "./waterfall-layout";
import { categoryMeta, spanBarClass } from "./span-color";

// Shared column geometry so the ruler and every row line up pixel-for-pixel.
const LABEL_COL = "basis-[44%] sm:basis-[40%] lg:basis-[34%] shrink-0 min-w-0";
const DUR_COL = "w-14 shrink-0 pl-2 text-right text-[11px] text-muted-foreground tabular-nums";

function Gridlines() {
  return (
    <>
      {[25, 50, 75].map((p) => (
        <span key={p} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${p}%` }} aria-hidden="true" />
      ))}
    </>
  );
}

export function TraceWaterfall({
  spans,
  totalMs,
  selectedId,
  onSelect,
}: {
  spans: Span[];
  totalMs: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const rows = buildWaterfallRows(spans);
  const ticks = rulerTicks(totalMs, 4);
  const span = totalMs || 1;

  return (
    <div className="rounded-lg border border-border bg-surface">
      {/* time ruler */}
      <div className="flex items-center border-b border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">
        <div className={LABEL_COL}>
          <span className="truncate">{rows.length} spans</span>
        </div>
        <div className="relative grow">
          {ticks.map((ms, i) => (
            <span
              key={i}
              className={cn(
                "absolute top-0 tabular-nums",
                i === 0 && "left-0",
                i === ticks.length - 1 && "right-0",
              )}
              style={i === 0 || i === ticks.length - 1 ? undefined : { left: `${(ms / span) * 100}%`, transform: "translateX(-50%)" }}
              data-tabular
            >
              {formatDuration(ms)}
            </span>
          ))}
        </div>
        <div className={DUR_COL}>Duration</div>
      </div>

      {/* rows */}
      <ol className="flex flex-col py-1" aria-label="Trace span waterfall">
        {rows.map(({ span: s, depth }) => {
          const selected = s.spanId === selectedId;
          const leftPct = (s.startOffsetMs / span) * 100;
          const widthPct = Math.max((s.durationMs / span) * 100, 0.6);
          const labelLeaning = leftPct > 60; // place duration label to the left of the bar near the right edge
          const meta = categoryMeta(s.category);
          const Icon = meta.Icon;

          return (
            <li key={s.spanId}>
              <button
                type="button"
                onClick={() => onSelect(s.spanId)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "flex w-full items-center rounded-md px-3 py-1.5 text-left transition-colors",
                  selected ? "bg-accent" : "hover:bg-surface-2",
                )}
              >
                <div className={cn(LABEL_COL, "flex items-center gap-1.5")} style={{ paddingLeft: depth * 14 }}>
                  <Icon className={cn("size-3.5 shrink-0", meta.text)} aria-hidden="true" />
                  <span className="truncate font-mono text-xs font-medium text-foreground">{s.name}</span>
                  <span className="hidden truncate text-[11px] text-subtle-foreground sm:inline">{s.service}</span>
                </div>

                <div className="relative grow self-stretch">
                  <Gridlines />
                  <span
                    className={cn(
                      "absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm",
                      spanBarClass(s.category, s.status),
                      s.status !== "error" && "opacity-90",
                    )}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`${s.name} · ${formatDuration(s.durationMs)}`}
                  />
                  <span
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 px-1.5 text-[10px] text-subtle-foreground tabular-nums",
                      labelLeaning ? "-translate-x-full" : "",
                    )}
                    style={{ left: `${Math.min(leftPct + widthPct, 100)}%` }}
                    data-tabular
                  >
                    {formatDuration(s.durationMs)}
                  </span>
                </div>

                <div className={DUR_COL}>{formatDuration(s.durationMs)}</div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
