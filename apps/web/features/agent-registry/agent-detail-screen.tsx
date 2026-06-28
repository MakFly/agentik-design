"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Circle,
  Clock,
  Cpu,
  History,
  Network,
  Pencil,
  Play,
  RefreshCw,
  Tag,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { CopyableValue } from "@/components/shared/copyable-value";
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
import {
  formatCompactNumber,
  formatDuration,
  formatMoney,
  formatPercent,
  formatRelativeTime,
  formatShortId,
} from "@/lib/format";
import { useSessionStore } from "@/lib/stores/session.store";
import { cn } from "@/lib/utils";
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

function MetaField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function MetaGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-4 sm:grid-cols-2", className)}>{children}</dl>
  );
}

function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-[4.75rem] flex-col justify-between rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="text-lg font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function AgentMetrics({ agent }: { agent: AgentRow }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <MetricTile label="Success rate (7d)" value={formatPercent(agent.stats.successRate)} />
      <MetricTile label="Avg. latency" value={formatDuration(agent.stats.avgLatencyMs)} />
      <MetricTile label="Avg. cost/run" value={formatMoney(agent.stats.avgCost)} />
      <MetricTile label="Runs / 24h" value={formatCompactNumber(agent.stats.runs24h)} />
      <MetricTile
        label="Last run"
        value={agent.stats.lastRunAt ? formatRelativeTime(agent.stats.lastRunAt) : "—"}
      />
      <MetricTile label="Model" value={<span className="text-base font-medium">{agent.model}</span>} />
    </div>
  );
}

export function AgentDetailScreen({ team, agentId }: { team: string; agentId: string }) {
  const session = useSessionStore((s) => s.session);
  const agentQuery = useAgent(team, agentId);
  const snapshotQuery = useAgentTaskSnapshot(team);
  const runsQuery = useRuns(team);
  const agent = agentQuery.data;
  const presence = useMemo(() => {
    if (!agent || !snapshotQuery.data) return null;
    return derivePresence(snapshotQuery.data, {
      id: agent.id,
      runtimeKind: agent.runtimeKind ?? "echo",
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

  const workspaceName = session?.team.name ?? team;

  return (
    <div className="flex min-h-[calc(100dvh-var(--navbar-h)-3rem)] flex-col gap-6 md:min-h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <PageHeader
        title={agent.name}
        description="Identity, health, config, runs, and runtime status."
        back={{ href: `/${team}/agents`, label: "Agents" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <Link href={`/${team}/agents/${agent.id}/edit`}>
                <Pencil className="size-4" />
                Edit in builder
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${team}/agents/fleet`}>
                <Network className="size-4" />
                View in Fleet
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${team}/automations?agent=${agent.id}`}>
                <Zap className="size-4" />
                Automations
              </Link>
            </Button>
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

      {presence && presence.availability !== "online" ? (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0">
            No live daemon for this agent&apos;s runtime{" "}
            <span className="font-mono">{agent.runtimeKind ?? "echo"}</span>. Runs are rejected until
            a daemon comes online — start your daemon, then try again.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4 text-primary" />
              Agent profile
            </CardTitle>
            <CardDescription>Identity, ownership, and lifecycle.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={agent.health} />
              <Badge variant="outline" className="rounded-full">
                {presence ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`size-1.5 rounded-full ${AVAILABILITY_CLASS[presence.availability]}`}
                    />
                    {presenceToLabel(presence.availability)}
                  </span>
                ) : (
                  "Presence unknown"
                )}
              </Badge>
              <Badge variant="secondary" className="rounded-full tabular-nums">
                {agent.stats.runs24h} runs / 24h
              </Badge>
            </div>

            <div className="grid gap-3 rounded-lg border border-border bg-surface/40 p-3">
              <MetaField label="Role">{detailLabel(agent.role)}</MetaField>
              <MetaField label="Goal">
                <span className="leading-relaxed text-muted-foreground">{detailLabel(agent.goal)}</span>
              </MetaField>
              {agent.description ? (
                <MetaField label="Description">
                  <span className="leading-relaxed text-muted-foreground">{agent.description}</span>
                </MetaField>
              ) : null}
            </div>

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

            <MetaGrid>
              <MetaField label="Agent ID">
                <CopyableValue value={agent.id} />
              </MetaField>
              <MetaField label="Workspace">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span>{workspaceName}</span>
                  <CopyableValue value={agent.teamId} className="text-muted-foreground" />
                </div>
              </MetaField>
              <MetaField label="Owner">
                <CopyableValue value={agent.owner} />
              </MetaField>
              <MetaField label="Created">{normalizeTimestamp(agent.createdAt)}</MetaField>
            </MetaGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="size-4 text-primary" />
              Runtime
            </CardTitle>
            <CardDescription>Model, workload, and version bindings.</CardDescription>
          </CardHeader>
          <CardContent>
            <MetaGrid>
              <MetaField label="Model">{detailLabel(agent.model)}</MetaField>
              <MetaField label="Runtime">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono">{agent.runtimeKind ?? "echo"}</span>
                  {presence ? (
                    <span
                      className={`size-1.5 rounded-full ${AVAILABILITY_CLASS[presence.availability]}`}
                      title={presenceToLabel(presence.availability)}
                      aria-label={presenceToLabel(presence.availability)}
                    />
                  ) : null}
                </span>
              </MetaField>
              <MetaField label="Updated">{normalizeTimestamp(agent.updatedAt)}</MetaField>
              <MetaField label="Workload">
                {presence ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Circle className="size-3.5 text-muted-foreground" />
                    <span className="tabular-nums">
                      {presence.runningCount} running · {presence.queuedCount} queued
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Waiting for snapshot…</span>
                )}
              </MetaField>
              <MetaField label="Live version">
                {agent.liveVersionId ? (
                  <CopyableValue value={agent.liveVersionId} />
                ) : (
                  "—"
                )}
              </MetaField>
              <MetaField label="Draft version" className="sm:col-span-2">
                {agent.draftVersionId ? (
                  <CopyableValue value={agent.draftVersionId} />
                ) : (
                  "—"
                )}
              </MetaField>
            </MetaGrid>
          </CardContent>
        </Card>
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
              title="No runs yet"
              description="Runs for this agent will show up here once executions start."
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
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Env</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentRuns.slice(0, 8).map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link
                          href={`/${team}/runs/${run.id}`}
                          className="font-mono text-xs hover:underline"
                          title={run.id}
                        >
                          {formatShortId(run.id)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={run.status} size="sm" />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{run.trigger.kind}</Badge>
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground"
                        title={normalizeTimestamp(run.startedAt)}
                      >
                        {runStartedAt(run)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(run.cost.money)}
                      </TableCell>
                      <TableCell className="text-muted-foreground uppercase">{run.env}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {agentRuns.length > 8 ? (
                <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  Showing 8 of {formatCompactNumber(agentRuns.length)} runs.{" "}
                  <Link href={`/${team}/runs`} className="text-primary hover:underline">
                    View all
                  </Link>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
