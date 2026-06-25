"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowLeft,
  Bot,
  Circle,
  Play,
  Clock,
  Cpu,
  History,
  RefreshCw,
  Tag,
  Wifi,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAgent, useAgentTaskSnapshot } from "./api";
import { useRuns } from "@/features/run-view/api";
import { derivePresence } from "@/lib/agents/presence";
import { formatCompactNumber, formatDuration, formatMoney, formatPercent, formatRelativeTime } from "@/lib/format";
import type { Run } from "@/types/domain";
import type { AgentRow } from "./types";

const AVAILABILITY_CLASS: Record<"online" | "unstable" | "offline", string> = {
  online: "bg-success",
  unstable: "bg-warning",
  offline: "bg-muted-foreground/40",
};

function normalizeTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function detailLabel(value: string | null | undefined) {
  return value || "—";
}

function presenceToLabel(availability: "online" | "unstable" | "offline") {
  return availability === "online" ? "Online" : availability === "unstable" ? "Unstable" : "Offline";
}

function runStartedAt(run: Run) {
  if (!run.startedAt) return "—";
  return formatRelativeTime(run.startedAt);
}

function AgentMetrics({ agent }: { agent: AgentRow }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-xs text-muted-foreground">Success rate (7d)</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{formatPercent(agent.stats.successRate)}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-xs text-muted-foreground">Avg. latency</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{formatDuration(agent.stats.avgLatencyMs)}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-xs text-muted-foreground">Avg. cost/run</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(agent.stats.avgCost)}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-xs text-muted-foreground">Runs / 24h</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{formatCompactNumber(agent.stats.runs24h)}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-xs text-muted-foreground">Last run</p>
        <p className="mt-1 text-sm">
          {agent.stats.lastRunAt ? formatRelativeTime(agent.stats.lastRunAt) : "—"}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-xs text-muted-foreground">Model</p>
        <p className="mt-1 text-sm tabular-nums">{agent.model}</p>
      </div>
    </div>
  );
}

function DetailField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

export function AgentDetailScreen({ team, agentId }: { team: string; agentId: string }) {
  const agentQuery = useAgent(team, agentId);
  const snapshotQuery = useAgentTaskSnapshot(team);
  const runsQuery = useRuns(team);
  const agent = agentQuery.data;
  const presence = useMemo(() => {
    if (!agent || !snapshotQuery.data) return null;
    return derivePresence(snapshotQuery.data, {
      id: agent.id,
      runtimeKind: "echo",
      maxConcurrentTasks: 1,
    });
  }, [agent, snapshotQuery.data]);

  const agentRuns = useMemo(() => {
    if (!agent || !runsQuery.data?.items) return [];
    return runsQuery.data.items
      .filter((run) => run.subject.kind === "agent" && run.subject.agentId === agent.id)
      .sort((a, b) => {
        const right = Date.parse(b.startedAt.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
        const left = Date.parse(a.startedAt.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
        if (Number.isNaN(left) || Number.isNaN(right)) return 0;
        return right - left;
      });
  }, [agent, runsQuery.data]);

  if (agentQuery.isLoading || (!agentQuery.data && agentQuery.isFetching)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Loading agent"
          back={{ href: `/${team}/agents`, label: "Agents" }}
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href={`/${team}/agents`}>
                <ArrowLeft className="size-4" />
                Back
              </Link>
            </Button>
          }
        />
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (agentQuery.isError || !agent) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Agent"
          back={{ href: `/${team}/agents`, label: "Agents" }}
        />
        <ErrorState error={agentQuery.error} onRetry={() => agentQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-var(--navbar-h)-3rem)] flex-col gap-6 md:min-h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <PageHeader
        title={agent.name}
        description="Agent registry detail: identity, health, config, runs, and runtime status."
        back={{ href: `/${team}/agents`, label: "Agents" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/${team}/runs`}>
                <History className="size-4" />
                All runs
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${team}/agents/new`}>
                        <Play className="size-4" />
                New agent
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4 text-primary" />
              Agent profile
            </CardTitle>
            <CardDescription>Identity, ownership, lifecycle, and runtime target.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={agent.health} />
              <Badge variant="outline" className="rounded-full">
                {presence ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`size-1.5 rounded-full ${AVAILABILITY_CLASS[presence.availability]}`} />
                    {presenceToLabel(presence.availability)}
                  </span>
                ) : (
                  "Presence unknown"
                )}
              </Badge>
              <Badge variant="secondary" className="rounded-full">
                {agent.stats.runs24h} runs/24h
              </Badge>
            </div>

            <p className="text-sm leading-6 text-muted-foreground">
              <span className="font-medium text-foreground">Role:</span> {detailLabel(agent.role)}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              <span className="font-medium text-foreground">Goal:</span> {detailLabel(agent.goal)}
            </p>
            {agent.description ? (
              <p className="text-sm leading-6 text-muted-foreground">
                <span className="font-medium text-foreground">Description:</span> {agent.description}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {agent.tags.length ? (
                agent.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="rounded-full">
                    <Tag className="size-3.5" />
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">No tags</span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <DetailField label="Agent ID" value={detailLabel(agent.id)} mono />
              <DetailField label="Team" value={detailLabel(agent.teamId)} mono />
              <DetailField label="Owner" value={detailLabel(agent.owner)} />
              <DetailField label="Live version" value={detailLabel(agent.liveVersionId)} mono />
              <DetailField label="Draft version" value={detailLabel(agent.draftVersionId)} mono />
              <DetailField label="Created" value={normalizeTimestamp(agent.createdAt)} />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4 text-primary" />
                Runtime & health
              </CardTitle>
              <CardDescription>Current model and current presence snapshot.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailField label="Model" value={detailLabel(agent.model)} />
              <DetailField label="Updated" value={normalizeTimestamp(agent.updatedAt)} />
              <div className="flex items-center justify-between rounded-lg border border-border bg-surface/60 p-3">
                <span className="text-sm text-muted-foreground">Workload</span>
                <span className="inline-flex items-center gap-1.5 text-sm">
                  {presence ? (
                    <>
                      <Circle className="size-3.5 text-muted-foreground" />
                      {presence.runningCount} running · {presence.queuedCount} queued
                    </>
                  ) : (
                    <span>Waiting for snapshot…</span>
                  )}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wifi className="size-4 text-primary" />
                Runtime identity
              </CardTitle>
              <CardDescription>Version binding and traceability.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailField label="Agent config ID" value={detailLabel(agent.id)} />
              <DetailField label="Traceability" value="Runs and steps are linked from run history." />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="size-4 text-primary" />
            Metrics
          </CardTitle>
          <CardDescription>Operational performance and economics for this agent.</CardDescription>
        </CardHeader>
        <CardContent>
          <AgentMetrics agent={agent} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            Recent runs
          </CardTitle>
          <CardDescription>Last executions for this agent.</CardDescription>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <Skeleton className="h-40" />
          ) : runsQuery.isError ? (
            <ErrorState error={runsQuery.error} onRetry={() => runsQuery.refetch()} inline />
          ) : !agentRuns.length ? (
            <EmptyState
              icon={Clock}
              title="No runs found"
              description="There is no run history for this agent yet."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Env</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentRuns.slice(0, 8).map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-mono text-xs">{run.id}</TableCell>
                      <TableCell>
                        <StatusBadge status={run.status} size="sm" />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{run.trigger.kind}</Badge>
                      </TableCell>
                      <TableCell title={normalizeTimestamp(run.startedAt)}>
                        {runStartedAt(run)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatMoney(run.cost.money)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{run.env}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {agentRuns.length > 8 ? (
                <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  Showing 8 of {formatCompactNumber(agentRuns.length)} runs.
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raw payload</CardTitle>
          <CardDescription>Full JSON object returned by the agent endpoint.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-72 overflow-auto rounded-md border border-border bg-surface-2 p-3 text-xs">
            {JSON.stringify(agent, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
