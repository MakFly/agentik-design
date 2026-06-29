/**
 * backfillRunEvents reconstructs the run_events ledger from run_messages, reusing the
 * exact live dual-write mapping, and is idempotent (re-running inserts nothing new).
 * Skips when no DB is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { backfillRunEvents } from "../../../src/execution/daemon/repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
const d = dbUp ? describe : describe.skip;

d("backfillRunEvents — reconstruct ledger from run_messages", () => {
  const stamp = Date.now();
  const teamId = `team_bf_${stamp}`;
  const runId = `run_bf_${stamp}`;

  beforeAll(async () => {
    await db
      .insert(schema.teams)
      .values({ id: teamId, slug: `bf-${stamp}`, name: "Backfill Test" });
    await db.insert(schema.runs).values({
      id: runId,
      teamId,
      executor: "daemon",
      agentId: "agent_bf",
      status: "succeeded",
    });
    await db.insert(schema.runMessages).values([
      { id: `amsg_${stamp}_0`, runId, seq: 0, type: "tool_use", tool: "bash", input: { cmd: "ls" } },
      { id: `amsg_${stamp}_1`, runId, seq: 1, type: "tool_result", tool: "bash", output: { stdout: "ok" } },
      { id: `amsg_${stamp}_2`, runId, seq: 2, type: "text", content: "done" },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.runEvents).where(eq(schema.runEvents.runId, runId));
    await db.delete(schema.runMessages).where(eq(schema.runMessages.runId, runId));
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("inserts one ledger row per message", async () => {
    const inserted = await backfillRunEvents(runId);
    expect(inserted).toBe(3);
    const events = await db
      .select({ seq: schema.runEvents.seq, type: schema.runEvents.type })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, runId));
    expect(events).toHaveLength(3);
    // mapping mirrors the live dual-write: tool_use -> tool_call.started, etc.
    expect(events.find((e) => e.seq === 0)?.type).toBe("tool_call.started");
    expect(events.find((e) => e.seq === 2)?.type).toBe("message");
  });

  test("is idempotent — re-running inserts nothing new", async () => {
    expect(await backfillRunEvents(runId)).toBe(0);
    const count = await db
      .select({ seq: schema.runEvents.seq })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, runId));
    expect(count).toHaveLength(3);
  });

  test("returns 0 for a run with no messages", async () => {
    expect(await backfillRunEvents(`run_missing_${stamp}`)).toBe(0);
  });
});
