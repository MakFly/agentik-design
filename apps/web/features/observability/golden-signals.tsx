import { Activity, AlertTriangle, Timer, Gauge, DollarSign } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { formatCompactNumber, formatDuration, formatMoney, formatPercent, formatTokens } from "@/lib/format";
import type { ObsMetrics } from "@/types/observability";

/** OpenTelemetry "golden signals" — traffic, errors, latency, saturation, cost. */
export function GoldenSignals({ metrics: m }: { metrics: ObsMetrics }) {
  const errorTone = m.errorRate >= 0.03 ? "bad" : m.errorRate > 0 ? "neutral" : "good";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        label="Traces"
        value={formatCompactNumber(m.traceCount)}
        icon={Activity}
        sublabel="last 24h"
        series={m.series.map((p) => p.traces)}
      />
      <StatCard
        label="Error rate"
        value={formatPercent(m.errorRate)}
        icon={AlertTriangle}
        delta={{ text: `${m.series.reduce((n, p) => n + p.errors, 0)} errors`, tone: errorTone }}
        series={m.series.map((p) => p.errors)}
      />
      <StatCard
        label="P95 latency"
        value={formatDuration(m.p95Ms)}
        icon={Timer}
        sublabel={`p50 ${formatDuration(m.p50Ms)} · p99 ${formatDuration(m.p99Ms)}`}
        series={m.series.map((p) => p.p95Ms)}
      />
      <StatCard
        label="Throughput"
        value={`${m.throughputPerMin}/min`}
        icon={Gauge}
        sublabel="rolling avg"
      />
      <StatCard
        label="Cost"
        value={formatMoney({ amountCents: m.totalCostCents, currency: "USD" })}
        icon={DollarSign}
        sublabel={`${formatTokens(m.totalTokens)} tokens`}
        series={m.series.map((p) => p.costCents)}
      />
    </div>
  );
}
