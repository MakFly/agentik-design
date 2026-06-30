"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatRelativeTime, formatShortId } from "@/lib/format";
import { useDeliveries } from "./api";

export function DeliveriesTable({ team }: { team: string }) {
  const deliveries = useDeliveries(team);

  if (deliveries.isError) return <ErrorState error={deliveries.error} onRetry={() => deliveries.refetch()} />;
  if (deliveries.isLoading) return <Skeleton className="h-64 rounded-lg" />;
  if (!deliveries.data?.length) {
    return (
      <EmptyState
        icon={Inbox}
        title="No deliveries yet"
        description="When a signal fires a rule, the resulting run shows up here."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Rule</TableHead>
            <TableHead>Signal</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.data.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground" title={d.createdAt}>
                {formatRelativeTime(d.createdAt)}
              </TableCell>
              <TableCell className="max-w-40 truncate">{d.ruleName ?? d.ruleId}</TableCell>
              <TableCell className="max-w-40 truncate text-muted-foreground">{d.signalName ?? d.signalId}</TableCell>
              <TableCell className="max-w-40 truncate">{d.agentName ?? d.targetAgentId ?? "—"}</TableCell>
              <TableCell>
                <StatusBadge status={d.status} size="sm" />
                {d.error ? <p className="mt-1 max-w-48 truncate text-xs text-danger" title={d.error}>{d.error}</p> : null}
              </TableCell>
              <TableCell>
                {d.runId ? (
                  <Link href={`/${team}/platform/runs/${d.runId}`} className="font-mono text-xs text-primary hover:underline" title={d.runId}>
                    {formatShortId(d.runId)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
