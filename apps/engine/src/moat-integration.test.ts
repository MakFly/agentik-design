/**
 * Integration tests for the learning-loop moat, run against a REAL Postgres.
 * They SKIP automatically when no DB is reachable, so `bun test` stays green offline
 * (pure unit tests still run). Run the full suite with infra-postgres up.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { resolveTeam } from "./repo";
import { createAgent, publishAgent } from "./agents-repo";
import { listAgentVersions } from "./learning-repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[moat-integration] no DB reachable — skipping integration tests");

const d = dbUp ? describe : describe.skip;

d("Phase B — publishAgent writes immutable, monotonic versions", () => {
  const slug = `itest-b-${Date.now()}`;
  let teamId: string;
  let agentId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(slug);
    const a = await createAgent(teamId, { name: "Versioned Agent" });
    agentId = a.id;
  });

  afterAll(async () => {
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId)); // cascade → agent_versions
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("first publish → version 1, liveVersionId points at the immutable row", async () => {
    const res = await publishAgent(teamId, agentId, {
      instructions: "do v1",
      tools: ["get_weather"],
      runtimeKind: "claude",
    });
    expect(res?.version).toBe(1);
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
    expect(agent?.liveVersionId).toBe(res!.versionId);
    const versions = await listAgentVersions(teamId, agentId);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.instructions).toBe("do v1");
    expect(versions[0]?.runtimeKind).toBe("claude");
  });

  test("second publish → version 2 (monotonic, immutable history kept)", async () => {
    const res = await publishAgent(teamId, agentId, { instructions: "do v2" });
    expect(res?.version).toBe(2);
    const versions = await listAgentVersions(teamId, agentId);
    expect(versions.map((v) => v.version)).toEqual([2, 1]); // desc; v1 still present
  });

  test("publish on a foreign team is rejected (tenancy)", async () => {
    const otherTeam = await resolveTeam(`${slug}-other`);
    const res = await publishAgent(otherTeam, agentId, { instructions: "hijack" });
    expect(res).toBeNull();
    await db.delete(schema.teams).where(eq(schema.teams.id, otherTeam));
  });
});
