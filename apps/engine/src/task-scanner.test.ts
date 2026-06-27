/**
 * Integration tests for the lifecycle scanner (timeout + auto-retry policy).
 * Run against a REAL Postgres; SKIP automatically when none is reachable so
 * `bun test` stays green offline. Run the full suite with infra-postgres up.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./infra/db/client";
import { genId } from "./infra/db/ids";
import { resolveTeam } from "./domains/workflows/repo";
import { failTask } from "./execution/daemon/service";
import { retryRun } from "./domains/runs";
import { scanStaleTasks, SCANNER_LOCK_KEY } from "./jobs/task-scanner";

const { agents, runs, teams } = schema;

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[task-scanner] no DB reachable — skipping integration tests");
const d = dbUp ? describe : describe.skip;

/** Insert a task with a backdated dispatch/start time so the scanner sees it as stale. */
async function insertTask(opts: {
  teamId: string;
  agentId: string;
  status: "queued" | "queued" | "running";
  kind?: string;
  attempt?: number;
  /** SQL interval string to backdate dispatched_at/started_at, e.g. "10 minutes". */
  staleBy?: string;
}): Promise<string> {
  const id = genId("run");
  const backdate = opts.staleBy ? sql`now() - interval '${sql.raw(opts.staleBy)}'` : null;
  await db.insert(runs).values({
    id,
    teamId: opts.teamId,
    executor: "daemon",
    agentId: opts.agentId,
    status: opts.status,
    kind: opts.kind ?? "chat",
    attempt: opts.attempt ?? 1,
    input: { prompt: "hi" },
    ...(opts.status === "queued" && backdate ? { dispatchedAt: backdate as never } : {}),
    ...(opts.status === "running" && backdate ? { startedAt: backdate as never } : {}),
  });
  return id;
}

async function getTask(id: string) {
  const [t] = await db
    .select({ status: runs.status, attempt: runs.attempt, errorReason: runs.errorReason })
    .from(runs)
    .where(eq(runs.id, id))
    .limit(1);
  return t;
}

d("task-scanner — timeout + auto-retry", () => {
  let teamId: string;
  let agentId: string;
  let chatRetryable: string; // chat, attempt 1, dispatched-stale → timed out + retried
  let chatRunning: string; // chat, attempt 1, running-stale → timed out + retried
  let chatCeiling: string; // chat, attempt 2, dispatched-stale → timed out, NOT retried
  let directTask: string; // direct, dispatched-stale → timed out, NOT retried
  let fresh: string; // dispatched but recent → untouched

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-scanner-${Date.now()}`);
    agentId = genId("agt");
    await db.insert(agents).values({ id: agentId, teamId, name: "Scanner Agent" });

    chatRetryable = await insertTask({ teamId, agentId, status: "queued", kind: "chat", attempt: 1, staleBy: "10 minutes" });
    chatRunning = await insertTask({ teamId, agentId, status: "running", kind: "chat", attempt: 1, staleBy: "3 hours" });
    chatCeiling = await insertTask({ teamId, agentId, status: "queued", kind: "chat", attempt: 2, staleBy: "10 minutes" });
    directTask = await insertTask({ teamId, agentId, status: "queued", kind: "direct", attempt: 1, staleBy: "10 minutes" });
    fresh = await insertTask({ teamId, agentId, status: "queued", kind: "chat", attempt: 1 }); // dispatched_at = null → not stale

    await scanStaleTasks();
  });

  afterAll(async () => {
    await db.delete(agents).where(eq(agents.teamId, teamId)); // tasks are soft-ref'd by teamId; clean explicitly
    await db.delete(runs).where(eq(runs.teamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
  });

  test("dispatched-stale chat task is timed out then auto-retried in place (attempt+1, reason cleared)", async () => {
    const t = await getTask(chatRetryable);
    expect(t?.status).toBe("queued");
    expect(t?.attempt).toBe(2);
    expect(t?.errorReason).toBeNull();
  });

  test("running-stale chat task is timed out then auto-retried", async () => {
    const t = await getTask(chatRunning);
    expect(t?.status).toBe("queued");
    expect(t?.attempt).toBe(2);
  });

  test("chat task at the attempt ceiling is timed out but NOT retried", async () => {
    const t = await getTask(chatCeiling);
    expect(t?.status).toBe("failed");
    expect(t?.attempt).toBe(2);
    expect(t?.errorReason).toBe("timeout");
  });

  test("non-chat (direct) task is timed out but NOT auto-retried", async () => {
    const t = await getTask(directTask);
    expect(t?.status).toBe("failed");
    expect(t?.errorReason).toBe("timeout");
  });

  test("recent dispatched task is left untouched", async () => {
    const t = await getTask(fresh);
    expect(t?.status).toBe("queued");
    expect(t?.attempt).toBe(1);
    expect(t?.errorReason).toBeNull();
  });
});

d("task-scanner — daemon-reported failures are terminal", () => {
  let teamId: string;
  let agentId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-scanner-term-${Date.now()}`);
    agentId = genId("agt");
    await db.insert(agents).values({ id: agentId, teamId, name: "Term Agent" });
  });

  afterAll(async () => {
    await db.delete(agents).where(eq(agents.teamId, teamId));
    await db.delete(runs).where(eq(runs.teamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
  });

  test("failTask defaults to agent_error and the scanner never resurrects it", async () => {
    const id = await insertTask({ teamId, agentId, status: "running", kind: "chat", attempt: 1 });
    expect(await failTask(id, "boom")).toBe(true);
    let t = await getTask(id);
    expect(t?.status).toBe("failed");
    expect(t?.errorReason).toBe("agent_error");

    await scanStaleTasks(); // a 'failed' task is neither dispatched nor running → untouched
    t = await getTask(id);
    expect(t?.status).toBe("failed");
    expect(t?.attempt).toBe(1);
  });
});

d("retryRun — manual rerun forks a fresh task", () => {
  let teamId: string;
  let agentId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-scanner-retry-${Date.now()}`);
    agentId = genId("agt");
    await db.insert(agents).values({ id: agentId, teamId, name: "Retry Agent" });
  });

  afterAll(async () => {
    await db.delete(agents).where(eq(agents.teamId, teamId));
    await db.delete(runs).where(eq(runs.teamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
  });

  test("creates a NEW queued task with attempt=1, leaving the original intact", async () => {
    const orig = await insertTask({ teamId, agentId, status: "running", kind: "chat", attempt: 3 });
    await failTask(orig, "boom");

    const res = await retryRun(teamId, orig);
    expect(res).not.toBeNull();
    expect(res!.runId).not.toBe(orig);

    const created = await getTask(res!.runId);
    expect(created?.status).toBe("queued");
    expect(created?.attempt).toBe(1);

    const original = await getTask(orig);
    expect(original?.status).toBe("failed"); // untouched by the fork
  });

  test("returns null for a non-agent-task id", async () => {
    expect(await retryRun(teamId, "run_whatever")).toBeNull();
  });
});

d("task-scanner — single-owner advisory lock", () => {
  test("a tick is skipped while another session holds the lock", async () => {
    // Hold the same advisory xact-lock in an outer transaction; the scanner's own
    // pg_try_advisory_xact_lock must then fail → the tick reports skipped.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SCANNER_LOCK_KEY})`);
      const res = await scanStaleTasks();
      expect(res.skipped).toBe(true);
    });
  });
});
