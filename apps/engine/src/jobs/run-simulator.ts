/**
 * Local run simulator — a dev/test stand-in for the Go daemon. It claims `queued`
 * daemon runs and drives them through a realistic lifecycle so the whole product
 * loop is observable WITHOUT a CLI runtime or LLM cost:
 *
 *   queued → running → (waiting_approval) → succeeded
 *
 * Each step writes BOTH run_messages (live SSE projection) and run_events (V2 audit
 * ledger). When a run carries `input.simulate.email`, the "send" actually delivers
 * to infra-mailpit so the email is visible in the Mailpit UI. Telegram notifications
 * are recorded as channel_deliveries (consumed by the Telegram simulation script).
 *
 * Behaviour is declared per run under `input.simulate`:
 *   { steps?: string[], requireApproval?: boolean,
 *     email?: { to, subject, text },
 *     notify?: { connectionId, chatId, text } }
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../infra/db/client";
import { genId } from "../infra/db/ids";
import { hub } from "../infra/hub";
import { sendMail } from "../infra/mailer";
import { appendRunEvents } from "../domains/runs/repo";
import { requestRunApproval } from "../domains/runs/controls";

const { runs, runMessages, projectTasks, channelDeliveries } = schema;

export interface SimulateSpec {
  steps?: string[];
  requireApproval?: boolean;
  email?: { to: string; subject: string; text: string; from?: string };
  notify?: { connectionId: string; chatId: string; text?: string; identityId?: string | null };
}

type RunRow = typeof runs.$inferSelect;

function specOf(run: RunRow): SimulateSpec {
  const input = (run.input && typeof run.input === "object" ? run.input : {}) as Record<string, unknown>;
  const sim = input.simulate;
  return (sim && typeof sim === "object" ? sim : {}) as SimulateSpec;
}

function isApproved(run: RunRow): boolean {
  const input = (run.input && typeof run.input === "object" ? run.input : {}) as Record<string, unknown>;
  const approval = (input.approval && typeof input.approval === "object" ? input.approval : {}) as Record<
    string,
    unknown
  >;
  return approval.approved === true;
}

async function nextSeq(runId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${runMessages.seq}), 0)` })
    .from(runMessages)
    .where(eq(runMessages.runId, runId));
  return (row?.max ?? 0) + 1;
}

/** Append one step to BOTH run_messages (SSE) and run_events (V2 ledger). */
async function emit(
  runId: string,
  step: { type: string; content?: string; tool?: string; input?: unknown; output?: unknown },
  seq: number,
): Promise<void> {
  await db
    .insert(runMessages)
    .values({
      id: genId("amsg"),
      runId,
      seq,
      type: step.type as never,
      tool: step.tool ?? null,
      content: step.content ?? null,
      input: (step.input ?? null) as never,
      output: (step.output ?? null) as never,
    })
    .onConflictDoNothing({ target: [runMessages.runId, runMessages.seq] });

  await appendRunEvents(runId, [
    {
      seq,
      type: step.type,
      actor: { kind: "agent", source: "simulator" },
      payload: { type: step.type, content: step.content ?? null, tool: step.tool ?? null },
      toolCallId: step.tool ? `${runId}:${seq}` : null,
      contractEvent: step.type === "tool_call" ? "tool_call.completed" : "message.created",
    },
  ]);
}

async function recordTelegramDelivery(
  teamId: string,
  runId: string,
  notify: NonNullable<SimulateSpec["notify"]>,
  text: string,
): Promise<void> {
  await db.insert(channelDeliveries).values({
    id: genId("chdel"),
    teamId,
    connectionId: notify.connectionId,
    identityId: notify.identityId ?? null,
    provider: "telegram",
    kind: "notification",
    status: "sent",
    payload: { chatId: notify.chatId, text },
    runId,
  });
}

/** Drive a run to completion: progress steps, optional email send + notify, success. */
async function finishRun(run: RunRow): Promise<void> {
  const teamId = run.teamId;
  const spec = specOf(run);
  let seq = await nextSeq(run.id);

  await db
    .update(runs)
    .set({ status: "running", startedAt: sql`now()` })
    .where(and(eq(runs.id, run.id), eq(runs.teamId, teamId), inArray(runs.status, ["queued"])));
  hub.publish(teamId, { kind: "run", action: "created", runId: run.id });

  for (const line of spec.steps ?? ["Working on the task…"]) {
    await emit(run.id, { type: "text", content: line }, seq++);
  }

  if (spec.email) {
    await sendMail({
      from: spec.email.from ?? "assistant@agentik.dev",
      to: spec.email.to,
      subject: spec.email.subject,
      text: spec.email.text,
    });
    await emit(
      run.id,
      {
        type: "tool_call",
        tool: "email.send",
        input: { to: spec.email.to, subject: spec.email.subject },
        output: { delivered: true, via: "mailpit" },
        content: `Email sent to ${spec.email.to}: ${spec.email.subject}`,
      },
      seq++,
    );
  }

  if (spec.notify) {
    const text = spec.notify.text ?? "Task completed.";
    await recordTelegramDelivery(teamId, run.id, spec.notify, text);
    await emit(run.id, { type: "text", content: `Notified Telegram chat ${spec.notify.chatId}.` }, seq++);
  }

  await emit(run.id, { type: "text", content: "Task completed successfully." }, seq++);

  await db
    .update(runs)
    .set({
      status: "succeeded",
      result: { summary: "Completed by run simulator.", steps: seq - 1 },
      costCents: 1,
      stepCount: seq - 1,
      completedSteps: seq - 1,
      endedAt: sql`now()`,
    })
    .where(and(eq(runs.id, run.id), eq(runs.teamId, teamId)));

  if (run.projectTaskId) {
    await db
      .update(projectTasks)
      .set({ status: "done", lastRunId: run.id, updatedAt: sql`now()` })
      .where(and(eq(projectTasks.id, run.projectTaskId), eq(projectTasks.teamId, teamId)));
  }
  hub.publish(teamId, { kind: "run", action: "succeeded", runId: run.id });
}

/**
 * Advance a single queued run by one decision:
 *  - needs approval and not yet approved → emit a draft + halt at waiting_approval
 *  - otherwise → run to completion (sends email / notifies / succeeds)
 * Returns the resulting status, or null if the run was not in a processable state.
 */
export async function processRun(teamId: string, runId: string): Promise<string | null> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.teamId, teamId)))
    .limit(1);
  if (!run || run.status !== "queued") return run?.status ?? null;

  const spec = specOf(run);
  if (spec.requireApproval && !isApproved(run)) {
    const seq = await nextSeq(run.id);
    await emit(
      run.id,
      {
        type: "thinking",
        content: spec.email
          ? `Drafted an email to ${spec.email.to} — awaiting approval before sending.`
          : "Awaiting operator approval before the irreversible action.",
      },
      seq,
    );
    await requestRunApproval(
      teamId,
      run.id,
      spec.email ? `Send email to ${spec.email.to}?` : "Approve irreversible action?",
      spec.email ? { to: spec.email.to, subject: spec.email.subject } : {},
    );
    return "waiting_approval";
  }

  await finishRun(run);
  return "succeeded";
}

/** Process all currently-queued daemon runs for a team. Idempotent — safe to re-run. */
export async function simulateQueuedRuns(
  teamId: string,
  limit = 50,
): Promise<{ processed: Array<{ runId: string; status: string | null }> }> {
  const queued = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.teamId, teamId), eq(runs.status, "queued"), eq(runs.executor, "daemon")))
    .limit(limit);
  const processed = [];
  for (const { id } of queued) {
    processed.push({ runId: id, status: await processRun(teamId, id) });
  }
  return { processed };
}
