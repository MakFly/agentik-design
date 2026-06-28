/**
 * Atomic publish-with-identity (edit path) + transactional deleteAgent cascade.
 * Real Postgres; auto-skips when no DB is reachable.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { createAgent, deleteAgent, getAgentRow } from "../../../src/domains/agents/repo";
import { publishAgent } from "../../../src/domains/runs";
import { createRule } from "../../../src/domains/signals/repo";
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
if (!dbUp) console.warn("[agent-publish-delete] no DB reachable - skipping");
const d = dbUp ? describe : describe.skip;

d("publishAgent with identity patch (atomic)", () => {
  let teamId: string;
  let agentId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-pub-${Date.now()}`);
    const agent = await createAgent(teamId, { name: "Before" });
    agentId = agent.id;
  });

  test("identity patch + new version commit together", async () => {
    const v1 = await publishAgent(teamId, agentId, {
      instructions: "first",
      runtimeKind: "echo",
    });
    expect(v1 && "version" in v1 ? v1.version : null).toBe(1);

    const v2 = await publishAgent(
      teamId,
      agentId,
      { instructions: "second", runtimeKind: "echo" },
      "renamed + republished",
      { name: "After", emoji: "🤖", isOrchestrator: true },
    );
    expect(v2 && "version" in v2 ? v2.version : null).toBe(2);

    const row = await getAgentRow(teamId, agentId);
    expect(row?.name).toBe("After");
    expect(row?.emoji).toBe("🤖");
    expect(row?.isOrchestrator).toBe(true);
  });
});

d("deleteAgent cascade (transactional)", () => {
  let teamId: string;
  let agentId: string;
  let runId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-del-${Date.now()}`);
    const agent = await createAgent(teamId, { name: "Doomed" });
    agentId = agent.id;
    await publishAgent(teamId, agentId, { instructions: "x", runtimeKind: "echo" });

    runId = genId("run");
    await db.insert(schema.runs).values({
      id: runId,
      teamId,
      executor: "daemon",
      agentId,
      status: "succeeded",
      kind: "chat",
      input: {},
    });
    await db.insert(schema.runMessages).values({
      id: genId("amsg"),
      runId,
      seq: 1,
      type: "text",
      content: "hi",
    });
    const sig = await db
      .insert(schema.signals)
      .values({ id: genId("sig"), teamId, name: "S", kind: "manual", source: "manual" })
      .returning();
    await createRule(teamId, {
      name: "route",
      status: "active",
      signalId: sig[0]!.id,
      targetAgentId: agentId,
      condition: {},
    });
  });

  test("removes the agent and cleans its orphans atomically", async () => {
    const res = await deleteAgent(teamId, agentId);
    expect(res).not.toBeNull();
    expect(res!.disabledRules).toBe(1);

    expect(await getAgentRow(teamId, agentId)).toBeNull();
    const runs = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
    expect(runs.length).toBe(0);
    const msgs = await db
      .select()
      .from(schema.runMessages)
      .where(eq(schema.runMessages.runId, runId));
    expect(msgs.length).toBe(0);
    const liveRules = await db
      .select()
      .from(schema.assistantRules)
      .where(
        and(
          eq(schema.assistantRules.teamId, teamId),
          eq(schema.assistantRules.targetAgentId, agentId),
        ),
      );
    expect(liveRules.length).toBe(0);
  });
});
