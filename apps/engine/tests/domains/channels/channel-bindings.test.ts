/**
 * Tests for channel bindings (per-connection agent + group policy) against a REAL
 * Postgres. SKIP automatically when no DB is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { resolveTeam } from "../../../src/domains/workflows/repo";
import { createAgent } from "../../../src/domains/runs";
import { genId } from "../../../src/infra/db/ids";
import {
  createBinding,
  deleteBinding,
  getConnectionBinding,
  listBindings,
  updateBinding,
} from "../../../src/domains/channels/repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[channel-bindings] no DB reachable — skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("channel bindings", () => {
  let teamId: string;
  let connectionId: string;
  let agentId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-bindings-${Date.now()}`);
    const [conn] = await db
      .insert(schema.channelConnections)
      .values({
        id: genId("chan"),
        teamId,
        provider: "telegram",
        label: "Bindings Bot",
        status: "active",
        webhookSecret: genId("chan"),
        pairingCode: "PAIR4242",
        createdBy: "usr_test",
      })
      .returning();
    connectionId = conn!.id;
    const agent = await createAgent(teamId, { name: "Bound Agent" });
    agentId = agent.id;
  });

  afterAll(async () => {
    await db.delete(schema.channelBindings).where(eq(schema.channelBindings.teamId, teamId));
    await db.delete(schema.channelConnections).where(eq(schema.channelConnections.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("create validates connection + agent and rejects duplicates", async () => {
    expect(
      await createBinding(teamId, "chan_missing", { agentId, groupPolicy: "off", requireMention: true }),
    ).toEqual({ error: "connection_not_found" });
    expect(
      await createBinding(teamId, connectionId, {
        agentId: "agt_missing",
        groupPolicy: "off",
        requireMention: true,
      }),
    ).toEqual({ error: "agent_not_found" });

    const created = await createBinding(teamId, connectionId, {
      agentId,
      groupPolicy: "allowlist",
      requireMention: false,
      config: { note: "primary" },
    });
    expect("binding" in created).toBe(true);
    if ("binding" in created) {
      expect(created.binding.agentName).toBe("Bound Agent");
      expect(created.binding.groupPolicy).toBe("allowlist");
      expect(created.binding.requireMention).toBe(false);
    }

    expect(
      await createBinding(teamId, connectionId, { agentId, groupPolicy: "off", requireMention: true }),
    ).toEqual({ error: "binding_exists" });
  });

  test("list + update + getConnectionBinding reflect changes", async () => {
    const bindings = await listBindings(teamId, connectionId);
    expect(bindings).toHaveLength(1);
    const bindingId = bindings[0]!.id;

    const updated = await updateBinding(teamId, bindingId, {
      groupPolicy: "open",
      requireMention: true,
    });
    expect(updated && "binding" in updated && updated.binding.groupPolicy).toBe("open");

    expect(await updateBinding(teamId, bindingId, { agentId: "agt_missing" })).toEqual({
      error: "agent_not_found",
    });
    expect(await updateBinding(teamId, "chbind_missing", { requireMention: false })).toBeNull();

    const effective = await getConnectionBinding(connectionId);
    expect(effective?.groupPolicy).toBe("open");
    expect(effective?.agentId).toBe(agentId);
  });

  test("delete removes the binding", async () => {
    const [binding] = await listBindings(teamId, connectionId);
    expect(await deleteBinding(teamId, binding!.id)).toBe(true);
    expect(await deleteBinding(teamId, binding!.id)).toBe(false);
    expect(await listBindings(teamId, connectionId)).toHaveLength(0);
    expect(await getConnectionBinding(connectionId)).toBeNull();
  });
});
