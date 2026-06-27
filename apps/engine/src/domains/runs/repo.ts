import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import {
  artifactsFromRun,
  daemonDisplayName,
  daemonRunToWeb,
  fallbackResultStep,
  runMessageToStep,
  workflowRunToRun,
  workflowStepToWebStep,
  type DaemonRunRowDb,
  type RunMsgRowDb,
} from "./mappers";

export type { WebRunStatus, DaemonRunRowDb, RunMsgRowDb } from "./mappers";
export {
  daemonRunToWeb,
  runMessageToStep,
  workflowDetailToWeb,
} from "./mappers";

const {
  agents,
  daemons,
  runtimes,
  chatSessions,
  runs,
  runMessages,
  memoryEntries,
  runReviews,
  runSteps,
  workflows,
  projects,
  projectResources,
  projectTasks,
  projectWorkspaces,
} = schema;

type AgentRowDb = typeof agents.$inferSelect;
type AgentStatsRunRow = Pick<
  DaemonRunRowDb,
  "agentId" | "status" | "durationMs" | "createdAt"
>;

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
    runtimeKind: runtime?.kind ?? agent?.runtimeKind ?? "echo",
    runtimeId: task.runtimeId ?? null,
    daemonId,
    daemonName: daemonDisplayName(daemon),
    pinned: Boolean(agent?.preferredDaemonId),
  };
}

export async function getAgentPlacementLabel(teamId: string, agentId: string) {
  const [agent] = await db
    .select({
      runtimeKind: agents.runtimeKind,
      preferredDaemonId: agents.preferredDaemonId,
    })
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)))
    .limit(1);
  if (!agent) return null;
  if (!agent.preferredDaemonId) {
    return `${agent.runtimeKind} · any compatible computer`;
  }
  const [daemon] = await db
    .select({
      id: daemons.id,
      name: daemons.name,
      meta: daemons.meta,
    })
    .from(daemons)
    .where(and(eq(daemons.teamId, teamId), eq(daemons.id, agent.preferredDaemonId)))
    .limit(1);
  return `${agent.runtimeKind} · ${daemonDisplayName(daemon) ?? agent.preferredDaemonId} · pinned`;
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

const SEED_AGENTS = [
  {
    name: "Triage Agent",
    role: "Classifier",
    goal: "Route incoming tickets",
    runtimeKind: "echo",
  },
  {
    name: "Resolve Agent",
    role: "Resolver",
    goal: "Answer and close tickets",
    runtimeKind: "echo",
  },
  {
    name: "Scraper",
    role: "Collector",
    goal: "Extract data from pages",
    runtimeKind: "echo",
  },
];

export async function ensureDevAgents(teamId: string): Promise<void> {
  const [member] = await db
    .select({ id: schema.orgMembers.id })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.teamId, teamId))
    .limit(1);
  if (member) return;
  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.teamId, teamId))
    .limit(1);
  if (existing[0]) return;
  await db.insert(agents).values(
    SEED_AGENTS.map((a) => ({
      id: genId("agt"),
      teamId,
      name: a.name,
      role: a.role,
      goal: a.goal,
      runtimeKind: a.runtimeKind,
      health: "idle" as const,
    })),
  );
}

function agentModel(a: AgentRowDb): string {
  const cfg = a.config as { model?: { model?: string } } | null;
  return cfg?.model?.model ?? a.runtimeKind;
}

function toAgentRow(a: AgentRowDb, tasks: AgentStatsRunRow[]) {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const mine = tasks.filter((t) => t.agentId === a.id);
  const completed = mine.filter((t) => t.status === "succeeded");
  const failed = mine.filter((t) => t.status === "failed");
  const finished = completed.length + failed.length;
  const durations = completed
    .map((t) => t.durationMs ?? 0)
    .filter((d) => d > 0);
  const lastRunAt = mine.reduce<string | null>(
    (max, t) => (!max || t.createdAt > max ? t.createdAt : max),
    null,
  );
  return {
    id: a.id,
    teamId: a.teamId,
    name: a.name,
    role: a.role,
    goal: a.goal,
    description: a.description ?? undefined,
    tags: a.tags,
    owner: "usr_system",
    health: a.health,
    runtimeKind: a.runtimeKind,
    preferredDaemonId: a.preferredDaemonId,
    liveVersionId: a.liveVersionId,
    draftVersionId: a.draftVersionId,
    stats: {
      lastRunAt,
      successRate: finished ? completed.length / finished : 0,
      avgLatencyMs: durations.length
        ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
        : 0,
      avgCost: { amountCents: 0, currency: "USD" as const },
      runs24h: mine.filter((t) => t.createdAt >= dayAgo).length,
    },
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    createdBy: "usr_system",
    model: agentModel(a),
  };
}

export async function listAgentRows(teamId: string) {
  await ensureDevAgents(teamId);
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.teamId, teamId))
    .orderBy(desc(agents.updatedAt));
  const tasks = await db
    .select({
      agentId: runs.agentId,
      status: runs.status,
      durationMs: runs.durationMs,
      createdAt: runs.createdAt,
    })
    .from(runs)
    .where(and(eq(runs.teamId, teamId), eq(runs.executor, "daemon")));

  return rows.map((a) => toAgentRow(a, tasks));
}

export async function getAgentRow(teamId: string, agentId: string) {
  await ensureDevAgents(teamId);
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)))
    .limit(1);
  if (!row) return null;
  const tasks = await db
    .select({
      agentId: runs.agentId,
      status: runs.status,
      durationMs: runs.durationMs,
      createdAt: runs.createdAt,
    })
    .from(runs)
    .where(and(eq(runs.teamId, teamId), eq(runs.agentId, agentId)));
  return toAgentRow(row, tasks);
}

export async function getAgentTaskSnapshot(teamId: string) {
  await ensureDevAgents(teamId);
  const [agentRows, daemonRows, runtimeRows, activeTasks] = await Promise.all([
    db
      .select({
        id: agents.id,
        name: agents.name,
        runtimeKind: agents.runtimeKind,
        maxConcurrentTasks: agents.maxConcurrentTasks,
        health: agents.health,
      })
      .from(agents)
      .where(eq(agents.teamId, teamId)),
    db
      .select({
        id: daemons.id,
        name: daemons.name,
        status: daemons.status,
        lastHeartbeatAt: daemons.lastHeartbeatAt,
      })
      .from(daemons)
      .where(eq(daemons.teamId, teamId)),
    db
      .select({
        id: runtimes.id,
        daemonId: runtimes.daemonId,
        kind: runtimes.kind,
        status: runtimes.status,
      })
      .from(runtimes)
      .where(eq(runtimes.teamId, teamId)),
    db
      .select({
        id: runs.id,
        agentId: runs.agentId,
        status: runs.status,
      })
      .from(runs)
      .where(
        and(
          eq(runs.teamId, teamId),
          inArray(runs.status, ["queued", "running"]),
        ),
      ),
  ]);
  return {
    agents: agentRows,
    daemons: daemonRows,
    runtimes: runtimeRows,
    activeTasks,
  };
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
  let items = rows.map((r) =>
    r.executor === "daemon"
      ? daemonRunToWeb(r, r.agentId ? agentNames.get(r.agentId) : undefined)
      : workflowRunToRun(r, r.workflowId ? wfNames.get(r.workflowId) : undefined),
  );
  if (filters.status) items = items.filter((r) => r.status === filters.status);
  items.sort((a, b) =>
    b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0,
  );
  return items;
}

export async function getRunDetail(teamId: string, id: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.teamId, teamId)))
    .limit(1);
  if (!run) return null;
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
  const steps = msgs.map((m) => runMessageToStep(m, name));
  const fallback = steps.length === 0 ? fallbackResultStep(run, name) : null;
  return {
    run: daemonRunToWeb(run, name),
    steps: fallback ? [fallback] : steps,
    ...(artifacts ? { artifacts } : {}),
    ...(placement ? { placement } : {}),
    ...(projectContext ? { projectContext } : {}),
  };
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

export async function createAgent(
  teamId: string,
  input: { name: string; role?: string; goal?: string; tags?: string[] },
) {
  const id = genId("agt");
  const draftVersionId = genId("ver");
  await db.insert(agents).values({
    id,
    teamId,
    name: input.name,
    role: input.role ?? "",
    goal: input.goal ?? "",
    tags: input.tags ?? [],
    draftVersionId,
    health: "idle",
  });
  return { id, draftVersionId };
}

export async function deleteAgent(teamId: string, agentId: string) {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)))
    .limit(1);
  if (!agent) return false;

  const taskRows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.teamId, teamId), eq(runs.agentId, agent.id)));
  const taskIds = taskRows.map((r) => r.id);
  if (taskIds.length > 0) {
    await db.delete(runReviews).where(
      and(eq(runReviews.teamId, teamId), inArray(runReviews.runId, taskIds)),
    );
    await db.delete(runMessages).where(inArray(runMessages.runId, taskIds));
    await db
      .delete(runs)
      .where(and(eq(runs.teamId, teamId), eq(runs.agentId, agent.id)));
  }

  await db
    .update(projectTasks)
    .set({ assignedAgentId: null })
    .where(
      and(eq(projectTasks.teamId, teamId), eq(projectTasks.assignedAgentId, agent.id)),
    );

  await db
    .delete(chatSessions)
    .where(
      and(eq(chatSessions.teamId, teamId), eq(chatSessions.agentId, agent.id)),
    );

  await db
    .update(projects)
    .set({ leadAgentId: null })
    .where(and(eq(projects.teamId, teamId), eq(projects.leadAgentId, agent.id)));

  await db
    .delete(memoryEntries)
    .where(
      and(
        eq(memoryEntries.teamId, teamId),
        eq(memoryEntries.scope, "agent"),
        eq(memoryEntries.targetId, agent.id),
      ),
    );

  await db
    .delete(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agent.id)));
  return true;
}
