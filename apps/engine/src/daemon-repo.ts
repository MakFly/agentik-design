import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { resolveTeam } from "./repo";
import { hub } from "./hub";
import { buildInjectionPreamble, resolveInjectionContext, type InjectionContext } from "./learning-repo";
import type { TaskMessageType } from "./db/schema";

const { daemons, runtimes, agentTasks, taskMessages } = schema;

/** Messages that count as a completed step (vs an in-flight tool_use). */
const TERMINAL_MSG: TaskMessageType[] = ["text", "tool_result", "error"];

export interface RegisterInput {
  /** Slug (legacy shared-token path). Ignored when teamId is provided. */
  team?: string;
  /** Team resolved server-side from an org-scoped daemon token (preferred). */
  teamId?: string;
  name: string;
  meta?: Record<string, unknown>;
  runtimes: Array<{ kind: string; capabilities?: { maxConcurrent?: number; agentKinds?: string[] } }>;
}

export async function registerDaemon(input: RegisterInput) {
  const teamId = input.teamId ?? (input.team ? await resolveTeam(input.team) : null);
  if (!teamId) throw new Error("register: no team resolved");

  const [existing] = await db
    .select()
    .from(daemons)
    .where(and(eq(daemons.teamId, teamId), eq(daemons.name, input.name)))
    .limit(1);

  let daemonId: string;
  if (existing) {
    daemonId = existing.id;
    await db
      .update(daemons)
      .set({ status: "online", lastHeartbeatAt: sql`now()`, meta: input.meta ?? null })
      .where(eq(daemons.id, daemonId));
    await db.delete(runtimes).where(eq(runtimes.daemonId, daemonId));
  } else {
    daemonId = genId("daemon");
    await db.insert(daemons).values({ id: daemonId, teamId, name: input.name, status: "online", lastHeartbeatAt: sql`now()`, meta: input.meta ?? null });
  }

  const created = await db
    .insert(runtimes)
    .values(input.runtimes.map((r) => ({ id: genId("runtime"), daemonId, teamId, kind: r.kind, status: "online" as const, capabilities: r.capabilities ?? null })))
    .returning({ id: runtimes.id, kind: runtimes.kind });

  hub.publish(teamId, { kind: "presence" });
  return { daemonId, teamId, runtimes: created };
}

export async function heartbeat(daemonId: string): Promise<boolean> {
  const updated = await db
    .update(daemons)
    .set({ status: "online", lastHeartbeatAt: sql`now()` })
    .where(eq(daemons.id, daemonId))
    .returning({ id: daemons.id, teamId: daemons.teamId });
  if (!updated[0]) return false;
  await db.update(runtimes).set({ status: "online" }).where(eq(runtimes.daemonId, daemonId));
  hub.publish(updated[0].teamId, { kind: "presence" });
  return true;
}

export interface ClaimedTask {
  id: string;
  teamId: string;
  agentId: string;
  kind: string;
  input: unknown;
  workDir: string;
  /** Bounded learned context the engine injected for this run (also folded into input.prompt). */
  context?: InjectionContext;
}

/**
 * Atomically claim the next queued task for a runtime. `FOR UPDATE SKIP LOCKED`
 * guarantees two daemons never grab the same row. Only tasks whose agent runs on
 * this runtime's kind are eligible.
 */
export async function claimTask(runtimeId: string): Promise<ClaimedTask | null> {
  const [rt] = await db.select().from(runtimes).where(eq(runtimes.id, runtimeId)).limit(1);
  if (!rt) return null;

  const result = await db.execute(sql`
    WITH next AS (
      SELECT at.id
      FROM ${agentTasks} at
      JOIN ${schema.agents} a ON a.id = at.agent_id
      WHERE at.team_id = ${rt.teamId} AND at.status = 'queued' AND a.runtime_kind = ${rt.kind}
      ORDER BY at.priority DESC, at.created_at ASC
      FOR UPDATE OF at SKIP LOCKED
      LIMIT 1
    )
    UPDATE ${agentTasks} t
    SET status = 'dispatched', runtime_id = ${runtimeId}, daemon_id = ${rt.daemonId},
        dispatched_at = now(), work_dir = '/work/' || t.id
    FROM next
    WHERE t.id = next.id
    RETURNING t.id AS "id", t.team_id AS "teamId", t.agent_id AS "agentId",
              t.kind AS "kind", t.input AS "input", t.work_dir AS "workDir";
  `);

  const rows = result as unknown as ClaimedTask[];
  const task = rows[0] ?? null;
  if (task) {
    // Phase E injection: resolve bounded memory/skills per the agent's live-version policy
    // and fold them into the prompt the runtime receives (the daemon reads input.prompt).
    const ctx = await resolveInjectionContext(task.teamId, task.agentId);
    const preamble = buildInjectionPreamble(ctx);
    if (preamble) {
      const input = (task.input && typeof task.input === "object" ? task.input : {}) as Record<string, unknown>;
      const prompt = typeof input.prompt === "string" ? input.prompt : "";
      task.input = { ...input, prompt: preamble + prompt };
    }
    task.context = ctx;
    hub.publish(task.teamId, { kind: "run", action: "dispatched", runId: task.id });
  }
  return task;
}

export async function startTask(taskId: string): Promise<boolean> {
  const updated = await db
    .update(agentTasks)
    .set({ status: "running", startedAt: sql`now()` })
    .where(and(eq(agentTasks.id, taskId), inArray(agentTasks.status, ["queued", "dispatched"])))
    .returning({ id: agentTasks.id, teamId: agentTasks.teamId });
  if (!updated[0]) return false;
  hub.publish(updated[0].teamId, { kind: "run", action: "running", runId: taskId });
  return true;
}

export interface IncomingMessage {
  seq: number;
  type: TaskMessageType;
  tool?: string;
  content?: string;
  input?: unknown;
  output?: unknown;
}

/**
 * Append a batch of streamed messages (idempotent on (taskId, seq)), recompute
 * progress counters, and tell the daemon whether the task was cancelled meanwhile.
 */
export async function appendMessages(taskId: string, messages: IncomingMessage[]): Promise<{ cancel: boolean }> {
  if (messages.length > 0) {
    await db
      .insert(taskMessages)
      .values(messages.map((m) => ({ id: genId("amsg"), taskId, seq: m.seq, type: m.type, tool: m.tool ?? null, content: m.content ?? null, input: m.input ?? null, output: m.output ?? null })))
      .onConflictDoNothing({ target: [taskMessages.taskId, taskMessages.seq] });

    const all = await db.select({ type: taskMessages.type }).from(taskMessages).where(eq(taskMessages.taskId, taskId));
    const completed = all.filter((m) => TERMINAL_MSG.includes(m.type)).length;
    await db.update(agentTasks).set({ stepCount: all.length, completedSteps: completed }).where(eq(agentTasks.id, taskId));
  }

  const [task] = await db.select({ status: agentTasks.status, teamId: agentTasks.teamId, stepCount: agentTasks.stepCount, completedSteps: agentTasks.completedSteps }).from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1);
  if (task && messages.length > 0) {
    hub.publish(task.teamId, { kind: "run.progress", runId: taskId, completedSteps: task.completedSteps, stepCount: task.stepCount });
  }
  return { cancel: task?.status === "cancelled" };
}

export async function completeTask(taskId: string, result: unknown): Promise<boolean> {
  const updated = await db
    .update(agentTasks)
    .set({
      status: "completed",
      result: (result ?? null) as Record<string, unknown> | null,
      endedAt: sql`now()`,
      durationMs: sql`(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::int`,
      completedSteps: sql`${agentTasks.stepCount}`,
    })
    .where(and(eq(agentTasks.id, taskId), inArray(agentTasks.status, ["dispatched", "running"])))
    .returning({ id: agentTasks.id, teamId: agentTasks.teamId });
  if (!updated[0]) return false;
  hub.publish(updated[0].teamId, { kind: "run", action: "succeeded", runId: taskId });
  return true;
}

export async function failTask(taskId: string, error: string): Promise<boolean> {
  const updated = await db
    .update(agentTasks)
    .set({
      status: "failed",
      error,
      endedAt: sql`now()`,
      durationMs: sql`(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::int`,
    })
    .where(and(eq(agentTasks.id, taskId), inArray(agentTasks.status, ["dispatched", "running"])))
    .returning({ id: agentTasks.id, teamId: agentTasks.teamId });
  if (!updated[0]) return false;
  hub.publish(updated[0].teamId, { kind: "run", action: "failed", runId: taskId });
  return true;
}
