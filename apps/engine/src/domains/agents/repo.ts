import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { daemonDisplayName } from "../runs/mappers";
import type { DaemonRunRowDb } from "../runs/mappers";

export { publishAgent, runAgent, createTestTask } from "../runs/service";

const {
  agents,
  daemons,
  runtimes,
  runs,
  runMessages,
  runReviews,
  chatSessions,
  projects,
  projectTasks,
  memoryEntries,
} = schema;

type AgentRowDb = typeof agents.$inferSelect;
type AgentStatsRunRow = Pick<
  DaemonRunRowDb,
  "agentId" | "status" | "durationMs" | "createdAt"
>;

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
