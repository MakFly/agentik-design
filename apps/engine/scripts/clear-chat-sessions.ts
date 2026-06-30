/**
 * Delete ALL chat sessions (and their messages) for a team — empties the chat sidebar.
 * Destructive: removes the conversation history; agents/skills/memory are untouched.
 *
 * Usage:  TEAM=demo bun run scripts/clear-chat-sessions.ts
 *         bun run scripts/clear-chat-sessions.ts            # defaults to TEAM=demo
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../src/infra/db/client";
import { listChatSessions, deleteChatSession } from "../src/domains/chat/repo";

const TEAM = process.env.TEAM ?? "demo";

const [team] = await db
  .select({ id: schema.teams.id })
  .from(schema.teams)
  .where(eq(schema.teams.slug, TEAM))
  .limit(1);

if (!team) {
  console.error(`❌ No team with slug "${TEAM}".`);
  process.exit(1);
}

const sessions = await listChatSessions(team.id);
let deleted = 0;
for (const s of sessions) {
  if (await deleteChatSession(team.id, s.id)) deleted++;
}

console.log(`✅ Cleared ${deleted}/${sessions.length} chat session(s) for team "${TEAM}".`);
process.exit(0);
