"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { Plus, Bot } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { RbacGate } from "@/lib/auth/rbac";
import { useAgents, useAgentTaskSnapshot } from "./api";
import type { AgentRow } from "./types";
import { derivePresence, type AgentTaskSnapshot, type Availability } from "@/lib/agents/presence";
import { formatRelativeTime, formatDuration, formatPercent, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOT: Record<Availability, string> = {
  online: "bg-success",
  unstable: "bg-warning",
  offline: "bg-muted-foreground/40",
};

/** Live availability × workload, derived from the shared snapshot. */
function PresenceCell({ agentId, snapshot }: { agentId: string; snapshot?: AgentTaskSnapshot }) {
  const meta = snapshot?.agents.find((a) => a.id === agentId);
  const p = derivePresence(snapshot, {
    id: agentId,
    runtimeKind: meta?.runtimeKind ?? "echo",
    maxConcurrentTasks: meta?.maxConcurrentTasks ?? 1,
  });
  const label =
    p.workload === "working"
      ? `${p.runningCount} running${p.queuedCount ? ` · ${p.queuedCount} queued` : ""}`
      : p.workload === "queued"
        ? `${p.queuedCount} queued`
        : "idle";
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-2 shrink-0 rounded-full", DOT[p.availability])} title={p.availability} aria-label={p.availability} />
      <span className="text-xs text-muted-foreground tabular-nums">{label}</span>
    </div>
  );
}

const STATUSES = ["all", "healthy", "degraded", "error", "idle"] as const;

const columns: ColumnDef<AgentRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{row.original.name}</span>
        <span className="truncate text-xs text-muted-foreground">{row.original.role}</span>
      </div>
    ),
  },
  { accessorKey: "health", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.health} size="sm" /> },
  { accessorKey: "model", header: "Model", cell: ({ row }) => <span className="font-mono text-xs">{row.original.model}</span> },
  {
    id: "lastRun",
    header: "Last run",
    accessorFn: (r) => r.stats.lastRunAt ?? "",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.stats.lastRunAt ? formatRelativeTime(row.original.stats.lastRunAt) : "—"}
      </span>
    ),
  },
  {
    id: "successRate",
    header: "Success",
    accessorFn: (r) => r.stats.successRate,
    cell: ({ row }) => {
      const v = row.original.stats.successRate;
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn("h-full rounded-full", v >= 0.9 ? "bg-success" : v >= 0.7 ? "bg-warning" : "bg-danger")}
              style={{ width: `${Math.round(v * 100)}%` }}
            />
          </div>
          <span className="text-xs tabular-nums" data-tabular>
            {formatPercent(v)}
          </span>
        </div>
      );
    },
  },
  {
    id: "latency",
    header: "Latency",
    accessorFn: (r) => r.stats.avgLatencyMs,
    cell: ({ row }) => (
      <span className="tabular-nums" data-tabular>
        {row.original.stats.avgLatencyMs ? formatDuration(row.original.stats.avgLatencyMs) : "—"}
      </span>
    ),
  },
  {
    id: "cost",
    header: "$/task",
    accessorFn: (r) => r.stats.avgCost.amountCents,
    cell: ({ row }) => (
      <span className="tabular-nums" data-tabular>
        {formatMoney(row.original.stats.avgCost)}
      </span>
    ),
  },
  { accessorKey: "owner", header: "Owner", cell: ({ row }) => <span className="text-muted-foreground">{row.original.owner}</span> },
];

export function NewAgentButton({ team }: { team: string }) {
  return (
    <RbacGate permission="agent:create">
      <Button asChild size="sm">
        <Link href={`/${team}/agents/new`}>
          <Plus className="size-4" /> New agent
        </Link>
      </Button>
    </RbacGate>
  );
}

export function AgentsTable({ team }: { team: string }) {
  const router = useRouter();
  const [status, setStatus] = useQueryState("status");
  const { data, isLoading, isError, error, refetch } = useAgents(team, { status: status ?? undefined });
  const { data: snapshot } = useAgentTaskSnapshot(team);
  const items = data?.items ?? [];

  // Inject the live presence column after the name column.
  const cols = useMemo<ColumnDef<AgentRow>[]>(() => {
    const presence: ColumnDef<AgentRow> = {
      id: "presence",
      header: "Presence",
      cell: ({ row }) => <PresenceCell agentId={row.original.id} snapshot={snapshot} />,
    };
    return [columns[0]!, presence, ...columns.slice(1)];
  }, [snapshot]);

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
                "min-h-[32px] rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-surface-2",
              )}
            >
              {s}
            </button>
          );
        })}
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <DataTable
          columns={cols}
          data={items}
          isLoading={isLoading}
          onRowClick={(a) => router.push(`/${team}/agents/${a.id}`)}
          emptyState={
            status ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No agents match this filter.{" "}
                <button type="button" className="text-primary underline" onClick={() => setStatus(null)}>
                  Clear
                </button>
              </div>
            ) : (
              <EmptyState
                icon={Bot}
                title="No agents yet"
                description="Create your first agent to see it here."
                action={<NewAgentButton team={team} />}
              />
            )
          }
        />
      )}
    </div>
  );
}
