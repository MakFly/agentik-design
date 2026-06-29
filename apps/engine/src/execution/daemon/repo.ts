import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { resolveTeam } from "../../domains/workflows/repo";
import { hub } from "../../infra/hub";
import {
  buildInjectionPreamble,
  resolveInjectionContext,
  type InjectionContext,
} from "../../domains/learning/index";
import { resolveRuntimeAuth } from "../../domains/settings/providers-repo";
import { liveRuntimeTools } from "../../domains/mcp/repo";
import type { RunMessageType, TaskErrorReason } from "../../infra/db/schema";
import type { RunStatus, RuntimeEventV2 } from "@agentik/workflow-schema";

const {
  daemons,
  runtimes,
  runs,
  runMessages,
  runEvents,
  projectTasks,
  projectResources,
  projectWorkspaces,
} = schema;

/** Messages that count as a completed step (vs an in-flight tool_use). */
const TERMINAL_MSG: RunMessageType[] = ["text", "tool_result", "error"];

export interface RegisterInput {
  /** Slug (legacy shared-token path). Ignored when teamId is provided. */
  team?: string;
  /** Team resolved server-side from an org-scoped daemon token (preferred). */
  teamId?: string;
  name: string;
  /** Prior display-names this machine may already be registered under (hostname →
   *  UUID transition). Matched when neither deviceId nor the current name hits. */
  legacyNames?: string[];
  meta?: Record<string, unknown>;
  runtimes: Array<{
    kind: string;
    capabilities?: { maxConcurrent?: number; agentKinds?: string[] };
  }>;
}

/** Keep a previously-stored deviceId when a re-register payload omits it, so a
 *  transient meta-less check-in can't strip the dedup key off an existing row. */
function preserveDeviceId(
  next: Record<string, unknown> | null,
  prev: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const prevId = (prev as { deviceId?: string } | null)?.deviceId;
  if (!next || (next as { deviceId?: string }).deviceId || !prevId) return next;
  return { ...next, deviceId: prevId };
}

export async function registerDaemon(input: RegisterInput) {
  const teamId =
    input.teamId ?? (input.team ? await resolveTeam(input.team) : null);
  if (!teamId) throw new Error("register: no team resolved");

  const deviceId =
    (input.meta as { deviceId?: string } | null)?.deviceId ?? null;

  // The whole register is atomic: matching, the daemon upsert, and the
  // delete+reinsert of runtimes must not interleave with a concurrent register.
  const { daemonId, created } = await db.transaction(async (tx) => {
    // Dedup on the stable machine identity (deviceId) when present — the display
    // `name` changes across daemon versions (hostname → persistent UUID). Fall
    // back to `name` so a legacy row (registered before deviceId existed) is
    // adopted and backfilled here instead of spawning a duplicate on the first
    // post-upgrade re-register.
    let existing =
      deviceId != null
        ? (
            await tx
              .select()
              .from(daemons)
              .where(
                and(
                  eq(daemons.teamId, teamId),
                  eq(sql`${daemons.meta}->>'deviceId'`, deviceId),
                ),
              )
              .limit(1)
          )[0]
        : undefined;
    if (!existing) {
      // Match the current name plus any legacy identities (e.g. the pre-UUID
      // hostname), so a host that upgraded its identity adopts its old row.
      const names = [input.name, ...(input.legacyNames ?? [])];
      existing = (
        await tx
          .select()
          .from(daemons)
          .where(and(eq(daemons.teamId, teamId), inArray(daemons.name, names)))
          .limit(1)
      )[0];
    }

    let id: string;
    if (existing) {
      id = existing.id;
      await tx
        .update(daemons)
        .set({
          name: input.name,
          status: "online",
          lastHeartbeatAt: sql`now()`,
          meta: preserveDeviceId(input.meta ?? null, existing.meta),
        })
        .where(eq(daemons.id, id));
      await tx.delete(runtimes).where(eq(runtimes.daemonId, id));
    } else {
      id = genId("daemon");
      await tx.insert(daemons).values({
        id,
        teamId,
        name: input.name,
        status: "online",
        lastHeartbeatAt: sql`now()`,
        meta: input.meta ?? null,
      });
    }

    const rows = await tx
      .insert(runtimes)
      .values(
        input.runtimes.map((r) => ({
          id: genId("runtime"),
          daemonId: id,
          teamId,
          kind: r.kind,
          status: "online" as const,
          capabilities: r.capabilities ?? null,
        })),
      )
      .returning({ id: runtimes.id, kind: runtimes.kind });

    return { daemonId: id, created: rows };
  });

  hub.publish(teamId, { kind: "presence" });
  return { daemonId, teamId, runtimes: created };
}

/** In-flight task statuses that block forgetting a daemon (would dangle their refs). */
const ACTIVE_TASK_STATUS: RunStatus[] = [
  "running",
  "paused",
  "waiting_approval",
];
/** A daemon is only "forgettable" once it has been silent past the online-flap
 *  window (engine marks offline at 15s); 120s also covers a few missed beats. */
const DELETE_MIN_OFFLINE_MS = 120_000;

export type DeleteDaemonResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "online" | "busy" };

/**
 * Forget a daemon from a team. Cascades remove its runtimes and bundle commands;
 * project workspaces null out their daemon link (agent_tasks keep informational,
 * FK-less refs). Scoped by teamId so a workspace can only drop its own machines.
 * Refuses a still-beating daemon or one with in-flight tasks — mirrors the UI's
 * offline-only affordance server-side so a brief blip can't zombie a live machine.
 */
export async function deleteDaemon(
  teamId: string,
  daemonId: string,
): Promise<DeleteDaemonResult> {
  const [row] = await db
    .select({ lastHeartbeatAt: daemons.lastHeartbeatAt })
    .from(daemons)
    .where(and(eq(daemons.id, daemonId), eq(daemons.teamId, teamId)))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };

  if (row.lastHeartbeatAt) {
    // Postgres emits a 2-digit offset ("+00"); Date.parse needs "+00:00".
    const ts = Date.parse(
      String(row.lastHeartbeatAt)
        .replace(" ", "T")
        .replace(/([+-]\d{2})$/, "$1:00"),
    );
    if (!Number.isNaN(ts) && Date.now() - ts < DELETE_MIN_OFFLINE_MS) {
      return { ok: false, reason: "online" };
    }
  }

  const [busy] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.daemonId, daemonId),
        inArray(runs.status, ACTIVE_TASK_STATUS),
      ),
    )
    .limit(1);
  if (busy) return { ok: false, reason: "busy" };

  await db
    .delete(daemons)
    .where(and(eq(daemons.id, daemonId), eq(daemons.teamId, teamId)));
  hub.publish(teamId, { kind: "presence" });
  return { ok: true };
}

export async function getDaemonTeamId(
  daemonId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ teamId: daemons.teamId })
    .from(daemons)
    .where(eq(daemons.id, daemonId))
    .limit(1);
  return row?.teamId ?? null;
}

export async function getRuntimeTeamId(
  runtimeId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ teamId: runtimes.teamId })
    .from(runtimes)
    .where(eq(runtimes.id, runtimeId))
    .limit(1);
  return row?.teamId ?? null;
}

export async function getTaskTeamId(runId: string): Promise<string | null> {
  const [row] = await db
    .select({ teamId: runs.teamId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return row?.teamId ?? null;
}

/**
 * Refresh just a daemon's meta (probed CLIs/host) without touching its runtimes —
 * used after a bundle install/uninstall so a newly available CLI shows up immediately,
 * with no runtime-id churn (register() deletes+reinserts runtimes; this doesn't).
 */
export async function updateDaemonMeta(
  daemonId: string,
  meta: Record<string, unknown>,
): Promise<boolean> {
  const updated = await db
    .update(daemons)
    .set({ meta })
    .where(eq(daemons.id, daemonId))
    .returning({ id: daemons.id, teamId: daemons.teamId });
  if (!updated[0]) return false;
  hub.publish(updated[0].teamId, { kind: "presence" });
  return true;
}

export async function heartbeat(daemonId: string): Promise<boolean> {
  const updated = await db
    .update(daemons)
    .set({ status: "online", lastHeartbeatAt: sql`now()` })
    .where(eq(daemons.id, daemonId))
    .returning({ id: daemons.id, teamId: daemons.teamId });
  if (!updated[0]) return false;
  await db
    .update(runtimes)
    .set({ status: "online" })
    .where(eq(runtimes.daemonId, daemonId));
  hub.publish(updated[0].teamId, { kind: "presence" });
  return true;
}

export interface ClaimedTask {
  id: string;
  teamId: string;
  agentId: string;
  projectId?: string | null;
  projectTaskId?: string | null;
  kind: string;
  input: unknown;
  workDir: string;
  workspace?: {
    id: string;
    projectId: string;
    resourceId: string;
    type: "git_repo" | "local_dir";
    ref: string;
    branch: string;
    path: string;
  };
  /** Bounded learned context the engine injected for this run (also folded into input.prompt). */
  context?: InjectionContext;
  /** Org provider keys as { ENV_VAR: value } — the daemon merges these into the runtime env. */
  env?: Record<string, string>;
}

async function ensureProjectWorkspace(task: ClaimedTask, daemonId: string) {
  if (!task.projectId) return null;
  const [resource] = await db
    .select()
    .from(projectResources)
    .where(
      and(
        eq(projectResources.teamId, task.teamId),
        eq(projectResources.projectId, task.projectId),
        inArray(projectResources.type, ["git_repo", "local_dir"]),
      ),
    )
    .orderBy(projectResources.createdAt)
    .limit(1);
  if (
    !resource ||
    (resource.type !== "git_repo" && resource.type !== "local_dir")
  )
    return null;

  const [existing] = await db
    .select()
    .from(projectWorkspaces)
    .where(
      and(
        eq(projectWorkspaces.teamId, task.teamId),
        eq(projectWorkspaces.projectId, task.projectId),
        eq(projectWorkspaces.resourceId, resource.id),
        eq(projectWorkspaces.daemonId, daemonId),
      ),
    )
    .limit(1);

  const branch =
    typeof resource.meta === "object" &&
    resource.meta &&
    typeof (resource.meta as Record<string, unknown>).branch === "string"
      ? ((resource.meta as Record<string, unknown>).branch as string)
      : "";

  if (existing) {
    const path = existing.path || `projects/${task.projectId}/${existing.id}`;
    if (!existing.path) {
      await db
        .update(projectWorkspaces)
        .set({ path, branch, updatedAt: sql`now()` })
        .where(eq(projectWorkspaces.id, existing.id));
    }
    return {
      id: existing.id,
      projectId: task.projectId,
      resourceId: resource.id,
      type: resource.type,
      ref: resource.ref,
      branch: existing.branch || branch,
      path,
    };
  }

  const workspaceId = genId("pwsp");
  const path = `projects/${task.projectId}/${workspaceId}`;
  const [workspace] = await db
    .insert(projectWorkspaces)
    .values({
      id: workspaceId,
      teamId: task.teamId,
      projectId: task.projectId,
      resourceId: resource.id,
      daemonId,
      path,
      branch,
      status: "pending",
      meta: { resourceType: resource.type, resourceRef: resource.ref },
    })
    .returning();
  return {
    id: workspace!.id,
    projectId: task.projectId,
    resourceId: resource.id,
    type: resource.type,
    ref: resource.ref,
    branch,
    path,
  };
}

/**
 * Atomically claim the next queued task for a runtime. `FOR UPDATE SKIP LOCKED`
 * guarantees two daemons never grab the same row. Only tasks whose agent runs on
 * this runtime's kind are eligible.
 */
export async function claimTask(
  runtimeId: string,
): Promise<ClaimedTask | null> {
  const [rt] = await db
    .select()
    .from(runtimes)
    .where(eq(runtimes.id, runtimeId))
    .limit(1);
  if (!rt) return null;

  const result = await db.execute(sql`
    WITH next AS (
      SELECT at.id
      FROM ${runs} at
      JOIN ${schema.agents} a ON a.id = at.agent_id
      WHERE at.executor = 'daemon'
        AND at.team_id = ${rt.teamId}
        AND at.status = 'queued'
        AND at.dispatched_at IS NULL
        AND NOT (at.input ? 'simulate')
        AND a.runtime_kind = ${rt.kind}
        AND (a.preferred_daemon_id IS NULL OR a.preferred_daemon_id = ${rt.daemonId})
      ORDER BY at.priority DESC, at.created_at ASC
      FOR UPDATE OF at SKIP LOCKED
      LIMIT 1
    )
    UPDATE ${runs} t
    SET runtime_id = ${runtimeId}, daemon_id = ${rt.daemonId},
        dispatched_at = now(), work_dir = coalesce(t.work_dir, '/work/' || t.id)
    FROM next
    WHERE t.id = next.id
    RETURNING t.id AS "id", t.team_id AS "teamId", t.agent_id AS "agentId",
              t.project_id AS "projectId", t.project_task_id AS "projectTaskId",
              t.kind AS "kind", t.input AS "input", t.work_dir AS "workDir";
  `);

  const rows = result as unknown as ClaimedTask[];
  const task = rows[0] ?? null;
  if (task) {
    const workspace = await ensureProjectWorkspace(task, rt.daemonId);
    if (workspace) {
      task.workspace = workspace;
      task.workDir = workspace.path;
      await db
        .update(runs)
        .set({ workDir: workspace.path })
        .where(eq(runs.id, task.id));
    }
    // Phase E injection: resolve bounded memory/skills per the agent's live-version policy
    // and fold them into the prompt the runtime receives (the daemon reads input.prompt).
    const ctx = await resolveInjectionContext(task.teamId, task.agentId);
    const preamble = buildInjectionPreamble(ctx);
    // Fold the agent's live-version config into the task input the daemon receives:
    // the learned-context preamble + the agent's systemPrompt (persona/skill) + model.
    // Runtimes (claude --append-system-prompt, hermes, codex) read these from input.
    const base = (
      task.input && typeof task.input === "object" ? task.input : {}
    ) as Record<string, unknown>;
    const prompt = typeof base.prompt === "string" ? base.prompt : "";
    task.input = {
      ...base,
      prompt: preamble + prompt,
      ...(ctx.systemPrompt ? { systemPrompt: ctx.systemPrompt } : {}),
      ...(ctx.model ? { model: ctx.model } : {}),
      tools: await liveRuntimeTools(task.teamId, task.agentId),
    };
    task.context = ctx;
    // Inject the org's runtime credentials so the runtime (hermes/claude/codex…)
    // authenticates from credentials managed entirely in the web UI: provider API
    // keys plus any connected subscription OAuth (e.g. Codex via AGENTIK_CODEX_AUTH).
    task.env = await resolveRuntimeAuth(task.teamId);
  }
  return task;
}

export async function getProjectWorkspaceTeamId(
  workspaceId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ teamId: projectWorkspaces.teamId })
    .from(projectWorkspaces)
    .where(eq(projectWorkspaces.id, workspaceId))
    .limit(1);
  return row?.teamId ?? null;
}

export async function reportProjectWorkspaceStatus(
  workspaceId: string,
  input: {
    status: "pending" | "ready" | "syncing" | "error";
    path?: string;
    error?: string;
    meta?: Record<string, unknown>;
  },
): Promise<boolean> {
  const updated = await db
    .update(projectWorkspaces)
    .set({
      status: input.status,
      ...(input.path !== undefined ? { path: input.path } : {}),
      error: input.error ?? null,
      ...(input.meta ? { meta: input.meta } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(projectWorkspaces.id, workspaceId))
    .returning({ id: projectWorkspaces.id, teamId: projectWorkspaces.teamId });
  if (!updated[0]) return false;
  hub.publish(updated[0].teamId, { kind: "presence" });
  return true;
}

export async function startTask(
  runId: string,
): Promise<{ teamId: string } | null> {
  const updated = await db
    .update(runs)
    .set({ status: "running", startedAt: sql`now()` })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.status, "queued"),
        sql`${runs.dispatchedAt} IS NOT NULL`,
      ),
    )
    .returning({ id: runs.id, teamId: runs.teamId });
  return updated[0] ?? null;
}

export interface IncomingMessage {
  seq: number;
  type: RunMessageType;
  tool?: string;
  content?: string;
  input?: unknown;
  output?: unknown;
}

function runtimeEventForIncomingMessage(
  runId: string,
  message: IncomingMessage,
): RuntimeEventV2 {
  const eventId = `${runId}:${message.seq}`;
  if (message.type === "tool_use") {
    const toolId = message.tool ?? "tool";
    return {
      type: "tool_call.started",
      eventId,
      seq: message.seq,
      actor: { kind: "tool", toolId, name: toolId },
      toolCallId: eventId,
      toolId,
      input: message.input,
    };
  }
  if (message.type === "tool_result") {
    const toolId = message.tool ?? "tool";
    return {
      type: "tool_call.completed",
      eventId,
      seq: message.seq,
      actor: { kind: "tool", toolId, name: toolId },
      toolCallId: eventId,
      toolId,
      output: message.output,
      status: "succeeded",
    };
  }
  if (message.type === "thinking") {
    return {
      type: "thinking",
      eventId,
      seq: message.seq,
      actor: { kind: "agent" },
      content: message.content ?? "",
    };
  }
  if (message.type === "error") {
    return {
      type: "error",
      eventId,
      seq: message.seq,
      actor: { kind: "agent" },
      message: message.content ?? "Runtime error",
      code: message.tool,
    };
  }
  return {
    type: "message",
    eventId,
    seq: message.seq,
    actor: { kind: "agent" },
    content: message.content ?? "",
  };
}

async function nextTaskMessageSeq(runId: string) {
  const rows = (await db.execute(sql`
    SELECT coalesce(max(seq) + 1, 0)::int AS "nextSeq"
    FROM ${runMessages}
    WHERE run_id = ${runId}
  `)) as unknown as Array<{ nextSeq: number }>;
  return rows[0]?.nextSeq ?? 0;
}

async function appendTaskControlMessage(
  teamId: string,
  runId: string,
  content: string,
  input?: Record<string, unknown>,
) {
  const seq = await nextTaskMessageSeq(runId);
  await db.insert(runMessages).values({
    id: genId("amsg"),
    runId,
    seq,
    type: "text",
    tool: "run.control",
    content,
    input: input ?? null,
  });
  await db
    .update(runs)
    .set({ stepCount: seq + 1, completedSteps: seq + 1 })
    .where(and(eq(runs.id, runId), eq(runs.teamId, teamId)));
}

export async function requestDaemonTaskApproval(
  runId: string,
  input: { message?: string; context?: Record<string, unknown> },
): Promise<{ teamId: string; message: string } | null> {
  const [task] = await db
    .select({
      id: runs.id,
      teamId: runs.teamId,
      status: runs.status,
      projectTaskId: runs.projectTaskId,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!task) return null;
  if (task.status === "waiting_approval") {
    return {
      teamId: task.teamId,
      message: input.message?.trim() || "Operator approval required before execution.",
    };
  }
  if (!["queued", "running"].includes(task.status)) return null;
  await db
    .update(runs)
    .set({ status: "waiting_approval" })
    .where(eq(runs.id, runId));
  const message =
    input.message?.trim() || "Operator approval required before execution.";
  await appendTaskControlMessage(
    task.teamId,
    runId,
    `Approval requested: ${message}`,
    {
      action: "approval.requested",
      source: "daemon.preflight",
      context: input.context ?? {},
    },
  );
  if (task.projectTaskId) {
    await db
      .update(projectTasks)
      .set({ status: "blocked", updatedAt: sql`now()` })
      .where(
        and(
          eq(projectTasks.id, task.projectTaskId),
          eq(projectTasks.teamId, task.teamId),
        ),
      );
  }
  return { teamId: task.teamId, message };
}

/**
 * Append a batch of streamed messages (idempotent on (runId, seq)), recompute
 * progress counters, and tell the daemon whether the task was cancelled meanwhile.
 */
export async function appendMessages(
  runId: string,
  messages: IncomingMessage[],
): Promise<{
  cancel: boolean;
  teamId?: string;
  completedSteps?: number;
  stepCount?: number;
}> {
  if (messages.length > 0) {
    await db
      .insert(runMessages)
      .values(
        messages.map((m) => ({
          id: genId("amsg"),
          runId,
          seq: m.seq,
          type: m.type,
          tool: m.tool ?? null,
          content: m.content ?? null,
          input: m.input ?? null,
          output: m.output ?? null,
        })),
      )
      .onConflictDoNothing({ target: [runMessages.runId, runMessages.seq] });

    await db
      .insert(runEvents)
      .values(
        messages.map((m) => {
          const payload = runtimeEventForIncomingMessage(runId, m);
          return {
            id: genId("revt"),
            runId,
            seq: m.seq,
            type: payload.type,
            actor: payload.actor,
            toolCallId: "toolCallId" in payload ? payload.toolCallId : null,
            parentEventId: null,
            payload,
            contractEvent:
              payload.type === "message"
                ? "message.created"
                : payload.type === "tool_call.started"
                  ? "tool.started"
                  : payload.type === "tool_call.completed"
                    ? "tool.output"
                    : payload.type === "error"
                      ? "run.failed"
                      : null,
          };
        }),
      )
      .onConflictDoNothing({ target: [runEvents.runId, runEvents.seq] });

    const all = await db
      .select({ type: runMessages.type })
      .from(runMessages)
      .where(eq(runMessages.runId, runId));
    const completed = all.filter((m) => TERMINAL_MSG.includes(m.type)).length;
    await db
      .update(runs)
      .set({ stepCount: all.length, completedSteps: completed })
      .where(eq(runs.id, runId));
  }

  const [task] = await db
    .select({
      status: runs.status,
      teamId: runs.teamId,
      stepCount: runs.stepCount,
      completedSteps: runs.completedSteps,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return {
    // A paused run signals the daemon to stop the in-flight CLI exactly like a
    // cancel (same SIGTERM path). The daemon's follow-up Fail("cancelled") is a
    // no-op because failTask only transitions queued/running rows, so the run
    // stays 'paused' and is resumable (resumeRun re-dispatches it). This is what
    // makes Pause a real gate under hermes --yolo, not just a label.
    cancel: task?.status === "cancelled" || task?.status === "paused",
    ...(task && messages.length > 0
      ? {
          teamId: task.teamId,
          completedSteps: task.completedSteps,
          stepCount: task.stepCount,
        }
      : {}),
  };
}

/** Pull the runtime's reported `cost_usd` (dollars float) out of a result blob and
 *  round to integer cents. Null when absent/invalid (some runtimes omit it). */
function costCentsFromResult(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const usd = r.cost_usd ?? r.costUsd ?? r.total_cost_usd ?? r.totalCostUsd;
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) return null;
  return Math.round(usd * 100);
}

export async function completeTask(
  runId: string,
  result: unknown,
): Promise<{
  teamId: string;
  chatSessionId: string | null;
  projectTaskId: string | null;
} | null> {
  const costCents = costCentsFromResult(result);
  const updated = await db
    .update(runs)
    .set({
      status: "succeeded",
      result: (result ?? null) as Record<string, unknown> | null,
      ...(costCents != null ? { costCents } : {}),
      endedAt: sql`now()`,
      durationMs: sql`(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::int`,
      completedSteps: sql`${runs.stepCount}`,
    })
    .where(
      and(
        eq(runs.id, runId),
        inArray(runs.status, ["queued", "running"]),
      ),
    )
    .returning({
      id: runs.id,
      teamId: runs.teamId,
      chatSessionId: runs.chatSessionId,
      projectTaskId: runs.projectTaskId,
    });
  if (!updated[0]) return null;
  return {
    teamId: updated[0].teamId,
    chatSessionId: updated[0].chatSessionId,
    projectTaskId: updated[0].projectTaskId,
  };
}

/**
 * Mark a task failed with a classified reason. Daemon-reported failures default to
 * `agent_error` (terminal); the timeout scanner passes `timeout` (retryable). Auto-retry
 * is NOT decided here — the scanner owns it so a single component drives retry policy.
 */
export async function failTask(
  runId: string,
  error: string,
  reason: TaskErrorReason = "agent_error",
): Promise<{ teamId: string; projectTaskId: string | null } | null> {
  const updated = await db
    .update(runs)
    .set({
      status: "failed",
      error,
      errorReason: reason,
      endedAt: sql`now()`,
      durationMs: sql`(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::int`,
    })
    .where(
      and(
        eq(runs.id, runId),
        inArray(runs.status, ["queued", "running"]),
      ),
    )
    .returning({
      id: runs.id,
      teamId: runs.teamId,
      projectTaskId: runs.projectTaskId,
    });
  if (!updated[0]) return null;
  return {
    teamId: updated[0].teamId,
    projectTaskId: updated[0].projectTaskId,
  };
}

/**
 * Re-queue a failed task in place (auto-retry of a transient/retryable failure):
 * resets the SAME row to `queued` so the web UI keeps one run identity across the
 * retry, bumps `attempt`, and clears the failure + dispatch/runtime fields. The
 * streamed transcript is intentionally preserved as history. Idempotent: only flips
 * a row that is still `failed` with the expected attempt, so concurrent scanner ticks
 * can't double-bump. Returns true when this call performed the retry.
 */
export async function autoRetryTask(
  runId: string,
  fromAttempt: number,
): Promise<boolean> {
  const updated = await db
    .update(runs)
    .set({
      status: "queued",
      attempt: fromAttempt + 1,
      error: null,
      errorReason: null,
      runtimeId: null,
      daemonId: null,
      dispatchedAt: null,
      endedAt: null,
      durationMs: null,
    })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.status, "failed"),
        eq(runs.attempt, fromAttempt),
      ),
    )
    .returning({ id: runs.id, teamId: runs.teamId });
  if (!updated[0]) return false;
  hub.publish(updated[0].teamId, {
    kind: "run",
    action: "created",
    runId: runId,
  });
  return true;
}
