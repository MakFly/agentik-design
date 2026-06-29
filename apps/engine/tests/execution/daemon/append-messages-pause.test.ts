/**
 * appendMessages returns `cancel:true` for BOTH cancelled and paused runs, so the
 * daemon stops the in-flight CLI on pause exactly as it does on cancel. The paused
 * run is NOT made terminal (failTask only flips queued/running), so it stays
 * resumable. Skips when no DB is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { appendMessages } from "../../../src/execution/daemon/repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
const d = dbUp ? describe : describe.skip;

d("appendMessages — pause is a hard stop signal", () => {
  const stamp = Date.now();
  const teamId = `team_pause_${stamp}`;

  const runId = (suffix: string) => `run_${stamp}_${suffix}`;
  const seedRun = (suffix: string, status: "running" | "paused" | "cancelled") =>
    db.insert(schema.runs).values({
      id: runId(suffix),
      teamId,
      executor: "daemon",
      agentId: "agent_pause",
      status,
    });

  beforeAll(async () => {
    await db
      .insert(schema.teams)
      .values({ id: teamId, slug: `pause-${stamp}`, name: "Pause Test" });
    await Promise.all([
      seedRun("running", "running"),
      seedRun("paused", "paused"),
      seedRun("cancelled", "cancelled"),
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("running run -> cancel:false (keep going)", async () => {
    expect((await appendMessages(runId("running"), [])).cancel).toBe(false);
  });

  test("paused run -> cancel:true (stop the CLI, stay resumable)", async () => {
    expect((await appendMessages(runId("paused"), [])).cancel).toBe(true);
  });

  test("cancelled run -> cancel:true", async () => {
    expect((await appendMessages(runId("cancelled"), [])).cancel).toBe(true);
  });
});
