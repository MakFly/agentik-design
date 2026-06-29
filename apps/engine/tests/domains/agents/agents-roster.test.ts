/**
 * Integration tests for agent identity, the orchestrator roster, the graph, atomic
 * create+publish, and delete-time rule/binding detachment. Run against a REAL Postgres;
 * SKIP automatically when none is reachable so `bun test` stays green offline.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { resolveTeam } from "../../../src/infra/tenancy";
import { genId } from "../../../src/infra/db/ids";
import {
  createAgent,
  deleteAgent,
  getAgentGraph,
  getAgentRow,
  getRoster,
  setRoster,
  updateAgent,
} from "../../../src/domains/agents/repo";
import { createBinding } from "../../../src/domains/channels/repo";
import { createRule } from "../../../src/domains/signals/repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[agents-roster] no DB reachable — skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("agent roster + identity + graph", () => {
  let teamId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-roster-${Date.now()}`);
  });

  afterAll(async () => {
    await db.delete(schema.channelBindings).where(eq(schema.channelBindings.teamId, teamId));
    await db.delete(schema.channelConnections).where(eq(schema.channelConnections.teamId, teamId));
    await db.delete(schema.assistantRules).where(eq(schema.assistantRules.teamId, teamId));
    await db.delete(schema.agentSubagents).where(eq(schema.agentSubagents.teamId, teamId));
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("create stores identity fields; with config it publishes v1 atomically", async () => {
    const plain = await createAgent(teamId, { name: "Plain", emoji: "🟦", color: "#0af" });
    expect(plain.draftVersionId).toBeTruthy();
    expect("version" in plain).toBe(false);
    const plainRow = await getAgentRow(teamId, plain.id);
    expect(plainRow?.emoji).toBe("🟦");
    expect(plainRow?.isOrchestrator).toBe(false);
    expect(plainRow?.liveVersionId).toBeFalsy();
    // Detail always carries a config field (null when the agent has none yet).
    expect(plainRow && "config" in plainRow).toBe(true);
    expect(plainRow?.config).toBeNull();

    const conductor = await createAgent(teamId, {
      name: "Conductor",
      isOrchestrator: true,
      config: { instructions: "delegate", runtimeKind: "claude" },
    });
    expect(conductor.version).toBe(1);
    const conductorRow = await getAgentRow(teamId, conductor.id);
    expect(conductorRow?.isOrchestrator).toBe(true);
    expect(conductorRow?.liveVersionId).toBeTruthy();
    // Detail must expose the full published config so the edit flow doesn't reset to defaults.
    expect((conductorRow?.config as { runtimeKind?: string } | null)?.runtimeKind).toBe("claude");
    expect((conductorRow?.config as { instructions?: string } | null)?.instructions).toBe("delegate");
  });

  test("updateAgent patches identity + orchestrator flag and returns the row", async () => {
    const a = await createAgent(teamId, { name: "Patchable" });
    const updated = await updateAgent(teamId, a.id, {
      role: "Router",
      emoji: "🧭",
      isOrchestrator: true,
    });
    expect(updated?.role).toBe("Router");
    expect(updated?.emoji).toBe("🧭");
    expect(updated?.isOrchestrator).toBe(true);
    expect(await updateAgent(teamId, "agt_missing", { role: "x" })).toBeNull();
  });

  test("setRoster replace-sets, validates membership, and getRoster returns ordered", async () => {
    const parent = await createAgent(teamId, { name: "Parent", isOrchestrator: true });
    const sub1 = await createAgent(teamId, { name: "Alpha", emoji: "🅰️" });
    const sub2 = await createAgent(teamId, { name: "Beta" });

    const set1 = await setRoster(teamId, parent.id, [
      { agentId: sub2.id, position: 1 },
      { agentId: sub1.id, position: 0, instruction: "go first" },
    ]);
    expect("roster" in set1).toBe(true);
    const roster = await getRoster(teamId, parent.id);
    expect(roster.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
    expect(roster[0]?.instruction).toBe("go first");
    expect(roster[0]?.emoji).toBe("🅰️");

    // Replace-set down to a single member.
    await setRoster(teamId, parent.id, [{ agentId: sub2.id }]);
    const roster2 = await getRoster(teamId, parent.id);
    expect(roster2.map((r) => r.name)).toEqual(["Beta"]);

    expect(await setRoster(teamId, parent.id, [{ agentId: parent.id }])).toEqual({
      error: "self_reference",
    });
    expect(await setRoster(teamId, parent.id, [{ agentId: "agt_nope" }])).toEqual({
      error: "agent_not_found",
    });
    expect(await setRoster(teamId, "agt_missing", [{ agentId: sub2.id }])).toEqual({
      error: "parent_not_found",
    });
  });

  test("createAgent records the creator as owner/createdBy", async () => {
    const owned = await createAgent(teamId, { name: "Owned" }, "usr_alice");
    const row = await getAgentRow(teamId, owned.id);
    expect(row?.owner).toBe("usr_alice");
    expect(row?.createdBy).toBe("usr_alice");
    const systemSeeded = await createAgent(teamId, { name: "SystemMade" });
    const row2 = await getAgentRow(teamId, systemSeeded.id);
    expect(row2?.owner).toBe("usr_system"); // null creator → system fallback
  });

  test("setRoster rejects a delegation cycle (A→B→A)", async () => {
    const a = await createAgent(teamId, { name: "CycleA", isOrchestrator: true });
    const b = await createAgent(teamId, { name: "CycleB", isOrchestrator: true });
    // A → B is fine.
    expect("roster" in (await setRoster(teamId, a.id, [{ agentId: b.id }]))).toBe(true);
    // B → A would close the loop A→B→A → rejected.
    expect(await setRoster(teamId, b.id, [{ agentId: a.id }])).toEqual({ error: "cycle" });
  });

  test("getAgentGraph returns nodes + roster edges", async () => {
    const graph = await getAgentGraph(teamId);
    const names = graph.nodes.map((n) => n.name);
    expect(names).toContain("Conductor");
    expect(graph.nodes.some((n) => n.isOrchestrator)).toBe(true);
    expect(Array.isArray(graph.rosterEdges)).toBe(true);
    expect(Array.isArray(graph.runEdges)).toBe(true);
  });

  test("deleteAgent detaches targeting rules + bindings and reports the count", async () => {
    const target = await createAgent(teamId, { name: "Deletable" });
    const [conn] = await db
      .insert(schema.channelConnections)
      .values({
        id: genId("chan"),
        teamId,
        provider: "telegram",
        label: "Bindings",
        status: "active",
        webhookSecret: genId("chan"),
        pairingCode: "PAIR9999",
        createdBy: "usr_test",
      })
      .returning();
    await createBinding(teamId, conn!.id, {
      agentId: target.id,
      groupPolicy: "off",
      requireMention: true,
    });
    await createRule(teamId, {
      name: "route to deletable",
      status: "active",
      condition: {},
      targetAgentId: target.id,
      action: { type: "run_agent", input: "go" },
    });

    const res = await deleteAgent(teamId, target.id);
    expect(res).toMatchObject({ disabledRules: 1, disabledBindings: 1 });
    expect(res && res.note).toBe("2 rules/bindings disabled");

    const [rule] = await db
      .select({ targetAgentId: schema.assistantRules.targetAgentId })
      .from(schema.assistantRules)
      .where(eq(schema.assistantRules.teamId, teamId));
    expect(rule?.targetAgentId).toBeNull();
    const [binding] = await db
      .select({ agentId: schema.channelBindings.agentId })
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.connectionId, conn!.id));
    expect(binding?.agentId).toBeNull();

    expect(await deleteAgent(teamId, "agt_missing")).toBeNull();
  });
});
