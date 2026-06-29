"use client";

import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { Play } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { useRuns } from "@/features/run-view/api";
import type { Run } from "@/types/domain";
import { formatRelativeTime, formatDuration, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUSES = ["all", "running", "waiting_approval", "succeeded", "failed"] as const;
const LABEL: Record<string, string> = { all: "all", waiting_approval: "approval" };

const columns: ColumnDef<Run>[] = [
  {
    id: "subject",
    header: "Subject",
    accessorFn: (r) => r.subjectName ?? r.id,
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{row.original.subjectName ?? row.original.id}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{row.original.id}</span>
      </div>
    ),
  },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} size="sm" /> },
  { accessorKey: "env", header: "Env", cell: ({ row }) => <span className="text-muted-foreground capitalize">{row.original.env}</span> },
  {
    id: "started",
    header: "Started",
    accessorFn: (r) => r.startedAt ?? "",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.startedAt ? formatRelativeTime(row.original.startedAt) : "En queue"}
      </span>
    ),
  },
  {
    id: "duration",
    header: "Duration",
    accessorFn: (r) => r.durationMs ?? 0,
    cell: ({ row }) => (
      <span className="tabular-nums" data-tabular>
        {formatDuration(row.original.durationMs)}
      </span>
    ),
  },
  {
    id: "steps",
    header: "Steps",
    accessorFn: (r) => r.completedSteps,
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums" data-tabular>
        {row.original.completedSteps}/{row.original.stepCount}
      </span>
    ),
  },
  {
    id: "cost",
    header: "Cost",
    accessorFn: (r) => r.cost.money.amountCents,
    cell: ({ row }) => (
      <span className="tabular-nums" data-tabular>
        {formatMoney(row.original.cost.money)}
      </span>
    ),
  },
];

export function RunsTable({ team }: { team: string }) {
  const router = useRouter();
  const [status, setStatus] = useQueryState("status");
  const { data, isLoading, isError, error, refetch } = useRuns(team, { status: status ?? undefined });
  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUSES.map((s) => {
          const active = (s === "all" && !status) || status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s === "all" ? null : s)}
              className={cn(
                "min-h-[32px] rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-surface-2",
              )}
            >
              {LABEL[s] ?? s}
            </button>
          );
        })}
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          isLoading={isLoading}
          onRowClick={(r) => router.push(`/${team}/runs/${r.id}`)}
          emptyState={
            status ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No runs match this filter.{" "}
                <button type="button" className="text-primary underline" onClick={() => setStatus(null)}>
                  Clear
                </button>
              </div>
            ) : (
              <EmptyState icon={Play} title="No runs yet" description="Run an agent or workflow to see executions here." />
            )
          }
        />
      )}
    </div>
  );
}
