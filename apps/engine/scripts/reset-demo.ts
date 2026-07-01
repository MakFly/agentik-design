/**
 * Reset an org (team) to zero — deletes all its data so you can re-seed from scratch.
 * Portable (Postgres or PGlite) via the ORM. Invoked by scripts/reset-demo.sh.
 *
 * Discovery is dynamic: every table with a `team_id` column is wiped (so new tables are
 * covered automatically), plus the child tables that link via a parent (chat_messages,
 * run_messages/steps, *_versions). FK ordering is neutralised with a session-local
 * `session_replication_role = replica` inside one transaction (dev DB role only).
 *
 * Usage:  TEAM=demo bun run scripts/reset-demo.ts [--hard] [--drop-team]
 *   default   wipe operational data; KEEP secrets (provider keys, oauth, credentials),
 *             org settings, and memberships, so you don't have to re-auth.
 *   --hard    also wipe secrets/settings/memberships.
 *   --drop-team  also delete the team row itself (implies --hard).
 */
import { sql } from "drizzle-orm";
import { db, schema } from "../src/infra/db/client";

const TEAM = process.env.TEAM ?? "demo";
const HARD = process.argv.includes("--hard") || process.argv.includes("--drop-team");
const DROP_TEAM = process.argv.includes("--drop-team");

/** Kept by default (secrets + who-can-access) so a fresh seed works without re-authenticating. */
const PRESERVE_DEFAULT = new Set([
  "provider_keys",
  "runtime_oauth_tokens",
  "credentials",
  "org_settings",
  "org_members",
  "org_invitations",
]);

/** Child tables with no team_id — deleted via their team-scoped parent. */
const CHILD_TABLES: Array<[table: string, fk: string, parent: string]> = [
  ["chat_messages", "chat_session_id", "chat_sessions"],
  ["run_messages", "run_id", "runs"],
  ["run_steps", "run_id", "runs"],
  ["agent_versions", "agent_id", "agents"],
  ["skill_versions", "skill_id", "skills"],
  ["workflow_versions", "workflow_id", "workflows"],
];

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  const r = res as { rows?: Array<Record<string, unknown>> };
  return r.rows ?? [];
}

const [team] = await db
  .select({ id: schema.teams.id })
  .from(schema.teams)
  .where(sql`${schema.teams.slug} = ${TEAM}`)
  .limit(1);

if (!team) {
  console.error(`❌ No team with slug "${TEAM}".`);
  process.exit(1);
}
const teamId = team.id;

// Every table that carries a team_id column (dynamic → future-proof).
const teamTables = rowsOf(
  await db.execute(
    sql`SELECT table_name FROM information_schema.columns
        WHERE column_name = 'team_id' AND table_schema = 'public'
        ORDER BY table_name`,
  ),
)
  .map((r) => String(r.table_name))
  .filter((t) => t !== "teams");

const wiped: string[] = [];
const kept: string[] = [];

await db.transaction(async (tx) => {
  // Disable FK/cascade triggers for this transaction so delete order is irrelevant.
  await tx.execute(sql`SET LOCAL session_replication_role = replica`);

  // 1) child tables (no team_id) via their team-scoped parent
  for (const [table, fk, parent] of CHILD_TABLES) {
    await tx.execute(
      sql`DELETE FROM ${sql.identifier(table)}
          WHERE ${sql.identifier(fk)} IN (SELECT id FROM ${sql.identifier(parent)} WHERE team_id = ${teamId})`,
    );
    wiped.push(table);
  }

  // 2) every team_id table (minus the preserve set unless --hard)
  for (const table of teamTables) {
    if (!HARD && PRESERVE_DEFAULT.has(table)) {
      kept.push(table);
      continue;
    }
    await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE team_id = ${teamId}`);
    wiped.push(table);
  }

  // 3) optionally the team row itself
  if (DROP_TEAM) {
    await tx.execute(sql`DELETE FROM ${sql.identifier("teams")} WHERE id = ${teamId}`);
    wiped.push("teams");
  }
});

console.log(`✅ Reset org "${TEAM}" (${teamId})`);
console.log(`   wiped (${wiped.length}): ${[...new Set(wiped)].sort().join(", ")}`);
if (kept.length) console.log(`   kept  (${kept.length}): ${kept.sort().join(", ")}  ${HARD ? "" : "(use --hard to wipe)"}`);
if (DROP_TEAM) console.log(`   ⚠️  team row deleted — it will be recreated on next access/seed.`);
process.exit(0);
