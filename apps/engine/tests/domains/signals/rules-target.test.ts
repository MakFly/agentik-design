/**
 * Tests for deterministic rule routing (targetAgentId) and the deliveries feed.
 * Schema validation runs offline; dispatch/listing run against a REAL Postgres and
 * SKIP when none is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { genId } from "../../../src/infra/db/ids";
import { resolveTeam } from "../../../src/infra/tenancy";
import { createAgent, publishAgent } from "../../../src/domains/runs";
import {
  createRule,
  createSignal,
  listDeliveries,
} from "../../../src/domains/signals/repo";
import { dispatchSignal } from "../../../src/domains/signals/service";
import { createRuleBody } from "../../../src/domains/signals/schemas";

describe("rule action schema (discriminated union)", () => {
  test("accepts orchestrate and run_agent; rejects unknown/empty", () => {
    expect(
      createRuleBody.safeParse({
        name: "r",
        targetAgentId: "agt_1",
        action: { type: "run_agent", input: "go" },
      }).success,
    ).toBe(true);
    expect(
      createRuleBody.safeParse({ name: "r", action: { type: "orchestrate", input: "plan" } })
        .success,
    ).toBe(true);
    expect(
      createRuleBody.safeParse({ name: "r", action: { type: "noop", input: "x" } }).success,
    ).toBe(false);
    expect(
      createRuleBody.safeParse({ name: "r", action: { type: "run_agent", input: "" } }).success,
    ).toBe(false);
    // targetAgentId is optional and may be explicitly null
    expect(createRuleBody.safeParse({ name: "r", targetAgentId: null }).success).toBe(true);
  });
});

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[rules-target] no DB reachable — skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("deterministic rule routing + deliveries", () => {
  let teamId: string;
  let publishedId: string;
  let unpublishedId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-rules-${Date.now()}`);
    // Rule execution dispatches via runAgent, which now requires a live daemon for the
    // claude runtime — seed one with a fresh heartbeat so deliveries reach "started".
    const daemonId = genId("daemon");
    await db.insert(schema.daemons).values({
      id: daemonId,
      teamId,
      name: "Rules Test Daemon",
      status: "online",
      lastHeartbeatAt: sql`now()`,
    });
    await db
      .insert(schema.runtimes)
      .values({ id: genId("runtime"), daemonId, teamId, kind: "claude" });
    const published = await createAgent(teamId, { name: "Pinned Worker" });
    publishedId = published.id;
    await publishAgent(teamId, publishedId, { instructions: "do work", runtimeKind: "claude" });
    const unpublished = await createAgent(teamId, { name: "Draft Worker" });
    unpublishedId = unpublished.id;
  });

  afterAll(async () => {
    await db.delete(schema.signalDeliveries).where(eq(schema.signalDeliveries.teamId, teamId));
    await db.delete(schema.assistantRules).where(eq(schema.assistantRules.teamId, teamId));
    await db.delete(schema.signals).where(eq(schema.signals.teamId, teamId));
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.daemons).where(eq(schema.daemons.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("targetAgentId routes the run deterministically to that agent", async () => {
    const signal = await createSignal(teamId, {
      name: "Lead",
      kind: "webhook",
      source: "manual",
      status: "active",
      config: {},
    });
    await createRule(teamId, {
      name: "pin",
      status: "active",
      signalId: signal.id,
      targetAgentId: publishedId,
      condition: {},
      action: { type: "run_agent", input: "handle the lead" },
    });

    const res = await dispatchSignal(teamId, signal.id, { payload: { x: 1 } });
    expect(res?.deliveries[0]?.status).toBe("started");
    const runId = res?.deliveries[0]?.runId;
    expect(runId).toBeTruthy();

    const [run] = await db
      .select({ agentId: schema.runs.agentId, input: schema.runs.input })
      .from(schema.runs)
      .where(eq(schema.runs.id, runId!))
      .limit(1);
    expect(run?.agentId).toBe(publishedId);
    expect((run?.input as { prompt?: string })?.prompt).toBe("handle the lead");
  });

  test("targeting an unpublished agent fails (not ignored)", async () => {
    const signal = await createSignal(teamId, {
      name: "Lead2",
      kind: "webhook",
      source: "manual",
      status: "active",
      config: {},
    });
    await createRule(teamId, {
      name: "pin-draft",
      status: "active",
      signalId: signal.id,
      targetAgentId: unpublishedId,
      condition: {},
      action: { type: "run_agent", input: "x" },
    });
    const res = await dispatchSignal(teamId, signal.id, { payload: {} });
    expect(res?.deliveries[0]?.status).toBe("failed");
    expect(res?.deliveries[0]?.error).toBe("not_published");
  });

  test("listDeliveries returns recent deliveries with the target agent name", async () => {
    const { items, total } = await listDeliveries(teamId);
    expect(total).toBeGreaterThanOrEqual(2);
    const started = items.find((i) => i.status === "started");
    expect(started?.agentName).toBe("Pinned Worker");
    expect(started?.targetAgentId).toBe(publishedId);
  });
});
