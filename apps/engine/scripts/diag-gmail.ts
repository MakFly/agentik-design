/**
 * Diagnostic: is the Gmail READ path actually wired for a team?
 * Inspects credential scope, daemons/runtimes, provider keys, the Inbox Triage
 * agent's runtime, then performs a REAL Gmail list (the actual test).
 *
 *   bun --cwd apps/engine run scripts/diag-gmail.ts
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../src/infra/db/client";
import { decryptJson } from "../src/infra/crypto";
import { listGmailMessages } from "../src/infra/gmail";

function line() {
  console.log("─".repeat(70));
}

const teams = await db.select().from(schema.teams);
line();
console.log("TEAMS");
for (const t of teams) console.log(`  ${t.id}  slug=${t.slug}  name=${t.name}`);

line();
console.log("GOOGLE CREDENTIALS (type=googleOAuth2)");
const creds = await db
  .select()
  .from(schema.credentials)
  .where(eq(schema.credentials.type, "googleOAuth2"));
if (!creds.length) console.log("  (none — Gmail not connected for any team)");
for (const c of creds) {
  let scope = "?";
  let hasAccess = false;
  let hasRefresh = false;
  let expiresAt = "?";
  try {
    const data = decryptJson<Record<string, string>>(c.data);
    scope = data.scope ?? "(no scope field)";
    hasAccess = Boolean(data.access_token);
    hasRefresh = Boolean(data.refresh_token);
    expiresAt = data.expires_at ? new Date(Number(data.expires_at)).toISOString() : "?";
  } catch (e) {
    scope = `DECRYPT FAILED: ${(e as Error).message}`;
  }
  const readonly = scope.includes("gmail.readonly");
  console.log(`  team=${c.teamId} name="${c.name}"`);
  console.log(`    access_token=${hasAccess} refresh_token=${hasRefresh} expires=${expiresAt}`);
  console.log(`    scope=${scope}`);
  console.log(`    gmail.readonly granted? ${readonly ? "YES ✅" : "NO ❌ (read will 403 — reconnect with readonly)"}`);
}

line();
console.log("DAEMONS + RUNTIMES");
const daemons = await db.select().from(schema.daemons);
const runtimes = await db.select().from(schema.runtimes);
for (const d of daemons) {
  const rts = runtimes.filter((r) => r.daemonId === d.id).map((r) => `${r.kind}(${r.status})`);
  console.log(`  ${d.name} [${d.status}] team=${d.teamId} runtimes=${rts.join(", ") || "(none)"}`);
}

line();
console.log("PROVIDER KEYS (LLM)");
const keys = await db.select().from(schema.providerKeys);
if (!keys.length) console.log("  (none — no BYOK LLM key, so anthropic/openai runtimes can't auth)");
for (const k of keys) console.log(`  team=${k.teamId} provider=${k.provider}`);

line();
console.log("INBOX TRIAGE AGENTS");
const agents = await db.select().from(schema.agents).where(eq(schema.agents.name, "Inbox Triage"));
for (const a of agents) console.log(`  ${a.id} team=${a.teamId} runtimeKind=${a.runtimeKind} live=${a.liveVersionId}`);

line();
console.log("REAL GMAIL READ TEST (the actual proof)");
const teamsWithCred = [...new Set(creds.map((c) => c.teamId))];
for (const teamId of teamsWithCred) {
  console.log(`\n  team=${teamId} → listGmailMessages(maxResults=5):`);
  try {
    const msgs = await listGmailMessages(teamId, { maxResults: 5 });
    if (!msgs.length) {
      console.log("    (0 messages returned — inbox empty or label mismatch)");
    }
    for (const m of msgs) {
      console.log(`    • ${m.date} | ${m.from}`);
      console.log(`      ${m.subject}`);
      console.log(`      ${m.snippet.slice(0, 80)}`);
    }
  } catch (e) {
    console.log(`    ERROR: ${(e as Error).message}`);
  }
}

line();
process.exit(0);
