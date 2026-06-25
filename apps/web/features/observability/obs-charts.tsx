"use client";

import type { ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { formatDuration } from "@/lib/format";
import type { ObsMetrics } from "@/types/observability";

const volumeConfig = {
  traces: { label: "Traces", color: "var(--chart-1)" },
  errors: { label: "Errors", color: "var(--danger)" },
} satisfies ChartConfig;

const latencyConfig = {
  p95Ms: { label: "P95 latency", color: "var(--warning)" },
} satisfies ChartConfig;

const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, minTickGap: 28, interval: "preserveStartEnd" as const };
const MARGIN = { left: 4, right: 4, top: 6, bottom: 0 };

function ChartCard({ title, caption, children }: { title: string; caption: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums" data-tabular>
          {caption}
        </span>
      </div>
      {children}
    </div>
  );
}

export function ObsCharts({ metrics: m }: { metrics: ObsMetrics }) {
  const data = m.series;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ChartCard title="Request volume" caption={`${m.traceCount.toLocaleString()} traces`}>
        <ChartContainer config={volumeConfig} className="aspect-auto h-44 w-full">
          <AreaChart data={data} margin={MARGIN}>
            <defs>
              <linearGradient id="obs-fill-traces" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-traces)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-traces)" stopOpacity={0.04} />
              </linearGradient>
              <linearGradient id="obs-fill-errors" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-errors)" stopOpacity={0.45} />
                <stop offset="95%" stopColor="var(--color-errors)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="t" {...AXIS} />
            <ChartTooltip cursor content={<ChartTooltipContent indicator="dot" />} />
            <Area dataKey="traces" type="monotone" stroke="var(--color-traces)" fill="url(#obs-fill-traces)" strokeWidth={1.5} />
            <Area dataKey="errors" type="monotone" stroke="var(--color-errors)" fill="url(#obs-fill-errors)" strokeWidth={1.5} />
          </AreaChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard title="P95 latency" caption={formatDuration(m.p95Ms)}>
        <ChartContainer config={latencyConfig} className="aspect-auto h-44 w-full">
          <AreaChart data={data} margin={MARGIN}>
            <defs>
              <linearGradient id="obs-fill-p95" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-p95Ms)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-p95Ms)" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="t" {...AXIS} />
            <ChartTooltip
              cursor
              content={
                <ChartTooltipContent
                  indicator="dot"
                  formatter={(value) => (
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-muted-foreground">P95 latency</span>
                      <span className="font-mono font-medium text-foreground tabular-nums">{formatDuration(Number(value))}</span>
                    </div>
                  )}
                />
              }
            />
            <Area dataKey="p95Ms" type="monotone" stroke="var(--color-p95Ms)" fill="url(#obs-fill-p95)" strokeWidth={1.5} />
          </AreaChart>
        </ChartContainer>
      </ChartCard>
    </div>
  );
}
