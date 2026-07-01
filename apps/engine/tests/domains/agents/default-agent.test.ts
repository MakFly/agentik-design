/**
 * ensureDefaultAgent: every team self-heals to a usable "main" agent (OpenClaw model) so the
 * app is never agent-less. Must be idempotent AND race-safe (concurrent first-access from
 * several tabs must still yield exactly one main). Skips when the DB is unavailable.
 */
import { describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { resolveTeam } from "../../../src/infra/tenancy";
import { ensureDefaultAgent } from "../../../src/domains/agents/repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[default-agent] skipping (db down)");
const d = dbUp ? describe : describe.skip;

const mains = (teamId: string) =>
  db
    .select({ id: schema.agents.id, live: schema.agents.liveVersionId })
    .from(schema.agents)
    .where(and(eq(schema.agents.teamId, teamId), eq(schema.agents.name, "main")));

d("ensureDefaultAgent", () => {
  test("creates exactly one published 'main' on a fresh team, idempotently", async () => {
    const teamId = await resolveTeam(`itest-main-${Date.now()}`);
    await ensureDefaultAgent(teamId);
    await ensureDefaultAgent(teamId); // idempotent
    const rows = await mains(teamId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.live).toBeTruthy(); // published v1 → usable in chat
  });

  test("is race-safe: concurrent first-access yields a single main", async () => {
    const teamId = await resolveTeam(`itest-main-race-${Date.now()}`);
    await Promise.all(Array.from({ length: 6 }, () => ensureDefaultAgent(teamId)));
    expect(await mains(teamId)).toHaveLength(1);
  });

  test("does not add 'main' when the team already has an agent", async () => {
    const teamId = await resolveTeam(`itest-main-existing-${Date.now()}`);
    await db.insert(schema.agents).values({
      id: `agt_seed_${teamId}`,
      teamId,
      name: "Custom",
      role: "operator",
      goal: "g",
      health: "idle",
    });
    await ensureDefaultAgent(teamId);
    expect(await mains(teamId)).toHaveLength(0); // no main forced alongside an existing agent
  });
});
