/**
 * Embedded worker integration test against a REAL Postgres (skips when no DB).
 * Drives the claim→execute→complete loop with a stub adapter so it's deterministic
 * and free, and asserts the "needs setup" branch when no adapter resolves.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { registerDaemon } from "../../../src/execution/daemon/repo";
import {
  claimAndProcessOnce,
  type AdapterResolver,
} from "../../../src/execution/embedded/worker";
import { SETUP_HINT } from "../../../src/execution/embedded/runtime/resolve";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
const d = dbUp ? describe : describe.skip;

d("embedded worker — claim → execute → complete", () => {
  const stamp = Date.now();
  const teamId = `team_emb_${stamp}`;
  const agentId = `agent_emb_${stamp}`;
  let runtimeId = "";

  const stubResolver: AdapterResolver = () => ({
    label: "stub",
    async run(_task, emit) {
      await emit([{ seq: 1, type: "text", content: "stub answer" }]);
      return { result: { summary: "ok" } };
    },
  });

  const insertQueuedRun = async (id: string) => {
    await db.insert(schema.runs).values({
      id,
      teamId,
      executor: "daemon",
      agentId,
      status: "queued",
      input: { prompt: "say hi" },
    });
  };
  const runRow = async (id: string) =>
    (await db.select().from(schema.runs).where(eq(schema.runs.id, id)))[0];

  beforeAll(async () => {
    await db.insert(schema.teams).values({ id: teamId, slug: `emb-${stamp}`, name: "Embedded Test" });
    await db.insert(schema.agents).values({ id: agentId, teamId, name: "Embedded Agent", runtimeKind: "claude" });
    const reg = await registerDaemon({
      teamId,
      name: `embedded · ${stamp}`,
      meta: { deviceId: `embedded:${teamId}`, embedded: true },
      runtimes: [{ kind: "claude" }],
    });
    runtimeId = reg.runtimes.find((r) => r.kind === "claude")!.id;
  });

  afterAll(async () => {
    const runIds = (await db.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.teamId, teamId))).map((r) => r.id);
    for (const id of runIds) {
      await db.delete(schema.runMessages).where(eq(schema.runMessages.runId, id));
      await db.delete(schema.runEvents).where(eq(schema.runEvents.runId, id));
    }
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.runtimes).where(eq(schema.runtimes.teamId, teamId));
    await db.delete(schema.daemons).where(eq(schema.daemons.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("runs a queued task to success via the adapter", async () => {
    const runId = `run_emb_ok_${stamp}`;
    await insertQueuedRun(runId);

    const res = await claimAndProcessOnce(runtimeId, "claude", stubResolver);
    expect(res).toEqual({ runId, status: "succeeded" });

    const run = await runRow(runId);
    expect(run!.status).toBe("succeeded");

    const msgs = await db
      .select()
      .from(schema.runMessages)
      .where(eq(schema.runMessages.runId, runId));
    expect(msgs.some((m) => m.content === "stub answer")).toBe(true);
  });

  test("returns null when the queue is empty for the runtime", async () => {
    expect(await claimAndProcessOnce(runtimeId, "claude", stubResolver)).toBeNull();
  });

  test("marks the run failed with a setup hint when no adapter resolves", async () => {
    const runId = `run_emb_setup_${stamp}`;
    await insertQueuedRun(runId);

    const nullResolver: AdapterResolver = () => null;
    const res = await claimAndProcessOnce(runtimeId, "claude", nullResolver);
    expect(res).toEqual({ runId, status: "needs_setup" });

    const run = await runRow(runId);
    expect(run!.status).toBe("failed");

    const msgs = await db
      .select()
      .from(schema.runMessages)
      .where(and(eq(schema.runMessages.runId, runId), eq(schema.runMessages.type, "error")));
    expect(msgs.some((m) => m.content === SETUP_HINT)).toBe(true);
  });
});
