/**
 * Enable the deterministic gmail.read skill on existing "Inbox Triage" agents
 * (config is set on new seeds, but already-seeded agents need a backfill), then
 * run a real chat turn end-to-end to prove the skill returns real emails.
 *
 *   bun --cwd apps/engine scripts/enable-gmail-skill.ts
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/infra/db/client";
import { sendAgentChatTurn } from "../src/domains/chat/repo";
import { GMAIL_READ_SKILL } from "../src/domains/chat/skills";

const DEMO_SLUG = "demo";

const [team] = await db.select().from(schema.teams).where(eq(schema.teams.slug, DEMO_SLUG)).limit(1);
if (!team) {
  console.error(`No team with slug "${DEMO_SLUG}"`);
  process.exit(1);
}

const agentsRows = await db
  .select()
  .from(schema.agents)
  .where(and(eq(schema.agents.teamId, team.id), eq(schema.agents.name, "Inbox Triage")));

for (const a of agentsRows) {
  const config = (a.config && typeof a.config === "object" ? a.config : {}) as Record<string, unknown>;
  const skills = new Set([...(Array.isArray(config.skills) ? (config.skills as string[]) : []), GMAIL_READ_SKILL]);
  await db
    .update(schema.agents)
    .set({ config: { ...config, skills: [...skills] } })
    .where(eq(schema.agents.id, a.id));
  console.log(`✅ enabled ${GMAIL_READ_SKILL} on ${a.id} (skills=${[...skills].join(",")})`);
}

if (!agentsRows.length) {
  console.error("No 'Inbox Triage' agent in the demo team.");
  process.exit(1);
}

console.log("\n── Real end-to-end turn ───────────────────────────────");
const turn = await sendAgentChatTurn(team.id, {
  agentId: agentsRows[0]!.id,
  content: "donne moi les 5 derniers emails !",
  creatorId: "diag:enable-gmail-skill",
});
if ("error" in turn) {
  console.error("turn error:", turn.error);
  process.exit(1);
}
console.log("runId:", turn.runId);

const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, turn.runId)).limit(1);
console.log("status:", run?.status);
const result = run?.result as { result?: string } | null;
console.log("\nASSISTANT REPLY:\n");
console.log(result?.result ?? JSON.stringify(run?.result));

process.exit(0);
