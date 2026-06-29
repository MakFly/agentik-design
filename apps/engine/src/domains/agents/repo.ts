import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { daemonDisplayName, runCostFromRow } from "../runs/mappers";
import type { DaemonRunRowDb } from "../runs/mappers";

export { publishAgent, runAgent, createTestTask } from "../runs/service";

const {
  agents,
  agentSubagents,
  assistantRules,
  channelBindings,
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
  "agentId" | "status" | "durationMs" | "createdAt" | "result" | "costCents"
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
  const finishedRuns = [...completed, ...failed];
  const finished = finishedRuns.length;
  const durations = completed
    .map((t) => t.durationMs ?? 0)
    .filter((d) => d > 0);
  const totalCostCents = finishedRuns.reduce(
    (sum, t) => sum + runCostFromRow(t).money.amountCents,
    0,
  );
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
    emoji: a.emoji ?? undefined,
    color: a.color ?? undefined,
    avatarUrl: a.avatarUrl ?? undefined,
    isOrchestrator: a.isOrchestrator,
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
      avgCost: {
        amountCents: finished ? Math.round(totalCostCents / finished) : 0,
        currency: "USD" as const,
      },
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
      result: runs.result,
      costCents: runs.costCents,
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
      result: runs.result,
      costCents: runs.costCents,
    })
    .from(runs)
    .where(and(eq(runs.teamId, teamId), eq(runs.agentId, agentId)));
  // Detail-only: surface the full published AgentConfig so the web edit flow restores the
  // real systemPrompt/tools/model/limits instead of falling back to defaults and overwriting
  // them on republish. agent_versions stores only normalized fields, so the full config lives
  // in agents.config (written atomically with the live version at publish; the draft otherwise).
  return { ...toAgentRow(row, tasks), config: row.config ?? null };
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

export type CreateAgentInput = {
  name: string;
  role?: string;
  goal?: string;
  description?: string;
  tags?: string[];
  emoji?: string;
  color?: string;
  avatarUrl?: string;
  isOrchestrator?: boolean;
  /** When present the agent is created AND published (v1) atomically. */
  config?: unknown;
};

/** Thrown to roll back an atomic create+publish when the embedded publish is rejected. */
export class AgentPublishError extends Error {
  constructor(readonly reason: "daemon_not_found" | "daemon_missing_runtime") {
    super(reason);
    this.name = "AgentPublishError";
  }
}

export async function createAgent(
  teamId: string,
  input: CreateAgentInput,
): Promise<{ id: string; draftVersionId: string; version?: number }> {
  const id = genId("agt");
  const draftVersionId = genId("ver");
  const values = {
    id,
    teamId,
    name: input.name,
    role: input.role ?? "",
    goal: input.goal ?? "",
    description: input.description ?? null,
    tags: input.tags ?? [],
    emoji: input.emoji ?? null,
    color: input.color ?? null,
    avatarUrl: input.avatarUrl ?? null,
    isOrchestrator: input.isOrchestrator ?? false,
    draftVersionId,
    health: "idle" as const,
  };

  if (input.config === undefined) {
    await db.insert(agents).values(values);
    return { id, draftVersionId };
  }

  // Create + publish v1 in one transaction so a failed publish never leaves an orphan draft.
  const { publishAgentInTx } = await import("../runs/service");
  return db.transaction(async (tx) => {
    await tx.insert(agents).values(values);
    const published = await publishAgentInTx(tx, teamId, id, input.config);
    if (published && "error" in published) throw new AgentPublishError(published.error);
    return { id, draftVersionId, version: published?.version };
  });
}

/** Patch an agent's identity / orchestration flag / draft config. Returns the toAgentRow shape. */
export async function updateAgent(teamId: string, agentId: string, input: Partial<CreateAgentInput>) {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.name !== undefined) set.name = input.name;
  if (input.role !== undefined) set.role = input.role;
  if (input.goal !== undefined) set.goal = input.goal;
  if (input.description !== undefined) set.description = input.description;
  if (input.tags !== undefined) set.tags = input.tags;
  if (input.emoji !== undefined) set.emoji = input.emoji;
  if (input.color !== undefined) set.color = input.color;
  if (input.avatarUrl !== undefined) set.avatarUrl = input.avatarUrl;
  if (input.isOrchestrator !== undefined) set.isOrchestrator = input.isOrchestrator;
  if (input.config !== undefined) set.config = input.config as Record<string, unknown>;

  const [row] = await db
    .update(agents)
    .set(set)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)))
    .returning({ id: agents.id });
  if (!row) return null;
  return getAgentRow(teamId, agentId);
}

export type RosterItemInput = { agentId: string; instruction?: string; position?: number };

/** Orchestrator roster (ordered subagents) with the subagent's display identity joined in. */
export async function getRoster(teamId: string, parentAgentId: string) {
  const rows = await db
    .select({
      agentId: agentSubagents.subagentId,
      name: agents.name,
      emoji: agents.emoji,
      color: agents.color,
      role: agents.role,
      instruction: agentSubagents.instruction,
      position: agentSubagents.position,
    })
    .from(agentSubagents)
    .innerJoin(agents, eq(agents.id, agentSubagents.subagentId))
    .where(
      and(
        eq(agentSubagents.teamId, teamId),
        eq(agentSubagents.parentAgentId, parentAgentId),
      ),
    )
    .orderBy(asc(agentSubagents.position));
  return rows.map((r) => ({
    agentId: r.agentId,
    name: r.name,
    emoji: r.emoji ?? undefined,
    color: r.color ?? undefined,
    role: r.role,
    instruction: r.instruction ?? undefined,
    position: r.position,
  }));
}

/**
 * Replace-set the roster of `parentAgentId`. Validates the parent and every subagent
 * belongs to the team and no edge points at the parent itself. Returns an error tag the
 * route maps to 400/404, otherwise the fresh roster.
 */
export async function setRoster(
  teamId: string,
  parentAgentId: string,
  items: RosterItemInput[],
): Promise<
  | { error: "parent_not_found" | "agent_not_found" | "self_reference" | "cycle" }
  | { roster: Awaited<ReturnType<typeof getRoster>> }
> {
  const teamAgentIds = new Set(
    (
      await db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.teamId, teamId))
    ).map((r) => r.id),
  );
  if (!teamAgentIds.has(parentAgentId)) return { error: "parent_not_found" };

  const seen = new Set<string>();
  const deduped = items.filter((it) => !seen.has(it.agentId) && seen.add(it.agentId));
  for (const it of deduped) {
    if (it.agentId === parentAgentId) return { error: "self_reference" };
    if (!teamAgentIds.has(it.agentId)) return { error: "agent_not_found" };
  }

  // Cycle guard: with the parent's edges replaced by `deduped`, no proposed subagent
  // may already reach the parent — otherwise parent→sub→…→parent loops forever.
  const edges = await db
    .select({ parent: agentSubagents.parentAgentId, sub: agentSubagents.subagentId })
    .from(agentSubagents)
    .where(eq(agentSubagents.teamId, teamId));
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (e.parent === parentAgentId) continue; // these get replaced
    const list = adjacency.get(e.parent) ?? [];
    list.push(e.sub);
    adjacency.set(e.parent, list);
  }
  const reachesParent = (start: string): boolean => {
    const queue = [start];
    const visited = new Set([start]);
    while (queue.length) {
      const node = queue.shift()!;
      if (node === parentAgentId) return true;
      for (const next of adjacency.get(node) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  for (const it of deduped) {
    if (reachesParent(it.agentId)) return { error: "cycle" };
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(agentSubagents)
      .where(
        and(
          eq(agentSubagents.teamId, teamId),
          eq(agentSubagents.parentAgentId, parentAgentId),
        ),
      );
    if (deduped.length) {
      await tx.insert(agentSubagents).values(
        deduped.map((it, idx) => ({
          id: genId("asub"),
          teamId,
          parentAgentId,
          subagentId: it.agentId,
          instruction: it.instruction ?? null,
          position: it.position ?? idx,
        })),
      );
    }
  });
  return { roster: await getRoster(teamId, parentAgentId) };
}

/** Whole-team agent graph: nodes + roster edges + recent run-tree edges (last 200 child runs). */
export async function getAgentGraph(teamId: string) {
  await ensureDevAgents(teamId);
  const [agentRows, rosterRows, runRows] = await Promise.all([
    db
      .select({
        id: agents.id,
        name: agents.name,
        emoji: agents.emoji,
        color: agents.color,
        role: agents.role,
        isOrchestrator: agents.isOrchestrator,
        health: agents.health,
      })
      .from(agents)
      .where(eq(agents.teamId, teamId)),
    db
      .select({
        parentAgentId: agentSubagents.parentAgentId,
        subagentId: agentSubagents.subagentId,
        instruction: agentSubagents.instruction,
      })
      .from(agentSubagents)
      .where(eq(agentSubagents.teamId, teamId)),
    db
      .select({ parentRunId: runs.parentRunId, childRunId: runs.id })
      .from(runs)
      .where(and(eq(runs.teamId, teamId), isNotNull(runs.parentRunId)))
      .orderBy(desc(runs.createdAt))
      .limit(200),
  ]);
  return {
    nodes: agentRows.map((a) => ({
      id: a.id,
      name: a.name,
      emoji: a.emoji ?? undefined,
      color: a.color ?? undefined,
      role: a.role,
      isOrchestrator: a.isOrchestrator,
      health: a.health,
    })),
    rosterEdges: rosterRows.map((r) => ({
      parentAgentId: r.parentAgentId,
      subagentId: r.subagentId,
      instruction: r.instruction ?? undefined,
    })),
    runEdges: runRows.map((r) => ({
      parentRunId: r.parentRunId as string,
      childRunId: r.childRunId,
    })),
  };
}

export async function deleteAgent(teamId: string, agentId: string) {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)))
    .limit(1);
  if (!agent) return null;

  // One transaction for the whole cascade: a mid-cascade failure must not leave a
  // half-deleted agent (orphaned runs/messages/reviews/sessions). Either it all
  // commits or none of it does.
  return db.transaction(async (tx) => {
    // Detach deterministic routes before the row vanishes so the count is exact (the FKs
    // are ON DELETE SET NULL, but we null explicitly to report how many were disabled).
    const clearedRules = await tx
      .update(assistantRules)
      .set({ targetAgentId: null, updatedAt: sql`now()` })
      .where(
        and(eq(assistantRules.teamId, teamId), eq(assistantRules.targetAgentId, agent.id)),
      )
      .returning({ id: assistantRules.id });
    const clearedBindings = await tx
      .update(channelBindings)
      .set({ agentId: null, updatedAt: sql`now()` })
      .where(
        and(eq(channelBindings.teamId, teamId), eq(channelBindings.agentId, agent.id)),
      )
      .returning({ id: channelBindings.id });

    const taskRows = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.teamId, teamId), eq(runs.agentId, agent.id)));
    const taskIds = taskRows.map((r) => r.id);
    if (taskIds.length > 0) {
      await tx.delete(runReviews).where(
        and(eq(runReviews.teamId, teamId), inArray(runReviews.runId, taskIds)),
      );
      await tx.delete(runMessages).where(inArray(runMessages.runId, taskIds));
      await tx
        .delete(runs)
        .where(and(eq(runs.teamId, teamId), eq(runs.agentId, agent.id)));
    }

    await tx
      .update(projectTasks)
      .set({ assignedAgentId: null })
      .where(
        and(eq(projectTasks.teamId, teamId), eq(projectTasks.assignedAgentId, agent.id)),
      );

    await tx
      .delete(chatSessions)
      .where(
        and(eq(chatSessions.teamId, teamId), eq(chatSessions.agentId, agent.id)),
      );

    await tx
      .update(projects)
      .set({ leadAgentId: null })
      .where(and(eq(projects.teamId, teamId), eq(projects.leadAgentId, agent.id)));

    await tx
      .delete(memoryEntries)
      .where(
        and(
          eq(memoryEntries.teamId, teamId),
          eq(memoryEntries.scope, "agent"),
          eq(memoryEntries.targetId, agent.id),
        ),
      );

    // agent_subagents rows (as parent OR child) cascade away with the agent row.
    await tx
      .delete(agents)
      .where(and(eq(agents.teamId, teamId), eq(agents.id, agent.id)));
    const disabled = clearedRules.length + clearedBindings.length;
    return {
      disabledRules: clearedRules.length,
      disabledBindings: clearedBindings.length,
      note: `${disabled} rules/bindings disabled`,
    };
  });
}
