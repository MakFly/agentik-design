import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { hub } from "../../infra/hub";

const { runs, runMessages, projectTasks } = schema;

async function nextRunMessageSeq(runId: string) {
  const rows = (await db.execute(sql`
    SELECT coalesce(max(seq) + 1, 0)::int AS "nextSeq"
    FROM ${runMessages}
    WHERE run_id = ${runId}
  `)) as unknown as Array<{ nextSeq: number }>;
  return rows[0]?.nextSeq ?? 0;
}

async function appendRunControlMessage(
  teamId: string,
  runId: string,
  content: string,
  input?: Record<string, unknown>,
) {
  const seq = await nextRunMessageSeq(runId);
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
  hub.publish(teamId, {
    kind: "run.progress",
    runId: runId,
    completedSteps: seq + 1,
    stepCount: seq + 1,
  });
}

/** Cancel an agent task (workflow runs handled elsewhere). Tenancy-scoped. Returns true if flipped. */
export async function cancelRun(
  teamId: string,
  id: string,
): Promise<boolean> {
  const updated = await db
    .update(runs)
    .set({ status: "cancelled", endedAt: sql`now()` })
    .where(
      and(
        eq(runs.id, id),
        eq(runs.teamId, teamId),
        inArray(runs.status, [
          "queued",
          "queued",
          "running",
          "paused",
          "waiting_approval",
        ]),
      ),
    )
    .returning({
      id: runs.id,
      teamId: runs.teamId,
      projectTaskId: runs.projectTaskId,
    });
  if (!updated[0]) return false;
  await appendRunControlMessage(teamId, id, "Run cancelled by operator.");
  if (updated[0].projectTaskId) {
    await db
      .update(projectTasks)
      .set({ status: "cancelled", updatedAt: sql`now()` })
      .where(
        and(
          eq(projectTasks.id, updated[0].projectTaskId),
          eq(projectTasks.teamId, updated[0].teamId),
        ),
      );
  }
  hub.publish(updated[0].teamId, {
    kind: "run",
    action: "cancelled",
    runId: id,
  });
  return true;
}

export async function pauseRun(
  teamId: string,
  id: string,
  reason?: string,
): Promise<boolean> {
  const updated = await db
    .update(runs)
    .set({ status: "paused" })
    .where(
      and(
        eq(runs.id, id),
        eq(runs.teamId, teamId),
        eq(runs.status, "queued"),
      ),
    )
    .returning({ id: runs.id, teamId: runs.teamId });
  if (!updated[0]) return false;
  await appendRunControlMessage(
    teamId,
    id,
    reason ? `Run paused: ${reason}` : "Run paused by operator.",
    { action: "pause", reason },
  );
  hub.publish(teamId, { kind: "run", action: "paused", runId: id });
  return true;
}

export async function resumeRun(
  teamId: string,
  id: string,
  reason?: string,
): Promise<boolean> {
  const updated = await db
    .update(runs)
    .set({ status: "queued" })
    .where(
      and(
        eq(runs.id, id),
        eq(runs.teamId, teamId),
        eq(runs.status, "paused"),
      ),
    )
    .returning({ id: runs.id, teamId: runs.teamId });
  if (!updated[0]) return false;
  await appendRunControlMessage(
    teamId,
    id,
    reason ? `Run resumed: ${reason}` : "Run resumed by operator.",
    { action: "resume", reason },
  );
  hub.publish(teamId, { kind: "run", action: "created", runId: id });
  return true;
}

export async function requestRunApproval(
  teamId: string,
  id: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<boolean> {
  const updated = await db
    .update(runs)
    .set({ status: "waiting_approval" })
    .where(
      and(
        eq(runs.id, id),
        eq(runs.teamId, teamId),
        inArray(runs.status, ["queued", "paused"]),
      ),
    )
    .returning({ id: runs.id, teamId: runs.teamId });
  if (!updated[0]) return false;
  await appendRunControlMessage(teamId, id, `Approval requested: ${message}`, {
    action: "approval.requested",
    context: context ?? {},
  });
  hub.publish(teamId, { kind: "run", action: "waiting_approval", runId: id });
  return true;
}

export async function approveRun(
  teamId: string,
  id: string,
  reason?: string,
): Promise<boolean> {
  const [task] = await db
    .select({
      input: runs.input,
      projectTaskId: runs.projectTaskId,
    })
    .from(runs)
    .where(
      and(
        eq(runs.id, id),
        eq(runs.teamId, teamId),
        eq(runs.status, "waiting_approval"),
      ),
    )
    .limit(1);
  if (!task) return false;
  const input = (
    task.input && typeof task.input === "object" ? task.input : {}
  ) as Record<string, unknown>;
  const approval = (
    input.approval && typeof input.approval === "object" ? input.approval : {}
  ) as Record<string, unknown>;
  const updatedInput = {
    ...input,
    approval: {
      ...approval,
      approved: true,
      approvedAt: new Date().toISOString(),
      reason: reason ?? "",
    },
  };
  const updated = await db
    .update(runs)
    .set({
      status: "queued",
      input: updatedInput,
      runtimeId: null,
      daemonId: null,
      dispatchedAt: null,
    })
    .where(
      and(
        eq(runs.id, id),
        eq(runs.teamId, teamId),
        eq(runs.status, "waiting_approval"),
      ),
    )
    .returning({
      id: runs.id,
      teamId: runs.teamId,
      projectTaskId: runs.projectTaskId,
    });
  if (!updated[0]) return false;
  await appendRunControlMessage(
    teamId,
    id,
    reason ? `Approval granted: ${reason}` : "Approval granted.",
    { action: "approval.approved", reason },
  );
  if (updated[0].projectTaskId) {
    await db
      .update(projectTasks)
      .set({ status: "running", updatedAt: sql`now()` })
      .where(
        and(
          eq(projectTasks.id, updated[0].projectTaskId),
          eq(projectTasks.teamId, updated[0].teamId),
        ),
      );
  }
  hub.publish(teamId, { kind: "run", action: "created", runId: id });
  return true;
}

export async function rejectRun(
  teamId: string,
  id: string,
  reason?: string,
): Promise<boolean> {
  const updated = await db
    .update(runs)
    .set({ status: "cancelled", endedAt: sql`now()` })
    .where(
      and(
        eq(runs.id, id),
        eq(runs.teamId, teamId),
        eq(runs.status, "waiting_approval"),
      ),
    )
    .returning({
      id: runs.id,
      teamId: runs.teamId,
      projectTaskId: runs.projectTaskId,
    });
  if (!updated[0]) return false;
  await appendRunControlMessage(
    teamId,
    id,
    reason ? `Approval rejected: ${reason}` : "Approval rejected.",
    { action: "approval.rejected", reason },
  );
  if (updated[0].projectTaskId) {
    await db
      .update(projectTasks)
      .set({ status: "cancelled", updatedAt: sql`now()` })
      .where(
        and(
          eq(projectTasks.id, updated[0].projectTaskId),
          eq(projectTasks.teamId, updated[0].teamId),
        ),
      );
  }
  hub.publish(teamId, { kind: "run", action: "cancelled", runId: id });
  return true;
}

/**
 * Manually re-run a finished task: enqueues a FRESH task (new id, attempt=1) copying
 * the original agent/kind/input, so the user gets a clean run with its own transcript.
 * Unlike auto-retry (which reuses the row), this never inherits a session and has no
 * attempt ceiling. Tenancy-scoped. Returns the new run id, or null if not found.
 */
export async function retryRun(
  teamId: string,
  id: string,
): Promise<{ runId: string } | null> {
  const [orig] = await db
    .select({
      agentId: runs.agentId,
      kind: runs.kind,
      priority: runs.priority,
      input: runs.input,
      projectId: runs.projectId,
      projectTaskId: runs.projectTaskId,
    })
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.teamId, teamId)))
    .limit(1);
  if (!orig) return null;
  const newId = genId("run");
  await db.insert(runs).values({
    id: newId,
    teamId,
    executor: "daemon",
    agentId: orig.agentId,
    projectId: orig.projectId,
    projectTaskId: orig.projectTaskId,
    status: "queued",
    kind: orig.kind,
    priority: orig.priority,
    attempt: 1,
    input: orig.input as Record<string, unknown> | null,
  });
  if (orig.projectTaskId) {
    await db
      .update(projectTasks)
      .set({ status: "running", lastRunId: newId, updatedAt: sql`now()` })
      .where(
        and(
          eq(projectTasks.id, orig.projectTaskId),
          eq(projectTasks.teamId, teamId),
        ),
      );
  }
  hub.publish(teamId, { kind: "run", action: "created", runId: newId });
  return { runId: newId };
}
