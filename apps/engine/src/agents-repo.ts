import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { hub } from "./hub";
import { createAgentVersion, type CreateAgentVersionInput } from "./learning-repo";
import { DEFAULT_MEMORY_POLICY, DEFAULT_SKILL_POLICY, runtimeKindSchema } from "@agentik/workflow-schema";
import type { AgentTaskStatus } from "./db/schema";

const { agents, daemons, runtimes, agentTasks, taskMessages, runs, runSteps, workflows } = schema;

type AgentRowDb = typeof agents.$inferSelect;
type TaskRowDb = typeof agentTasks.$inferSelect;
type MsgRowDb = typeof taskMessages.$inferSelect;
type RunRowDb = typeof runs.$inferSelect;

/* ── Web contract shapes (mirror apps/web/types/domain.ts) ───────────── */

const ZERO_COST = {
  tokens: { input: 0, output: 0, total: 0 },
  money: { amountCents: 0, currency: "USD" as const },
};

type WebRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

const TASK_TO_RUN_STATUS: Record<AgentTaskStatus, WebRunStatus> = {
  queued: "queued",
  dispatched: "queued",
  running: "running",
  completed: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

/* ── Mappers ─────────────────────────────────────────────────────────── */

export function agentTaskToRun(task: TaskRowDb, agentName?: string) {
  return {
    id: task.id,
    teamId: task.teamId,
    env: "dev" as const,
    subject: { kind: "agent" as const, agentId: task.agentId, versionId: "ver_live" },
    subjectName: agentName ?? task.agentId,
    status: TASK_TO_RUN_STATUS[task.status],
    trigger: { kind: task.kind === "direct" ? ("api" as const) : ("manual" as const) },
    startedAt: task.startedAt ?? task.createdAt,
    endedAt: task.endedAt,
    durationMs: task.durationMs,
    cost: ZERO_COST,
    traceId: task.id,
    error: task.error ? { kind: "unknown" as const, message: task.error, traceId: task.id } : undefined,
    stepCount: task.stepCount,
    completedSteps: task.completedSteps,
  };
}

export function taskMessageToStep(msg: MsgRowDb, agentName?: string) {
  const base = {
    id: msg.id,
    runId: msg.taskId,
    index: msg.seq,
    startedAt: msg.createdAt,
    endedAt: msg.createdAt,
    durationMs: 0,
    cost: ZERO_COST,
    attempt: 1,
  };
  const t = msg.type;
  if (t === "tool_use" || t === "tool_result") {
    const tool = msg.tool ?? "tool";
    return {
      ...base,
      actor: { kind: "tool" as const, toolId: tool, name: tool },
      status: t === "tool_use" ? ("running" as const) : ("succeeded" as const),
      summary: t === "tool_use" ? `Calling ${tool}` : `${tool} → result`,
      toolCalls: [
        {
          id: msg.id,
          toolId: tool,
          action: tool,
          request: msg.input ?? {},
          response: msg.output ?? undefined,
          status: t === "tool_use" ? ("running" as const) : ("succeeded" as const),
        },
      ],
    };
  }
  return {
    ...base,
    actor: { kind: "agent" as const, agentId: "agt", name: agentName ?? "Agent" },
    status: t === "error" ? ("failed" as const) : ("succeeded" as const),
    summary: msg.content ?? (t === "thinking" ? "Thinking" : t),
    reasoning: t === "thinking" ? (msg.content ?? undefined) : undefined,
    toolCalls: [],
    ...(t === "error" ? { error: { kind: "unknown" as const, code: "error", message: msg.content ?? "error", retryable: false } } : {}),
  };
}

function workflowRunToRun(r: RunRowDb, wfName?: string) {
  return {
    id: r.id,
    teamId: r.teamId,
    env: "prod" as const,
    subject: { kind: "workflow" as const, workflowId: r.workflowId, versionId: r.versionId },
    subjectName: wfName ?? r.workflowId,
    status: r.status as WebRunStatus,
    trigger: { kind: r.trigger as "manual" | "webhook" | "schedule" | "api" },
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.durationMs,
    cost: ZERO_COST,
    traceId: r.id,
    error: r.error ? { kind: "unknown" as const, message: r.error, traceId: r.id } : undefined,
    stepCount: r.stepCount,
    completedSteps: r.completedSteps,
  };
}

type RunStepRowDb = typeof runSteps.$inferSelect;

function nodeActor(nodeType: string, nodeId: string, label: string) {
  if (nodeType === "tool") return { kind: "tool" as const, toolId: nodeId, name: label };
  if (nodeType === "agent") return { kind: "agent" as const, agentId: nodeId, name: label };
  if (["decision", "approval", "api", "code", "loop"].includes(nodeType)) {
    return { kind: nodeType as "decision" | "approval" | "api" | "code" | "loop", name: label };
  }
  return { kind: "code" as const, name: label };
}

function workflowStepToWebStep(s: RunStepRowDb) {
  return {
    id: s.id,
    runId: s.runId,
    index: s.index,
    nodeId: s.nodeId,
    actor: nodeActor(s.nodeType, s.nodeId, s.label),
    status: s.status,
    summary: s.label,
    toolCalls: [],
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMs: s.durationMs,
    cost: ZERO_COST,
    attempt: s.attempt,
    ...(s.error ? { error: { kind: "unknown" as const, code: "error", message: s.error, retryable: false } } : {}),
  };
}

/** Re-shape the engine's flat workflow RunDetail into the web's {run, steps}. */
export function workflowDetailToWeb(detail: RunRowDb & { steps: RunStepRowDb[] }, wfName?: string) {
  const { steps, ...run } = detail;
  return { run: workflowRunToRun(run, wfName), steps: steps.map(workflowStepToWebStep) };
}

/* ── Dev seed (idempotent) ───────────────────────────────────────────── */

const SEED_AGENTS = [
  { name: "Triage Agent", role: "Classifier", goal: "Route incoming tickets", runtimeKind: "echo" },
  { name: "Resolve Agent", role: "Resolver", goal: "Answer and close tickets", runtimeKind: "echo" },
  { name: "Scraper", role: "Collector", goal: "Extract data from pages", runtimeKind: "echo" },
];

/**
 * Populate a LEGACY dev team (one with no real org membership, e.g. the mock "acme")
 * with demo agents so the dev UI isn't empty. Real onboarded orgs always have ≥1
 * member (the owner) and are left EMPTY so the first-run empty states show and the
 * "zero mocked data" acceptance holds.
 */
export async function ensureDevAgents(teamId: string): Promise<void> {
  const [member] = await db
    .select({ id: schema.orgMembers.id })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.teamId, teamId))
    .limit(1);
  if (member) return; // real org — never seed mock data
  const existing = await db.select({ id: agents.id }).from(agents).where(eq(agents.teamId, teamId)).limit(1);
  if (existing[0]) return;
  await db.insert(agents).values(
    SEED_AGENTS.map((a) => ({ id: genId("agt"), teamId, name: a.name, role: a.role, goal: a.goal, runtimeKind: a.runtimeKind, health: "idle" as const })),
  );
}

/* ── Agents list + presence ──────────────────────────────────────────── */

function agentModel(a: AgentRowDb): string {
  const cfg = a.config as { model?: { model?: string } } | null;
  return cfg?.model?.model ?? a.runtimeKind;
}

export async function listAgentRows(teamId: string) {
  await ensureDevAgents(teamId);
  const rows = await db.select().from(agents).where(eq(agents.teamId, teamId)).orderBy(desc(agents.updatedAt));
  const tasks = await db
    .select({ agentId: agentTasks.agentId, status: agentTasks.status, durationMs: agentTasks.durationMs, createdAt: agentTasks.createdAt })
    .from(agentTasks)
    .where(eq(agentTasks.teamId, teamId));

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  return rows.map((a) => {
    const mine = tasks.filter((t) => t.agentId === a.id);
    const completed = mine.filter((t) => t.status === "completed");
    const failed = mine.filter((t) => t.status === "failed");
    const finished = completed.length + failed.length;
    const durations = completed.map((t) => t.durationMs ?? 0).filter((d) => d > 0);
    const lastRunAt = mine.reduce<string | null>((max, t) => (!max || t.createdAt > max ? t.createdAt : max), null);
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
      liveVersionId: a.liveVersionId,
      draftVersionId: a.draftVersionId,
      stats: {
        lastRunAt,
        successRate: finished ? completed.length / finished : 0,
        avgLatencyMs: durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0,
        avgCost: { amountCents: 0, currency: "USD" as const },
        runs24h: mine.filter((t) => t.createdAt >= dayAgo).length,
      },
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      createdBy: "usr_system",
      model: agentModel(a),
    };
  });
}

/** Single aggregate that backs live agent presence (availability × workload). */
export async function getAgentTaskSnapshot(teamId: string) {
  await ensureDevAgents(teamId);
  const [agentRows, daemonRows, runtimeRows, activeTasks] = await Promise.all([
    db.select({ id: agents.id, name: agents.name, runtimeKind: agents.runtimeKind, maxConcurrentTasks: agents.maxConcurrentTasks, health: agents.health }).from(agents).where(eq(agents.teamId, teamId)),
    db.select({ id: daemons.id, name: daemons.name, status: daemons.status, lastHeartbeatAt: daemons.lastHeartbeatAt }).from(daemons).where(eq(daemons.teamId, teamId)),
    db.select({ id: runtimes.id, daemonId: runtimes.daemonId, kind: runtimes.kind, status: runtimes.status }).from(runtimes).where(eq(runtimes.teamId, teamId)),
    db.select({ id: agentTasks.id, agentId: agentTasks.agentId, status: agentTasks.status }).from(agentTasks).where(and(eq(agentTasks.teamId, teamId), inArray(agentTasks.status, ["queued", "dispatched", "running"]))),
  ]);
  return { agents: agentRows, daemons: daemonRows, runtimes: runtimeRows, activeTasks };
}

/* ── System info (daemons, runtimes, detected CLIs) ──────────────────── */

export async function getSystemInfo(teamId: string) {
  const [daemonRows, runtimeRows] = await Promise.all([
    db.select().from(daemons).where(eq(daemons.teamId, teamId)),
    db.select({ id: runtimes.id, daemonId: runtimes.daemonId, kind: runtimes.kind, status: runtimes.status }).from(runtimes).where(eq(runtimes.teamId, teamId)),
  ]);
  // Derive liveness from heartbeat freshness (daemon beats every ~5s).
  const STALE_MS = 15_000;
  const now = Date.now();
  const liveStatus = (hb: string | null): "online" | "offline" => {
    if (!hb) return "offline";
    // Postgres emits a 2-digit offset ("+00"); Date.parse needs "+00:00".
    const ts = Date.parse(hb.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
    return !Number.isNaN(ts) && now - ts <= STALE_MS ? "online" : "offline";
  };
  return {
    daemons: daemonRows.map((d) => ({
      id: d.id,
      name: d.name,
      status: liveStatus(d.lastHeartbeatAt),
      lastHeartbeatAt: d.lastHeartbeatAt,
      meta: d.meta ?? {},
    })),
    runtimes: runtimeRows,
  };
}

/* ── Runs (union: workflow runs ⨄ agent tasks) ───────────────────────── */

export async function listRunsUnion(teamId: string, filters: { status?: string; agentId?: string }) {
  // Agent tasks
  const taskWheres = [eq(agentTasks.teamId, teamId)];
  if (filters.agentId) taskWheres.push(eq(agentTasks.agentId, filters.agentId));
  const tasks = await db.select().from(agentTasks).where(and(...taskWheres)).orderBy(desc(agentTasks.createdAt)).limit(200);
  const agentNames = await agentNameMap(teamId);
  let items: Array<ReturnType<typeof agentTaskToRun> | ReturnType<typeof workflowRunToRun>> = tasks.map(
    (t) => agentTaskToRun(t, agentNames.get(t.agentId)),
  );

  // Workflow runs (skip when filtering by agentId — those are agent-only)
  if (!filters.agentId) {
    const wfRuns = await db.select().from(runs).where(eq(runs.teamId, teamId)).orderBy(desc(runs.startedAt)).limit(200);
    const wfNames = await workflowNameMap(teamId);
    items = items.concat(wfRuns.map((r) => workflowRunToRun(r, wfNames.get(r.workflowId))));
  }

  if (filters.status) items = items.filter((r) => r.status === filters.status);
  items.sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0));
  return items;
}

/** Branch on id prefix: workflow run vs agent task. Tenancy-scoped by teamId. */
export async function getRunUnified(teamId: string, id: string) {
  if (id.startsWith("atask_")) {
    const [task] = await db
      .select()
      .from(agentTasks)
      .where(and(eq(agentTasks.id, id), eq(agentTasks.teamId, teamId)))
      .limit(1);
    if (!task) return null;
    const msgs = await db.select().from(taskMessages).where(eq(taskMessages.taskId, id)).orderBy(taskMessages.seq);
    const names = await agentNameMap(task.teamId);
    const name = names.get(task.agentId);
    return { run: agentTaskToRun(task, name), steps: msgs.map((m) => taskMessageToStep(m, name)) };
  }
  return null; // workflow runs handled by the existing getRun() in repo.ts
}

async function agentNameMap(teamId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.teamId, teamId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function workflowNameMap(teamId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: workflows.id, name: workflows.name }).from(workflows).where(eq(workflows.teamId, teamId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/* ── Agent CRUD + test run ───────────────────────────────────────────── */

export async function createAgent(teamId: string, input: { name: string; role?: string; goal?: string; tags?: string[] }) {
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

/** Map the web's free-form config jsonb onto an immutable version's typed fields. */
function configToVersionInput(config: unknown, fallbackRuntime: string): CreateAgentVersionInput {
  const cfg = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const m = cfg.model;
  const model =
    typeof m === "string"
      ? m
      : m && typeof m === "object" && typeof (m as { model?: unknown }).model === "string"
        ? (m as { model: string }).model
        : undefined;
  const rk = runtimeKindSchema.safeParse(cfg.runtimeKind ?? fallbackRuntime);
  return {
    model,
    instructions: typeof cfg.instructions === "string" ? cfg.instructions : "",
    tools: Array.isArray(cfg.tools) ? cfg.tools.filter((t): t is string => typeof t === "string") : [],
    runtimeKind: rk.success ? rk.data : "echo",
    memoryPolicy: DEFAULT_MEMORY_POLICY,
    skillPolicy: DEFAULT_SKILL_POLICY,
    createdBy: "user",
  };
}

/** Publish → write an IMMUTABLE agent_versions row (monotonic), repoint liveVersionId. */
export async function publishAgent(teamId: string, agentId: string, config: unknown, changelog?: string) {
  const [agent] = await db
    .select({ runtimeKind: agents.runtimeKind })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return null;
  const versionInput = configToVersionInput(config, agent.runtimeKind);
  const created = await createAgentVersion(teamId, agentId, { ...versionInput, changelog });
  if (!created) return null;
  // Point liveVersionId at the immutable version AND sync the agent's runtime_kind to the
  // published version — claimTask matches tasks to runtimes on agents.runtime_kind, so a
  // claude version must flip the agent off "echo" or the wrong runtime would claim its runs.
  await db
    .update(agents)
    .set({
      liveVersionId: created.id,
      runtimeKind: versionInput.runtimeKind,
      config: (config ?? {}) as Record<string, unknown>,
      health: "healthy",
      updatedAt: sql`now()`,
    })
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)));
  return { versionId: created.id, version: created.version, status: "published" as const };
}

/**
 * Enqueue a real run of a PUBLISHED agent (Golden Path step 3). A daemon advertising the
 * agent's runtime claims it and the engine injects the agent's approved memory/skills into
 * the task at claim time. Returns {error} if the agent isn't published yet.
 */
export async function runAgent(teamId: string, agentId: string, input: string) {
  const [agent] = await db
    .select({ id: agents.id, liveVersionId: agents.liveVersionId })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return null;
  if (!agent.liveVersionId) return { error: "not_published" as const };
  const taskId = genId("atask");
  await db.insert(agentTasks).values({ id: taskId, teamId, agentId, status: "queued", kind: "chat", input: { prompt: input } });
  hub.publish(teamId, { kind: "run", action: "created", runId: taskId });
  return { runId: taskId };
}

/** Create a queued sandbox task and return its id as a runId. The runtime
 * (echo|claude) selects which daemon runtime picks it up. */
export async function createTestTask(teamId: string, config: unknown, input: string, runtime = "echo") {
  await ensureDevAgents(teamId);
  // Per-team, per-runtime sandbox agent so the task is claimable by that runtime.
  const name = `Sandbox (${runtime})`;
  let [sandbox] = await db.select().from(agents).where(and(eq(agents.teamId, teamId), eq(agents.name, name))).limit(1);
  if (!sandbox) {
    const id = genId("agt");
    [sandbox] = await db.insert(agents).values({ id, teamId, name, role: "Test", goal: "Sandbox test runs", runtimeKind: runtime, health: "idle" }).returning();
  }
  const taskId = genId("atask");
  await db.insert(agentTasks).values({ id: taskId, teamId, agentId: sandbox!.id, status: "queued", kind: "direct", input: { prompt: input, config } });
  hub.publish(teamId, { kind: "run", action: "created", runId: taskId });
  return { runId: taskId };
}

/** Cancel an agent task (workflow runs handled elsewhere). Tenancy-scoped. Returns true if flipped. */
export async function cancelAgentTask(teamId: string, id: string): Promise<boolean> {
  if (!id.startsWith("atask_")) return false;
  const updated = await db
    .update(agentTasks)
    .set({ status: "cancelled", endedAt: sql`now()` })
    .where(and(eq(agentTasks.id, id), eq(agentTasks.teamId, teamId), inArray(agentTasks.status, ["queued", "dispatched", "running"])))
    .returning({ id: agentTasks.id, teamId: agentTasks.teamId });
  if (!updated[0]) return false;
  hub.publish(updated[0].teamId, { kind: "run", action: "cancelled", runId: id });
  return true;
}
