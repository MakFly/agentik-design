/**
 * Regression + additivity test for orchestration-native routing. Asserts that with NO
 * orchestrator flagged the router behaves exactly as before (routes over every published
 * agent), and that flagging an orchestrator narrows routing to its roster. Runs against a
 * REAL Postgres and SKIPs when none is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { genId } from "../../../src/infra/db/ids";
import { resolveTeam } from "../../../src/domains/workflows/repo";
import { createAgent, publishAgent } from "../../../src/domains/runs";
import { setRoster } from "../../../src/domains/agents/repo";
import { sendOrchestratedTurn } from "../../../src/domains/chat/orchestrator";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[orchestrator-roster] no DB reachable — skipping integration tests");
const d = dbUp ? describe : describe.skip;

const WEATHER = "Donne moi la météo au Havre";

d("orchestration-native routing stays additive", () => {
  let teamId: string;
  let coderId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-orch-${Date.now()}`);
    // A routed turn enqueues a run, which now requires a live daemon for the claude
    // runtime — seed one with a fresh heartbeat so routing reaches `kind: "run"`.
    const daemonId = genId("daemon");
    await db.insert(schema.daemons).values({
      id: daemonId,
      teamId,
      name: "Orchestrator Test Daemon",
      status: "online",
      lastHeartbeatAt: sql`now()`,
    });
    await db
      .insert(schema.runtimes)
      .values({ id: genId("runtime"), daemonId, teamId, kind: "claude" });
    const web = await createAgent(teamId, {
      name: "Web Weather Researcher",
      goal: "web search browser internet weather news sources",
    });
    await publishAgent(teamId, web.id, { instructions: "research the web", runtimeKind: "claude" });
    const coder = await createAgent(teamId, {
      name: "Backend Coder",
      goal: "fix code tests typescript go backend bugs",
    });
    coderId = coder.id;
    await publishAgent(teamId, coderId, { instructions: "write code", runtimeKind: "claude" });
  });

  afterAll(async () => {
    await db.delete(schema.agentSubagents).where(eq(schema.agentSubagents.teamId, teamId));
    await db.delete(schema.chatSessions).where(eq(schema.chatSessions.teamId, teamId));
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.memoryEntries).where(eq(schema.memoryEntries.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.daemons).where(eq(schema.daemons.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("no orchestrator → routes the weather query over all agents (unchanged)", async () => {
    const result = await sendOrchestratedTurn({
      teamId,
      surface: "web",
      actorId: "u1",
      threadKey: "t1",
      text: WEATHER,
    });
    if (result.kind !== "run") throw new Error(`expected run, got ${result.kind}`);
    expect(result.agent.name).toBe("Web Weather Researcher");
  });

  test("a flagged orchestrator narrows routing to its roster", async () => {
    const conductor = await createAgent(teamId, {
      name: "Conductor",
      goal: "delegate to specialists",
      isOrchestrator: true,
      config: { instructions: "delegate", runtimeKind: "claude" },
    });
    expect(conductor.version).toBe(1);
    // Roster contains only the coder — so even a weather query must land on the coder.
    await setRoster(teamId, conductor.id, [{ agentId: coderId }]);

    const result = await sendOrchestratedTurn({
      teamId,
      surface: "web",
      actorId: "u2",
      threadKey: "t2",
      text: WEATHER,
    });
    if (result.kind !== "run") throw new Error(`expected run, got ${result.kind}`);
    expect(result.agent.name).toBe("Backend Coder");
  });
});
