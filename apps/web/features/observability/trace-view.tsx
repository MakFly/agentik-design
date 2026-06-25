"use client";

import { useState } from "react";
import { MousePointerClick } from "lucide-react";
import { useTrace } from "./api";
import { TraceWaterfall } from "./trace-waterfall";
import { SpanDetailPanel } from "./span-detail-panel";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatDuration, formatMoney, formatTokens, formatNumber } from "@/lib/format";
import type { Span } from "@/types/observability";

const STATUS_MAP: Record<string, string> = { ok: "succeeded", error: "failed", unset: "running" };

function Fact({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone === "danger" ? "text-danger" : "text-foreground"}`} data-tabular>
        {value}
      </span>
    </div>
  );
}

export function TraceView({ team, traceId }: { team: string; traceId: string }) {
  const { data, isLoading, isError, error, refetch } = useTrace(team, traceId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const back = { href: `/${team}/observability`, label: "Observability" };

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Trace" back={back} />
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Trace" back={back} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-[28rem]" />
          <Skeleton className="hidden h-[28rem] lg:block" />
        </div>
      </div>
    );
  }

  const { trace, spans } = data;
  const totalMs = trace.durationMs;
  const root = spans.find((s) => s.parentSpanId === null) ?? spans[0];
  const selectedSpan: Span | null = selectedId ? spans.find((s) => s.spanId === selectedId) ?? null : null;
  const panelSpan = selectedSpan ?? root;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base break-all">{trace.traceId}</span>
            <StatusBadge status={STATUS_MAP[trace.status] ?? trace.status} size="sm" />
          </span>
        }
        back={back}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-foreground">{trace.rootName}</span>
            <span>·</span>
            <span className="capitalize">{trace.env}</span>
            <span>·</span>
            <span>
              {trace.serviceCount} service{trace.serviceCount > 1 ? "s" : ""}
            </span>
          </span>
        }
      />

      {/* trace fact strip */}
      <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-6">
        <Fact label="Duration" value={formatDuration(trace.durationMs)} />
        <Fact label="Spans" value={formatNumber(trace.spanCount)} />
        <Fact label="Services" value={formatNumber(trace.serviceCount)} />
        <Fact label="Tokens" value={formatTokens(trace.tokens)} />
        <Fact label="Cost" value={formatMoney({ amountCents: trace.costCents, currency: "USD" })} />
        <Fact label="Errors" value={formatNumber(trace.errorCount)} tone={trace.errorCount > 0 ? "danger" : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <TraceWaterfall spans={spans} totalMs={totalMs} selectedId={selectedId ?? root.spanId} onSelect={setSelectedId} />

        {/* desktop: sticky detail rail */}
        <aside className="hidden lg:block lg:sticky lg:top-[calc(var(--navbar-h)+1rem)] lg:max-h-[calc(100dvh-var(--navbar-h)-2rem)] lg:self-start lg:overflow-y-auto">
          <div className="rounded-lg border border-border bg-surface p-4">
            {panelSpan ? (
              <SpanDetailPanel span={panelSpan} traceDurationMs={totalMs} />
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <MousePointerClick className="size-4" aria-hidden="true" /> Select a span.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* mobile: detail opens in a bottom sheet on selection */}
      {isMobile ? (
        <Sheet open={selectedSpan != null} onOpenChange={(open) => !open && setSelectedId(null)}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
            <SheetHeader className="sr-only">
              <SheetTitle>Span detail</SheetTitle>
            </SheetHeader>
            {selectedSpan ? <SpanDetailPanel span={selectedSpan} traceDurationMs={totalMs} /> : null}
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
