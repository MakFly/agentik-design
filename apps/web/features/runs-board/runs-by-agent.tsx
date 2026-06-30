"use client";

import { memo, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, ChevronRight, Clock, Coins, ListTodo, Workflow } from "lucide-react";
import type { Run } from "@/types/domain";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDuration, formatMoney, formatRelativeTime, formatShortId } from "@/lib/format";

const ACTIVE_STATUSES = new Set(["queued", "running", "paused", "waiting_approval"]);
const NO_TASK = "__no_task__";

interface TaskGroup {
  key: string;
  title: string | null;
  runs: Run[];
}

interface AgentGroup {
  key: string;
  name: string;
  href: string | null;
  kind: "agent" | "workflow" | "orchestration";
  runs: Run[];
  tasks: TaskGroup[];
  activeCount: number;
  lastStartedAt: string;
}

function subjectKey(run: Run): { key: string; name: string; href: (team: string) => string | null; kind: AgentGroup["kind"] } {
  if (run.subject.kind === "agent") {
    const id = run.subject.agentId;
    return {
      key: `agent:${id}`,
      name: run.subjectName ?? id,
      href: (team) => `/${team}/platform/agents/${id}`,
      kind: "agent",
    };
  }
  if (run.subject.kind === "workflow") {
    return {
      key: `workflow:${run.subject.workflowId}`,
      name: run.subjectName ?? "Workflow",
      href: () => null,
      kind: "workflow",
    };
  }
  return { key: "orchestration", name: "Orchestration", href: () => null, kind: "orchestration" };
}

/** Most-recent-first by startedAt; tolerant of the engine's space-separated timestamps. */
function byStartedDesc(a: Run, b: Run): number {
  const left = a.startedAt ?? "";
  const right = b.startedAt ?? "";
  return left > right ? -1 : left < right ? 1 : 0;
}

function buildGroups(runs: Run[], team: string): AgentGroup[] {
  const map = new Map<string, AgentGroup>();
  for (const run of runs) {
    const subject = subjectKey(run);
    let group = map.get(subject.key);
    if (!group) {
      group = {
        key: subject.key,
        name: subject.name,
        href: subject.href(team),
        kind: subject.kind,
        runs: [],
        tasks: [],
        activeCount: 0,
        lastStartedAt: run.startedAt ?? "",
      };
      map.set(subject.key, group);
    }
    group.runs.push(run);
    if (ACTIVE_STATUSES.has(run.status)) group.activeCount++;
    if ((run.startedAt ?? "") > group.lastStartedAt) group.lastStartedAt = run.startedAt ?? "";
  }

  for (const group of map.values()) {
    group.runs.sort(byStartedDesc);
    const taskMap = new Map<string, TaskGroup>();
    for (const run of group.runs) {
      const key = run.taskId ?? NO_TASK;
      let task = taskMap.get(key);
      if (!task) {
        task = { key, title: run.taskTitle ?? null, runs: [] };
        taskMap.set(key, task);
      }
      task.runs.push(run);
    }
    // Tasks ordered by their most recent run (runs already sorted desc).
    group.tasks = Array.from(taskMap.values()).sort((a, b) => byStartedDesc(a.runs[0]!, b.runs[0]!));
  }

  return Array.from(map.values()).sort((a, b) =>
    a.lastStartedAt > b.lastStartedAt ? -1 : a.lastStartedAt < b.lastStartedAt ? 1 : 0,
  );
}

const RunRow = memo(function RunRow({ run, team, attempt }: { run: Run; team: string; attempt?: number }) {
  return (
    <Link
      href={`/${team}/platform/runs/${run.id}`}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <StatusBadge status={run.status} size="sm" />
      {attempt ? (
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          run #{attempt}
        </span>
      ) : null}
      <span className="font-mono text-xs text-muted-foreground" title={run.id}>
        {formatShortId(run.id)}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
        <span className="hidden items-center gap-1 tabular-nums sm:inline-flex">
          <Coins className="size-3" aria-hidden="true" />
          {formatMoney(run.cost.money)}
        </span>
        <span className="hidden items-center gap-1 sm:inline-flex">
          <Clock className="size-3" aria-hidden="true" />
          {formatDuration(run.durationMs)}
        </span>
        <span className="tabular-nums">{run.startedAt ? formatRelativeTime(run.startedAt) : "En queue"}</span>
      </span>
    </Link>
  );
});

const AgentCard = memo(function AgentCard({ group, team }: { group: AgentGroup; team: string }) {
  const [open, setOpen] = useState(true);
  const Icon = group.kind === "agent" ? Bot : Workflow;

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
            aria-hidden="true"
          />
          <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate text-sm font-medium">{group.name}</span>
          <Badge variant="secondary" className="ml-1 shrink-0 rounded-full tabular-nums">
            {group.runs.length}
          </Badge>
          {group.activeCount > 0 ? (
            <span className="shrink-0 rounded-full bg-running/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-running">
              {group.activeCount} active
            </span>
          ) : null}
        </button>
        {group.href ? (
          <Link
            href={group.href}
            className="shrink-0 text-xs text-primary hover:underline"
          >
            Open agent
          </Link>
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-border px-2 py-2">
          {group.tasks.map((task) => (
            <div key={task.key} className="px-1 py-1">
              <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <ListTodo className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{task.title ?? "Ad-hoc (no task)"}</span>
                <span className="tabular-nums text-muted-foreground/60">· {task.runs.length}</span>
              </div>
              <div className="space-y-0.5">
                {task.runs.map((run, i) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    team={team}
                    attempt={task.runs.length > 1 ? task.runs.length - i : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
});

/**
 * Agent-centric view of runs: one card per agent (the stable entity), with its
 * runs grouped under the task that triggered them. Read-only — status changes
 * happen on the Kanban board, not here.
 */
export function RunsByAgent({ runs, team }: { runs: Run[]; team: string }) {
  const groups = useMemo(() => buildGroups(runs, team), [runs, team]);

  if (!groups.length) {
    return (
      <div className="flex flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
        No runs to show in this scope.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-4 pb-2">
      {groups.map((group) => (
        <AgentCard key={group.key} group={group} team={team} />
      ))}
    </div>
  );
}
