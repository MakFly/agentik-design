"use client";

import { useQueryState } from "nuqs";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useTraces } from "./api";
import { RangeEnvBar } from "./time-range";
import { GoldenSignals } from "./golden-signals";
import { ObsCharts } from "./obs-charts";
import { ServiceBreakdown } from "./service-breakdown";
import { TracesTable } from "./traces-table";

function MetricsSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    </div>
  );
}

export function ObservabilityScreen({ team }: { team: string }) {
  const [env] = useQueryState("env");
  const [status] = useQueryState("status");
  const [q] = useQueryState("q");

  const { data, isLoading, isError, error, refetch } = useTraces(team, {
    env: env ?? undefined,
    status: status ?? undefined,
    q: q ?? undefined,
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Observability"
        description="OpenTelemetry-style traces, golden-signal metrics, and cost attribution across every agent run."
      />

      <RangeEnvBar />

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          {data?.metrics ? (
            <div className="flex flex-col gap-5">
              <GoldenSignals metrics={data.metrics} />
              <ObsCharts metrics={data.metrics} />
              <ServiceBreakdown metrics={data.metrics} />
            </div>
          ) : (
            <MetricsSkeleton />
          )}

          <TracesTable team={team} items={data?.items ?? []} isLoading={isLoading} />
        </>
      )}
    </div>
  );
}
