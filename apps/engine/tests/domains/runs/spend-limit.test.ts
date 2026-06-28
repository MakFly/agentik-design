/**
 * Integration tests for per-team monthly spend tracking + enforcement. They run
 * against a REAL Postgres and skip automatically when no DB is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { genId } from "../../../src/infra/db/ids";
import { resolveTeam } from "../../../src/domains/workflows/repo";
import {
  assertWithinSpendLimit,
  createAgent,
  monthlyCostCents,
  runAgent,
} from "../../../src/domains/runs";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[spend-limit] no DB reachable - skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("per-team monthly spend limit", () => {
  let teamId: string;
  let agentId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-spend-${Date.now()}`);
    const agent = await createAgent(teamId, { name: "Spendy Agent" });
    agentId = agent.id;
    // runAgent dispatch requires a published agent — point liveVersionId at any value.
    await db
      .update(schema.agents)
      .set({ liveVersionId: "ver_test" })
      .where(eq(schema.agents.id, agentId));
    // Seed 1500 cents of realized spend this month (+ one null-cost run, must be ignored).
    await seedRun(1000);
    await seedRun(500);
    await seedRun(null);
  });

  afterAll(async () => {
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  async function seedRun(costCents: number | null) {
    await db.insert(schema.runs).values({
      id: genId("run"),
      teamId,
      executor: "daemon",
      agentId,
      status: "succeeded",
      kind: "direct",
      input: {},
      ...(costCents != null ? { costCents } : {}),
    });
  }

  async function setLimit(cents: number | null) {
    const providers = cents == null ? {} : { monthlySpendLimitCents: cents };
    await db
      .update(schema.teams)
      .set({ settings: { providers } })
      .where(eq(schema.teams.id, teamId));
  }

  test("monthlyCostCents sums this-month run costs, ignoring null-cost runs", async () => {
    expect(await monthlyCostCents(teamId)).toBe(1500);
  });

  test("uncapped team passes the guard", async () => {
    await setLimit(null);
    expect(await assertWithinSpendLimit(teamId)).toEqual({ ok: true });
  });

  test("dispatch is rejected once monthly spend reaches the cap", async () => {
    await setLimit(1000); // 1500 spent >= 1000 cap
    const guard = await assertWithinSpendLimit(teamId);
    expect(guard.ok).toBe(false);
    const res = await runAgent(teamId, agentId, "go");
    expect(res).toEqual({
      error: "spend_limit_exceeded",
      spentCents: 1500,
      limitCents: 1000,
    });
  });

  test("dispatch is accepted when under the cap", async () => {
    await setLimit(100_000); // well above the 1500 spent
    const res = await runAgent(teamId, agentId, "go");
    expect(res).toHaveProperty("runId");
  });
});
