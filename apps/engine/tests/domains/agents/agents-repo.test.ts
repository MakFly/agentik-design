import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createAgent, getAgentRow, listAgentRows } from "../../../src/domains/agents/repo";
import { resolveTeam } from "../../../src/domains/workflows/repo";
import { db, schema } from "../../../src/infra/db/client";
import { genId } from "../../../src/infra/db/ids";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[agents-repo] no DB reachable - skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("agents repo stats", () => {
  let teamId: string;
  let agentId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-agents-${Date.now()}`);
    const agent = await createAgent(teamId, { name: "Costed Agent" });
    agentId = agent.id;
    await db.insert(schema.runs).values([
      {
        id: genId("run"),
        teamId,
        executor: "daemon",
        agentId,
        status: "succeeded",
        kind: "direct",
        input: {},
        result: { cost_usd: 1.23 },
        costCents: 123,
        durationMs: 1000,
      },
      {
        id: genId("run"),
        teamId,
        executor: "daemon",
        agentId,
        status: "failed",
        kind: "direct",
        input: {},
        result: {},
        costCents: 77,
        durationMs: 2000,
      },
      {
        id: genId("run"),
        teamId,
        executor: "daemon",
        agentId,
        status: "running",
        kind: "direct",
        input: {},
        result: { cost_usd: 9.99 },
        costCents: 999,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("list and detail expose realized average cost per finished run", async () => {
    const detail = await getAgentRow(teamId, agentId);
    const listRow = (await listAgentRows(teamId)).find((agent) => agent.id === agentId);

    expect(detail?.stats.avgCost).toEqual({ amountCents: 100, currency: "USD" });
    expect(listRow?.stats.avgCost).toEqual({ amountCents: 100, currency: "USD" });
    expect(detail?.stats.successRate).toBe(0.5);
  });

  test("listAgentRows filters by q (name/role) in SQL and respects limit", async () => {
    await createAgent(teamId, { name: "ZephyrUnique Finder", role: "scout" });
    const hit = await listAgentRows(teamId, { q: "ZephyrUnique" });
    expect(hit.length).toBeGreaterThanOrEqual(1);
    expect(hit.every((a) => /zephyrunique/i.test(`${a.name} ${a.role}`))).toBe(true);

    const miss = await listAgentRows(teamId, { q: "no-such-agent-xyz" });
    expect(miss.length).toBe(0);

    const limited = await listAgentRows(teamId, { limit: 1 });
    expect(limited.length).toBe(1);
  });
});
