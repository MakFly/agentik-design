import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { RunDetail } from "@agentik/workflow-schema";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import {
  artifactsFromRun,
  daemonDisplayName,
  daemonRunToWeb,
  fallbackResultStep,
  orchestrationRunToWeb,
  runMessageToStep,
  runMessagesToSteps,
  workflowRunToRun,
  workflowStepToWebStep,
  type DaemonRunRowDb,
  type RunMsgRowDb,
} from "./mappers";

export type { WebRunStatus, DaemonRunRowDb, RunMsgRowDb } from "./mappers";
export {
  daemonRunToWeb,
  orchestrationRunToWeb,
  runMessageToStep,
  runMessagesToSteps,
  workflowDetailToWeb,
} from "./mappers";

const {
  agents,
  daemons,
  runtimes,
  runs,
  runMessages,
  runEvents,
  runSteps,
  workflows,
  projects,
  projectResources,
  projectTasks,
  projectWorkspaces,
  teams,
} = schema;

export type RunEventRow = typeof runEvents.$inferSelect;

/**
 * Read the V2 run_events ledger for a run (team-scoped via the parent run).
 * This is the authoritative, persisted event log used for audit / replay /
 * export — distinct from the on-the-fly SSE projection built from run_messages.
 */
export async function listRunEvents(
  teamId: string,
  runId: string,
  afterSeq = 0,
): Promise<RunEventRow[] | null> {
  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.teamId, teamId)))
    .limit(1);
  if (!run) return null;
  return db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
    .orderBy(runEvents.seq);
}

/** Append events to the V2 ledger. Idempotent on (runId, seq). */
export async function appendRunEvents(
  runId: string,
  events: Array<{
    seq: number;
    type: string;
    actor: unknown;
    payload: unknown;
    toolCallId?: string | null;
    parentEventId?: string | null;
    contractEvent?: string | null;
  }>,
): Promise<void> {
  if (events.length === 0) return;
  await db
    .insert(runEvents)
    .values(
      events.map((e) => ({
        id: genId("revt"),
        runId,
        seq: e.seq,
        type: e.type,
        actor: e.actor as never,
        payload: e.payload as never,
        toolCallId: e.toolCallId ?? null,
        parentEventId: e.parentEventId ?? null,
        contractEvent: e.contractEvent ?? null,
      })),
    )
    .onConflictDoNothing({ target: [runEvents.runId, runEvents.seq] });
}

/** Sum of realized run cost (integer cents) for a team in the current calendar month. */
export async function monthlyCostCents(teamId: string): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT coalesce(sum(cost_cents), 0)::int AS "total"
    FROM ${runs}
    WHERE team_id = ${teamId}
      AND cost_cents IS NOT NULL
      AND created_at >= date_trunc('month', now())
  `)) as unknown as Array<{ total: number }>;
  return rows[0]?.total ?? 0;
}

/** Per-team monthly spend ceiling in cents, or null when uncapped. Stored on
 *  `teams.settings.providers.monthlySpendLimitCents` (owned by the settings domain). */
export async function teamSpendLimitCents(teamId: string): Promise<number | null> {
  const [row] = await db
    .select({ settings: teams.settings })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  const providers = (
    row?.settings as { providers?: { monthlySpendLimitCents?: number } } | undefined
  )?.providers;
  const v = providers?.monthlySpendLimitCents;
  return typeof v === "number" && v > 0 ? v : null;
}

async function projectContextForRun(task: DaemonRunRowDb) {
  if (!task.projectId || !task.projectTaskId) return null;
  const [project, projectTask, resources, workspaces] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(
        and(eq(projects.teamId, task.teamId), eq(projects.id, task.projectId)),
      )
      .limit(1),
    db
      .select()
      .from(projectTasks)
      .where(
        and(
          eq(projectTasks.teamId, task.teamId),
          eq(projectTasks.id, task.projectTaskId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(projectResources)
      .where(
        and(
          eq(projectResources.teamId, task.teamId),
          eq(projectResources.projectId, task.projectId),
        ),
      )
      .orderBy(desc(projectResources.createdAt)),
    db
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.teamId, task.teamId),
          eq(projectWorkspaces.projectId, task.projectId),
        ),
      )
      .orderBy(desc(projectWorkspaces.updatedAt)),
  ]);
  if (!project[0] || !projectTask[0]) return null;
  return {
    project: project[0],
    task: projectTask[0],
    resources,
    workspaces,
  };
}

async function placementForRun(task: DaemonRunRowDb) {
  const [agent] = await db
    .select({
      runtimeKind: agents.runtimeKind,
      preferredDaemonId: agents.preferredDaemonId,
    })
    .from(agents)
    .where(and(eq(agents.teamId, task.teamId), eq(agents.id, task.agentId!)))
    .limit(1);
  const daemonId = task.daemonId ?? agent?.preferredDaemonId ?? null;
  if (!daemonId && !task.runtimeId && !agent?.runtimeKind) return undefined;
  const [daemon] = daemonId
    ? await db
        .select({
          id: daemons.id,
          name: daemons.name,
          status: daemons.status,
          lastHeartbeatAt: daemons.lastHeartbeatAt,
          meta: daemons.meta,
        })
        .from(daemons)
        .where(and(eq(daemons.teamId, task.teamId), eq(daemons.id, daemonId)))
        .limit(1)
    : [];
  const [runtime] = task.runtimeId
    ? await db
        .select({ id: runtimes.id, kind: runtimes.kind })
        .from(runtimes)
        .where(and(eq(runtimes.teamId, task.teamId), eq(runtimes.id, task.runtimeId)))
        .limit(1)
    : [];
  return {
    runtimeKind: runtime?.kind ?? agent?.runtimeKind ?? "claude",
    runtimeId: task.runtimeId ?? null,
    daemonId,
    daemonName: daemonDisplayName(daemon),
    pinned: Boolean(agent?.preferredDaemonId),
  };
}

export async function getRunStatus(
  teamId: string,
  id: string,
): Promise<import("./mappers").WebRunStatus | null> {
  const [t] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.teamId, teamId)))
    .limit(1);
  return t ? (t.status as import("./mappers").WebRunStatus) : null;
}

export async function getRunAgentName(
  teamId: string,
  id: string,
): Promise<string | undefined> {
  const [t] = await db
    .select({ agentId: runs.agentId })
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.teamId, teamId)))
    .limit(1);
  if (!t) return undefined;
  const [a] = await db
    .select({ name: agents.name })
    .from(agents)
    .where(and(eq(agents.id, t.agentId!), eq(agents.teamId, teamId)))
    .limit(1);
  return a?.name ?? undefined;
}

export async function listRunMessagesAfter(
  runId: string,
  afterSeq: number,
): Promise<RunMsgRowDb[]> {
  return db
    .select()
    .from(runMessages)
    .where(and(eq(runMessages.runId, runId), gt(runMessages.seq, afterSeq)))
    .orderBy(runMessages.seq);
}

export async function listRuns(
  teamId: string,
  filters: { status?: string; agentId?: string },
) {
  const wheres = [eq(runs.teamId, teamId)];
  if (filters.agentId) {
    wheres.push(eq(runs.executor, "daemon"));
    wheres.push(eq(runs.agentId, filters.agentId));
  }
  const rows = await db
    .select()
    .from(runs)
    .where(and(...wheres))
    .orderBy(desc(runs.createdAt))
    .limit(200);
  const agentNames = await agentNameMap(teamId);
  const wfNames = await workflowNameMap(teamId);
  const taskTitles = await taskTitleMap(teamId);
  let items = rows
    .map((row) => ({
      sortAt: row.startedAt ?? row.createdAt,
      item:
        row.executor === "orchestrator"
          ? orchestrationRunToWeb(row)
          : row.executor === "daemon"
            ? daemonRunToWeb(
                row,
                row.agentId ? agentNames.get(row.agentId) : undefined,
                row.projectTaskId ? taskTitles.get(row.projectTaskId) : undefined,
              )
            : workflowRunToRun(row, row.workflowId ? wfNames.get(row.workflowId) : undefined),
    }))
    .sort((a, b) =>
      b.sortAt > a.sortAt ? 1 : b.sortAt < a.sortAt ? -1 : 0,
    );
  if (filters.status) items = items.filter(({ item }) => item.status === filters.status);
  return items.map(({ item }) => item);
}

export async function getRunDetail(teamId: string, id: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.teamId, teamId)))
    .limit(1);
  if (!run) return null;
  const children = await childSummariesForRun(teamId, id);
  if (run.executor === "workflow") {
    const steps = await db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, id))
      .orderBy(runSteps.index);
    const wfNames = await workflowNameMap(teamId);
    return {
      run: workflowRunToRun(
        run,
        run.workflowId ? wfNames.get(run.workflowId) : undefined,
      ),
      steps: steps.map(workflowStepToWebStep),
      placement: undefined,
      artifacts: undefined,
      projectContext: undefined,
      children,
    };
  }
  if (run.executor === "orchestrator") {
    const msgs = await db
      .select()
      .from(runMessages)
      .where(eq(runMessages.runId, id))
      .orderBy(runMessages.seq);
    const steps = runMessagesToSteps(msgs, "Orchestrator");
    const fallback = steps.length === 0 ? fallbackResultStep(run, "Orchestrator") : null;
    return {
      run: orchestrationRunToWeb(run),
      steps: fallback ? [fallback] : steps,
      placement: undefined,
      artifacts: undefined,
      projectContext: undefined,
      children,
    };
  }
  const msgs = await db
    .select()
    .from(runMessages)
    .where(eq(runMessages.runId, id))
    .orderBy(runMessages.seq);
  const names = await agentNameMap(run.teamId);
  const name = run.agentId ? names.get(run.agentId) : undefined;
  const projectContext = await projectContextForRun(run);
  const artifacts = artifactsFromRun(run);
  const placement = await placementForRun(run);
  const steps = runMessagesToSteps(msgs, name);
  const fallback = steps.length === 0 ? fallbackResultStep(run, name) : null;
  return {
    run: daemonRunToWeb(run, name),
    steps: fallback ? [fallback] : steps,
    ...(artifacts ? { artifacts } : {}),
    ...(placement ? { placement } : {}),
    ...(projectContext ? { projectContext } : {}),
    children,
  };
}

/** Raw run + steps fetch (workflow-run shape) used by the live SSE projection. */
export async function getRun(runId: string, teamId?: string): Promise<RunDetail | null> {
  const [r] = await db
    .select()
    .from(runs)
    .where(teamId ? and(eq(runs.id, runId), eq(runs.teamId, teamId)) : eq(runs.id, runId))
    .limit(1);
  if (!r) return null;
  const steps = await db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(runSteps.index);
  return { ...r, steps } as RunDetail;
}

async function childSummariesForRun(teamId: string, parentRunId: string) {
  const rows = await db
    .select()
    .from(runs)
    .where(and(eq(runs.teamId, teamId), eq(runs.parentRunId, parentRunId)))
    .orderBy(runs.createdAt);
  if (!rows.length) return [];
  const names = await agentNameMap(teamId);
  return rows.map((row) => ({
    id: row.id,
    parentRunId,
    agentId: row.agentId,
    agentName: row.agentId ? names.get(row.agentId) ?? row.agentId : null,
    status: row.status,
    kind: row.kind,
    startedAt: row.status === "queued" ? null : row.startedAt,
    endedAt: row.endedAt,
    result: resultSummary(row.result),
    error: row.error,
  }));
}

function resultSummary(result: unknown): string | null {
  if (typeof result === "string") return result.trim() || null;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    for (const key of ["result", "summary", "message"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

async function agentNameMap(teamId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.teamId, teamId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function workflowNameMap(teamId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: workflows.id, name: workflows.name })
    .from(workflows)
    .where(eq(workflows.teamId, teamId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function taskTitleMap(teamId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: projectTasks.id, title: projectTasks.title })
    .from(projectTasks)
    .where(eq(projectTasks.teamId, teamId));
  return new Map(rows.map((r) => [r.id, r.title]));
}
