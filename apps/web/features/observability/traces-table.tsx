"use client";

import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { Search, Activity } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { PillGroup, type PillOption } from "./time-range";
import type { TraceSummary } from "@/types/observability";
import { formatRelativeTime, formatDuration, formatMoney, formatTokens, formatNumber } from "@/lib/format";

const STATUS_MAP: Record<string, string> = { ok: "succeeded", error: "failed", unset: "running" };
const STATUS_FILTERS: PillOption[] = [
  { value: "all", label: "All" },
  { value: "ok", label: "OK" },
  { value: "error", label: "Errors" },
];

const columns: ColumnDef<TraceSummary>[] = [
  {
    id: "trace",
    header: "Trace",
    accessorFn: (t) => t.rootName,
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{row.original.rootName}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{row.original.traceId}</span>
      </div>
    ),
  },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={STATUS_MAP[row.original.status] ?? row.original.status} size="sm" /> },
  { accessorKey: "env", header: "Env", cell: ({ row }) => <span className="text-muted-foreground capitalize">{row.original.env}</span> },
  {
    id: "started",
    header: "Started",
    accessorFn: (t) => t.startedAt,
    cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatRelativeTime(row.original.startedAt)}</span>,
  },
  {
    id: "duration",
    header: "Duration",
    accessorFn: (t) => t.durationMs,
    cell: ({ row }) => <span className="tabular-nums" data-tabular>{formatDuration(row.original.durationMs)}</span>,
  },
  {
    id: "spans",
    header: "Spans",
    accessorFn: (t) => t.spanCount,
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums" data-tabular>
        {row.original.spanCount}
        {row.original.errorCount > 0 ? <span className="ml-1 text-danger">· {row.original.errorCount} err</span> : null}
      </span>
    ),
  },
  {
    id: "tokens",
    header: "Tokens",
    accessorFn: (t) => t.tokens,
    cell: ({ row }) => <span className="text-muted-foreground tabular-nums" data-tabular>{formatTokens(row.original.tokens)}</span>,
  },
  {
    id: "cost",
    header: "Cost",
    accessorFn: (t) => t.costCents,
    cell: ({ row }) => <span className="tabular-nums" data-tabular>{formatMoney({ amountCents: row.original.costCents, currency: "USD" })}</span>,
  },
];

export function TracesTable({ team, items, isLoading }: { team: string; items: TraceSummary[]; isLoading?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useQueryState("status");
  const [q, setQ] = useQueryState("q");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillGroup value={status ?? "all"} options={STATUS_FILTERS} onChange={(v) => setStatus(v === "all" ? null : v)} />
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q ?? ""}
            onChange={(e) => setQ(e.target.value || null)}
            placeholder="Search traces, service…"
            className="pl-8"
            aria-label="Search traces"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        onRowClick={(t) => router.push(`/${team}/observability/traces/${t.traceId}`)}
        emptyState={
          status || q ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No traces match.{" "}
              <button type="button" className="text-primary underline" onClick={() => { setStatus(null); setQ(null); }}>
                Clear filters
              </button>
            </div>
          ) : (
            <EmptyState icon={Activity} title="No traces in range" description="Run an agent or workflow to emit traces." />
          )
        }
      />
      <p className="text-[11px] text-muted-foreground">
        Showing {formatNumber(items.length)} sampled trace{items.length > 1 ? "s" : ""} · click a row to open the waterfall.
      </p>
    </div>
  );
}
