/**
 * agent_create / agent_list LLM tools: creating an agent from the chat goes through the same
 * createAgent (+ publish v1) path the platform UI uses. Skips when the DB is unavailable.
 */
import { describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { resolveTeam } from "../../../src/infra/tenancy";
import { buildAgentTools } from "../../../src/domains/chat/agent-tools";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[agent-tools] skipping (db down)");
const d = dbUp ? describe : describe.skip;

// The AI SDK tool.execute signature expects a second options arg we don't need here.
const run = (t: unknown, args: Record<string, unknown>) =>
  (t as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(args, {});

d("chat agent management tools", () => {
  test("agent_create creates a published agent; duplicate name is rejected", async () => {
    const teamId = await resolveTeam(`itest-agenttools-${Date.now()}`);
    const tools = buildAgentTools(teamId);
    const name = `Support ${Date.now()}`;

    const created = (await run(tools.agent_create, {
      name,
      goal: "Répondre aux clients",
      instructions: "Tu es un agent de support concis et poli.",
      skills: ["gmail.read"],
    })) as { created?: boolean; id?: string; error?: string };

    expect(created.created).toBe(true);
    expect(created.id).toBeTruthy();

    const [row] = await db
      .select({ id: schema.agents.id, liveVersionId: schema.agents.liveVersionId })
      .from(schema.agents)
      .where(and(eq(schema.agents.teamId, teamId), eq(schema.agents.name, name)))
      .limit(1);
    expect(row?.id).toBe(created.id!);
    expect(row?.liveVersionId).toBeTruthy(); // published v1

    const dup = (await run(tools.agent_create, {
      name,
      goal: "x",
      instructions: "y",
    })) as { error?: string };
    expect(dup.error).toContain("existe déjà");
  });

  test("agent_create rejects an empty name", async () => {
    const teamId = await resolveTeam(`itest-agenttools-empty-${Date.now()}`);
    const tools = buildAgentTools(teamId);
    const res = (await run(tools.agent_create, {
      name: "   ",
      goal: "g",
      instructions: "i",
    })) as { error?: string };
    expect(res.error).toBeTruthy();
  });

  test("agent_list returns the team's agents", async () => {
    const teamId = await resolveTeam(`itest-agenttools-list-${Date.now()}`);
    const tools = buildAgentTools(teamId);
    await run(tools.agent_create, { name: `Lister ${Date.now()}`, goal: "g", instructions: "i" });
    const list = (await run(tools.agent_list, {})) as { count: number; agents: { name: string }[] };
    expect(list.count).toBeGreaterThanOrEqual(1);
    expect(list.agents.some((a) => a.name.startsWith("Lister"))).toBe(true);
  });
});
