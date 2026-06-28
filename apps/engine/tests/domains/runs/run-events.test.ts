/**
 * V2 run_events ledger: append + team-scoped read. Runs against a REAL Postgres
 * and skips automatically when no DB is reachable.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { genId } from "../../../src/infra/db/ids";
import { resolveTeam } from "../../../src/domains/workflows/repo";
import { appendRunEvents, listRunEvents } from "../../../src/domains/runs/repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[run-events] no DB reachable - skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("run_events V2 ledger", () => {
  let teamId: string;
  let otherTeamId: string;
  let runId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-revents-${Date.now()}`);
    otherTeamId = await resolveTeam(`itest-revents-other-${Date.now()}`);
    runId = genId("run");
    await db.insert(schema.runs).values({
      id: runId,
      teamId,
      executor: "daemon",
      status: "running",
      kind: "chat",
    });
  });

  test("append is ordered by seq and idempotent on (runId, seq)", async () => {
    await appendRunEvents(runId, [
      { seq: 2, type: "message", actor: { kind: "agent" }, payload: { type: "message" } },
      { seq: 1, type: "run.started", actor: { kind: "system" }, payload: { type: "run.started" } },
    ]);
    // Re-append seq 1 — must not duplicate.
    await appendRunEvents(runId, [
      { seq: 1, type: "run.started", actor: { kind: "system" }, payload: { type: "run.started" } },
    ]);

    const events = await listRunEvents(teamId, runId);
    expect(events).not.toBeNull();
    expect(events!.map((e) => e.seq)).toEqual([1, 2]);
    expect(events![0]!.type).toBe("run.started");
  });

  test("after-seq paging", async () => {
    const events = await listRunEvents(teamId, runId, 1);
    expect(events!.map((e) => e.seq)).toEqual([2]);
  });

  test("read is team-scoped: wrong team yields not-found (null)", async () => {
    expect(await listRunEvents(otherTeamId, runId)).toBeNull();
  });
});
