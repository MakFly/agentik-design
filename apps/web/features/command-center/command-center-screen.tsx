"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Braces,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FolderKanban,
  GitBranch,
  KeyRound,
  Play,
  RadioTower,
  ShieldQuestion,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgents } from "@/features/agent-registry/api";
import type { AgentRow } from "@/features/agent-registry/types";
import { useChannels } from "@/features/channels/api";
import { useProjects } from "@/features/projects/api";
import type { ProjectSummary, ProjectType } from "@/features/projects/types";
import { useRuns } from "@/features/run-view/api";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import type { Run, RunStatus } from "@/types/domain";

const ACTIVE_RUN_STATUSES = new Set<RunStatus>([
  "queued",
  "running",
  "paused",
  "waiting_approval",
]);
const TELEGRAM_COMMANDS = [
  "/projects",
  "/run <task>",
  "/approve <run>",
  "/learn <note>",
];

export function CommandCenterScreen({ team }: { team: string }) {
  const projectsQuery = useProjects(team);
  const runsQuery = useRuns(team);
  const agentsQuery = useAgents(team);
  const channelsQuery = useChannels(team);

  const projects = projectsQuery.data?.items ?? [];
  const runs = runsQuery.data?.items ?? [];
  const agents = agentsQuery.data?.items ?? [];
  const channels = channelsQuery.data?.items ?? [];

  const activeRuns = runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status));
  const approvals = activeRuns.filter(
    (run) => run.status === "waiting_approval",
  );
  const runningRuns = activeRuns.filter((run) => run.status === "running");
  const openTasks = projects.reduce(
    (total, project) => total + project.openTaskCount,
    0,
  );
  const blockedTasks = projects.reduce(
    (total, project) =>
      total + project.taskCounts.blocked + project.taskCounts.review,
    0,
  );
  const connectedChannels = channels.filter(
    (channel) => channel.status === "active",
  );
  const healthyAgents = agents.filter(
    (agent) => agent.health === "healthy",
  ).length;

  const hasError =
    projectsQuery.isError ||
    runsQuery.isError ||
    agentsQuery.isError ||
    channelsQuery.isError;
  const isLoading =
    projectsQuery.isLoading ||
    runsQuery.isLoading ||
    agentsQuery.isLoading ||
    channelsQuery.isLoading;

  if (hasError) {
    const error =
      projectsQuery.error ??
      runsQuery.error ??
      agentsQuery.error ??
      channelsQuery.error;
    return (
      <ErrorState
        error={error}
        onRetry={() =>
          void Promise.all([
            projectsQuery.refetch(),
            runsQuery.refetch(),
            agentsQuery.refetch(),
            channelsQuery.refetch(),
          ])
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Command Center"
        description="Project-first control plane for agent runs, code workspaces, approvals, memory, and Telegram control."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/${team}/channels`}>
                <RadioTower className="size-4" />
                Telegram
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/${team}/projects`}>
                <FolderKanban className="size-4" />
                Projects
              </Link>
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <CommandCenterSkeleton />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No control plane yet"
          description="Create a project to attach resources, spawn tasks, and let agents work inside a shared workspace."
          action={
            <Button asChild>
              <Link href={`/${team}/projects`}>Create project</Link>
            </Button>
          }
        />
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ControlMetric
              icon={FolderKanban}
              label="Projects"
              value={projects.length}
              detail={`${openTasks} open tasks`}
            />
            <ControlMetric
              icon={Play}
              label="Active runs"
              value={activeRuns.length}
              detail={`${runningRuns.length} running now`}
            />
            <ControlMetric
              icon={ShieldQuestion}
              label="Approvals"
              value={approvals.length}
              detail={`${blockedTasks} blocked or in review`}
              tone={approvals.length ? "attention" : "normal"}
            />
            <ControlMetric
              icon={Bot}
              label="Agents"
              value={agents.length}
              detail={`${healthyAgents} healthy`}
            />
          </section>

          <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
            <section className="flex min-w-0 flex-col gap-3">
              <SectionHeader
                title="Project Workspaces"
                description="Project lanes with code and ops context attached."
                href={`/${team}/projects`}
              />
              <div className="grid gap-3 lg:grid-cols-2">
                {projects.slice(0, 6).map((project) => (
                  <ProjectTile key={project.id} team={team} project={project} />
                ))}
              </div>
            </section>

            <aside className="flex min-w-0 flex-col gap-4">
              <ApprovalPanel team={team} approvals={approvals} />
              <TelegramPanel
                team={team}
                connected={connectedChannels.length}
                total={channels.length}
                pairingCode={channels[0]?.pairingCode}
              />
            </aside>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <RunPanel team={team} runs={activeRuns.slice(0, 6)} />
            <AgentPanel team={team} agents={agents.slice(0, 6)} />
          </div>
        </>
      )}
    </div>
  );
}

function CommandCenterSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Skeleton className="h-[420px] rounded-lg" />
        <Skeleton className="h-[420px] rounded-lg" />
      </div>
    </div>
  );
}

function ControlMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone = "normal",
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  detail: string;
  tone?: "normal" | "attention";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <span
          className={
            tone === "attention" ? "text-warning" : "text-muted-foreground"
          }
        >
          {tone === "attention" ? (
            <CircleAlert className="size-4" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-4" aria-hidden="true" />
          )}
        </span>
      </div>
      <div className="mt-4 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button asChild size="sm" variant="ghost">
        <Link href={href}>
          Open
          <ArrowRight className="size-4" />
        </Link>
      </Button>
    </div>
  );
}

function ProjectTile({
  team,
  project,
}: {
  team: string;
  project: ProjectSummary;
}) {
  return (
    <Link
      href={`/${team}/projects/${project.id}`}
      className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ProjectTypeBadge type={project.type} />
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(project.updatedAt)}
            </span>
          </div>
          <h3 className="mt-2 truncate text-base font-semibold text-foreground">
            {project.name}
          </h3>
          <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">
            {project.description || "No project context yet."}
          </p>
        </div>
        <ArrowRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
        <TaskMetric label="Open" value={project.openTaskCount} />
        <TaskMetric label="Run" value={project.taskCounts.running} />
        <TaskMetric label="Review" value={project.taskCounts.review} />
        <TaskMetric label="Refs" value={project.resourceCount} />
      </div>
    </Link>
  );
}

function ProjectTypeBadge({ type }: { type: ProjectType }) {
  const Icon =
    type === "code" ? GitBranch : type === "ops" ? Braces : TerminalSquare;
  const label = type === "code" ? "Code" : type === "ops" ? "Ops" : "Hybrid";
  return (
    <Badge variant="secondary" className="gap-1">
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </Badge>
  );
}

function TaskMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-surface-2 px-2 py-2">
      <div className="font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-muted-foreground">{label}</div>
    </div>
  );
}

function ApprovalPanel({
  team,
  approvals,
}: {
  team: string;
  approvals: Run[];
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <SectionHeader
        title="Approval Queue"
        description="Gate before risky actions."
        href={`/${team}/runs`}
      />
      <div className="mt-3 flex flex-col gap-2">
        {approvals.length ? (
          approvals.slice(0, 4).map((run) => (
            <Link
              key={run.id}
              href={`/${team}/runs/${run.id}`}
              className="rounded-md border border-border bg-surface-1 px-3 py-2 hover:border-primary/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {run.subjectName ?? run.id}
                </span>
                <StatusBadge status={run.status} size="sm" />
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                {run.id}
              </div>
            </Link>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No pending approval.
          </div>
        )}
      </div>
    </section>
  );
}

function TelegramPanel({
  team,
  connected,
  total,
  pairingCode,
}: {
  team: string;
  connected: number;
  total: number;
  pairingCode?: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <SectionHeader
        title="Telegram Remote"
        description={`${connected}/${total} active channels`}
        href={`/${team}/channels`}
      />
      <div className="mt-3 grid gap-3">
        <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <KeyRound
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            Pairing
          </span>
          <span className="font-mono text-sm">
            {pairingCode ?? "not configured"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {TELEGRAM_COMMANDS.map((command) => (
            <div
              key={command}
              className="rounded-md border border-border bg-surface-1 px-2.5 py-2 font-mono text-xs text-muted-foreground"
            >
              {command}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RunPanel({ team, runs }: { team: string; runs: Run[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <SectionHeader
        title="Live Runs"
        description="Execution console entry points."
        href={`/${team}/runs`}
      />
      <div className="mt-3 flex flex-col gap-2">
        {runs.length ? (
          runs.map((run) => <RunRow key={run.id} team={team} run={run} />)
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No active run.
          </div>
        )}
      </div>
    </section>
  );
}

function RunRow({ team, run }: { team: string; run: Run }) {
  const progress =
    run.stepCount > 0
      ? Math.round((run.completedSteps / run.stepCount) * 100)
      : 0;
  return (
    <Link
      href={`/${team}/runs/${run.id}`}
      className="rounded-md border border-border bg-surface-1 px-3 py-2 hover:border-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">
          {run.subjectName ?? run.id}
        </span>
        <StatusBadge status={run.status} size="sm" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-running"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
          {run.completedSteps}/{run.stepCount}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock3 className="size-3.5" aria-hidden="true" />
          {formatRelativeTime(run.startedAt)}
        </span>
        <span>{formatMoney(run.cost.money)}</span>
      </div>
    </Link>
  );
}

function AgentPanel({ team, agents }: { team: string; agents: AgentRow[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <SectionHeader
        title="Agent Bench"
        description="Available coding, ops, and review agents."
        href={`/${team}/agents`}
      />
      <div className="mt-3 flex flex-col gap-2">
        {agents.length ? (
          agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/${team}/agents/${agent.id}`}
              className="rounded-md border border-border bg-surface-1 px-3 py-2 hover:border-primary/40"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {agent.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {agent.role}
                  </div>
                </div>
                <StatusBadge status={agent.health} size="sm" />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{agent.model}</span>
                <span className="tabular-nums">
                  {agent.stats.runs24h} runs / 24h
                </span>
              </div>
            </Link>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No agent registered.
          </div>
        )}
      </div>
    </section>
  );
}
